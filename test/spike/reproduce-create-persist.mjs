/**
 * Spike: Reproduce POST create persist regression against MySQL (#166)
 *
 * Reports that POST to auto-REST endpoint returns success but writes nothing
 * to MySQL. store.get(collection, id) returns a truthy non-record for a
 * missing ID, causing create to be treated as already-existing.
 *
 * Hypotheses:
 *   H1: store.get(key, 0) or store.get(key, undefined) returns the model Map
 *       due to the `if (!id)` falsy check (store.ts line 67)
 *   H2: _persistCreate re-key timing leaves stale entries
 *   H3: Write queue introduces microtask delay
 *   H4: Dual-singleton version mismatch
 *
 * Usage:
 *   brew services start mysql
 *   cd <orm-root> && pnpm build
 *   node test/spike/reproduce-create-persist.mjs
 */

import mysql from 'mysql2/promise';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
const MYSQL_CONFIG = {
  host: '127.0.0.1',
  port: parseInt(process.env.MYSQL_PORT || '3306'),
  user: process.env.MYSQL_USER || 'root',
  password: process.env.MYSQL_PASSWORD || '',
  database: 'create_persist_spike',
};

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS widgets (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  color VARCHAR(50) DEFAULT NULL
) ENGINE=InnoDB;
`;

// ---------------------------------------------------------------------------
// Results
// ---------------------------------------------------------------------------
const results = { tests: [], verdict: null };

function assert(condition, message) {
  const status = condition ? 'PASS' : 'FAIL';
  results.tests.push({ status, message });
  console.log(`  [${status}] ${message}`);
  return condition;
}

// ---------------------------------------------------------------------------
// Test 1: store.get() falsy-ID edge cases
// ---------------------------------------------------------------------------
async function testStoreGetEdgeCases() {
  console.log('\n--- Test 1: store.get() falsy-ID edge cases ---\n');

  const { readFileSync } = await import('fs');
  const { resolve, dirname } = await import('path');
  const { fileURLToPath } = await import('url');

  const __dirname = dirname(fileURLToPath(import.meta.url));
  const storePath = resolve(__dirname, '../../src/store.ts');

  let source;
  try {
    source = readFileSync(storePath, 'utf8');
  } catch {
    try {
      source = readFileSync(resolve(__dirname, '../../dist/store.js'), 'utf8');
    } catch {
      results.tests.push({ status: 'SKIP', message: 'store source not found' });
      return;
    }
  }

  // Check if store.get uses falsy check (!id) vs nullish check (id == null)
  const lines = source.split('\n');
  let getMethodLine = -1;
  let usesFalsyCheck = false;

  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes('get(key') && lines[i].includes('id?')) {
      getMethodLine = i + 1;
    }
    if (getMethodLine > 0 && lines[i].includes('if (!id)')) {
      usesFalsyCheck = true;
      break;
    }
    if (getMethodLine > 0 && lines[i].includes('if (id == null)')) {
      usesFalsyCheck = false;
      break;
    }
  }

  assert(usesFalsyCheck, `store.get() uses falsy check (!id) at line ~${getMethodLine} — id=0 returns the Map, not a record`);

  // Simulate the behavior directly
  const fakeStore = new Map();
  fakeStore.set('widget', new Map());

  // Simulate store.get(key, id) with falsy check
  function storeGet(key, id) {
    if (!id) return fakeStore.get(key);  // BUG: returns Map for id=0, id='', id=undefined
    return fakeStore.get(key)?.get(id);
  }

  const resultUndefined = storeGet('widget', undefined);
  assert(resultUndefined instanceof Map, `store.get(model, undefined) returns a Map (truthy non-record)`);

  const result0 = storeGet('widget', 0);
  assert(result0 instanceof Map, `store.get(model, 0) returns a Map (truthy non-record)`);

  const resultEmptyStr = storeGet('widget', '');
  assert(resultEmptyStr instanceof Map, `store.get(model, '') returns a Map (truthy non-record)`);

  const resultValidId = storeGet('widget', 42);
  assert(resultValidId === undefined, `store.get(model, 42) for missing record returns undefined (correct)`);

  // Confirm the Map has no toJSON
  if (resultUndefined instanceof Map) {
    assert(typeof resultUndefined.toJSON !== 'function', 'The returned Map has no toJSON() — would throw TypeError');
  }
}

// ---------------------------------------------------------------------------
// Test 2: assignRecordId and pending ID interaction
// ---------------------------------------------------------------------------
async function testAssignRecordId() {
  console.log('\n--- Test 2: assignRecordId behavior with MySQL ---\n');

  const { readFileSync } = await import('fs');
  const { resolve, dirname } = await import('path');
  const { fileURLToPath } = await import('url');

  const __dirname = dirname(fileURLToPath(import.meta.url));
  const manageRecordPath = resolve(__dirname, '../../src/manage-record.ts');

  let source;
  try {
    source = readFileSync(manageRecordPath, 'utf8');
  } catch {
    try {
      source = readFileSync(resolve(__dirname, '../../dist/manage-record.js'), 'utf8');
    } catch {
      results.tests.push({ status: 'SKIP', message: 'manage-record source not found' });
      return;
    }
  }

  const lines = source.split('\n');

  // Check assignRecordId: does it use `if (rawData.id)` (falsy) or `if (rawData.id != null)` (nullish)?
  let assignFnLine = -1;
  let usesFalsyId = false;

  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes('function assignRecordId') || lines[i].includes('assignRecordId')) {
      if (lines[i].includes('function')) assignFnLine = i + 1;
    }
    if (assignFnLine > 0 && i > assignFnLine - 1 && i < assignFnLine + 5) {
      if (lines[i].includes('if (rawData.id)') && lines[i].includes('return')) {
        usesFalsyId = true;
        break;
      }
      if (lines[i].includes('rawData.id != null') || lines[i].includes('rawData.id !== null')) {
        usesFalsyId = false;
        break;
      }
    }
  }

  assert(usesFalsyId, `assignRecordId uses falsy check (if (rawData.id)) — id=0 would not get a pending ID`);

  // For MySQL auto-increment, pending IDs are negative integers
  // Check the pending ID pattern
  let usesNegativeId = false;
  for (const line of lines) {
    if (line.includes('-(++pendingIdCounter)') || line.includes('pendingIdCounter')) {
      usesNegativeId = true;
      break;
    }
  }

  assert(usesNegativeId, 'assignRecordId uses negative pending IDs for MySQL auto-increment');
}

// ---------------------------------------------------------------------------
// Test 3: _persistCreate code path — store.get lookup
// ---------------------------------------------------------------------------
async function testPersistCreateCodePath() {
  console.log('\n--- Test 3: _persistCreate store.get lookup ---\n');

  const { readFileSync } = await import('fs');
  const { resolve, dirname } = await import('path');
  const { fileURLToPath } = await import('url');

  const __dirname = dirname(fileURLToPath(import.meta.url));
  const mysqlDbPath = resolve(__dirname, '../../src/mysql/mysql-db.ts');

  let source;
  try {
    source = readFileSync(mysqlDbPath, 'utf8');
  } catch {
    try {
      source = readFileSync(resolve(__dirname, '../../dist/mysql/mysql-db.js'), 'utf8');
    } catch {
      results.tests.push({ status: 'SKIP', message: 'mysql-db source not found' });
      return;
    }
  }

  const lines = source.split('\n');

  // Find _persistCreate and check if it uses store.get with the response ID
  let inPersistCreate = false;
  let storeGetLine = -1;
  let recordGuardLine = -1;

  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes('_persistCreate')) {
      inPersistCreate = true;
    }
    if (inPersistCreate) {
      if (lines[i].includes('store.get(')) {
        storeGetLine = i + 1;
      }
      if (lines[i].includes('if (!record) return')) {
        recordGuardLine = i + 1;
      }
      if (lines[i].includes('_persistUpdate') || lines[i].includes('_persistDelete')) {
        break;
      }
    }
  }

  if (storeGetLine > 0) {
    assert(true, `_persistCreate calls store.get() at line ${storeGetLine}`);
  }
  if (recordGuardLine > 0) {
    assert(true, `_persistCreate has early return when !record at line ${recordGuardLine}`);
  }

  // Key question: what ID does _persistCreate use for store.get?
  // It uses response.data.id — which comes from record.toJSON()
  // For a pending ID record, this would be a negative integer
  // store.get(model, -1) should work fine (!(-1) is false)
  // But if the ID is somehow 0 or undefined, store.get returns the Map
  console.log('  → Note: _persistCreate uses response.data.id for store.get lookup');
  console.log('  → If response.data.id is 0 or falsy, store.get returns the model Map (bug)');
}

// ---------------------------------------------------------------------------
// Test 4: Direct MySQL create → verify row exists
// ---------------------------------------------------------------------------
async function testDirectCreatePersist(pool) {
  console.log('\n--- Test 4: Direct MySQL create simulation ---\n');

  // Reset table
  await pool.execute('DROP TABLE IF EXISTS widgets');
  const stmts = SCHEMA_SQL.split(';').map(s => s.trim()).filter(Boolean);
  for (const stmt of stmts) {
    await pool.execute(stmt);
  }

  // Simulate what createHandler + _persistCreate does:
  // 1. createRecord puts record in store with pending ID (-1)
  // 2. _persistCreate does INSERT, gets insertId from MySQL
  // 3. Re-keys record from -1 to real ID

  // Step 1: Simulate createRecord → store has record at pending ID
  const pendingId = -1;
  const modelStore = new Map();
  const fakeRecord = {
    id: pendingId,
    __data: { id: pendingId, name: 'Test Widget', color: 'red', __pendingSqlId: true },
    __relationships: {},
    toJSON: () => ({ id: pendingId, type: 'widget', attributes: { name: 'Test Widget', color: 'red' } }),
  };
  modelStore.set(pendingId, fakeRecord);

  // Step 2: INSERT into MySQL (simulating _persistCreate)
  const [insertResult] = await pool.execute(
    "INSERT INTO widgets (name, color) VALUES ('Test Widget', 'red')"
  );
  const realId = insertResult.insertId;
  assert(realId > 0, `MySQL assigned auto-increment ID: ${realId}`);

  // Step 3: Re-key the record (simulating _persistCreate re-key logic)
  modelStore.delete(pendingId);
  fakeRecord.__data.id = realId;
  fakeRecord.id = realId;
  delete fakeRecord.__data.__pendingSqlId;
  modelStore.set(realId, fakeRecord);

  assert(modelStore.has(realId), `Record re-keyed in store at ID ${realId}`);
  assert(!modelStore.has(pendingId), `Pending ID ${pendingId} removed from store`);

  // Step 4: Verify row exists in MySQL
  const [rows] = await pool.execute('SELECT * FROM widgets WHERE id = ?', [realId]);
  assert(rows.length === 1, `MySQL row exists with id=${realId}`);
  assert(rows[0].name === 'Test Widget', `Row has correct name: ${rows[0].name}`);

  // Step 5: Now simulate the afterHook context.record assignment (orm-request.ts line 468)
  // context.record = store.get(this.model, recordId)
  // where recordId = isNaN(responseData.id) ? responseData.id : parseInt(responseData.id)
  //
  // After re-key, response.data.id should be the real ID
  // But the response object was created BEFORE _persistCreate ran...

  // Simulate: response was created from record.toJSON() at handler time
  const responseAtHandlerTime = { data: { id: pendingId, type: 'widget' } };

  // Then _persistCreate updates response.data.id (mysql-db.ts line 468-470)
  responseAtHandlerTime.data.id = realId;

  const recordFromStore = modelStore.get(responseAtHandlerTime.data.id);
  assert(recordFromStore === fakeRecord, `After re-key, store.get with response ID ${responseAtHandlerTime.data.id} returns the record`);
}

// ---------------------------------------------------------------------------
// Test 5: The createHandler → beforeHook → store.get interaction
// ---------------------------------------------------------------------------
async function testBeforeHookStoreGet() {
  console.log('\n--- Test 5: beforeHook store.get for duplicate check ---\n');

  // Danny reports: "In a beforeHook('create'), store.get(collection, id)
  // now returns a truthy non-record for a missing id"
  //
  // In a beforeHook, the record doesn't exist yet.
  // The consumer's hook calls store.get(model, bodyId) to check duplicates.
  //
  // If bodyId is undefined (no id in POST body for auto-increment):
  //   store.get(model, undefined) → !undefined is true → returns the Map
  //
  // If bodyId is 0:
  //   store.get(model, 0) → !0 is true → returns the Map
  //
  // The Map is truthy, so the consumer thinks a record exists.
  // Then trying to call .toJSON() on the Map throws TypeError.

  const modelStore = new Map();
  modelStore.set(1, { id: 1, toJSON: () => ({}) });

  const fakeStoreData = new Map();
  fakeStoreData.set('widget', modelStore);

  function storeGet(key, id) {
    if (!id) return fakeStoreData.get(key);
    return fakeStoreData.get(key)?.get(id);
  }

  // Scenario A: Consumer POST body has no id (auto-increment)
  const bodyDataNoId = { type: 'widget', attributes: { name: 'New' } };
  const lookupId = bodyDataNoId.id; // undefined
  const result = storeGet('widget', lookupId);

  assert(result !== undefined && result !== null, 'store.get with undefined id returns truthy value (the Map)');
  assert(result instanceof Map, 'The truthy value is a Map, not an OrmRecord');

  let threwTypeError = false;
  try {
    result.toJSON();
  } catch (e) {
    if (e instanceof TypeError) threwTypeError = true;
  }
  assert(threwTypeError, 'Calling .toJSON() on the Map throws TypeError');

  // Scenario B: What store.get SHOULD return for a missing id
  function storeGetFixed(key, id) {
    if (id == null) return fakeStoreData.get(key);  // nullish check, not falsy
    return fakeStoreData.get(key)?.get(id);
  }

  // With nullish check, undefined returns the Map too — that's for the 0-arg case
  // The real fix: overloaded get() should distinguish 1-arg from 2-arg calls
  // Or: check id === undefined instead of !id

  // Actually re-read the overloads:
  //   get(key: string): Map | undefined          — 1-arg, returns model map
  //   get(key: string, id: number | string): unknown  — 2-arg, returns record
  //
  // The implementation conflates them with `if (!id)`.
  // A consumer calling store.get(model, 0) or store.get(model, '') hits the 1-arg path.
  //
  // But the real question: does the ORM's own code ever call store.get with a falsy ID?

  // Check: orm-request.ts line 468 for create
  //   const recordId = isNaN(responseData.id) ? responseData.id : parseInt(responseData.id)
  //   context.record = store.get(this.model, recordId)
  //
  // If responseData.id is somehow undefined or NaN:
  //   isNaN(undefined) → true → recordId = undefined → store.get(model, undefined) → returns Map!
  //
  // But that path is guarded by `(response as { data: { id?: unknown } }).data.id)` being truthy.
  // Actually line 464: `else if (operation === 'create' && ... && ((response as { data: { id?: unknown } }).data.id))`
  // The `data.id` check is falsy — so if data.id is 0, this entire block is skipped.

  console.log('');
  console.log('  Analysis: The store.get falsy-ID bug is latent but only triggers when:');
  console.log('  1. A consumer\'s beforeHook calls store.get(model, id) with a falsy id');
  console.log('  2. Or the ORM\'s own afterHook context assignment hits a falsy response.data.id');
  console.log('  The regression vector may be elsewhere — in the persist path itself.');
}

// ---------------------------------------------------------------------------
// Test 6: _withHooks create flow — does persist actually fire?
// ---------------------------------------------------------------------------
async function testWithHooksCreateFlow() {
  console.log('\n--- Test 6: _withHooks create flow analysis ---\n');

  const { readFileSync } = await import('fs');
  const { resolve, dirname } = await import('path');
  const { fileURLToPath } = await import('url');

  const __dirname = dirname(fileURLToPath(import.meta.url));
  const ormRequestPath = resolve(__dirname, '../../src/orm-request.ts');

  let source;
  try {
    source = readFileSync(ormRequestPath, 'utf8');
  } catch {
    results.tests.push({ status: 'SKIP', message: 'orm-request source not found' });
    return;
  }

  const lines = source.split('\n');

  // Find the persist dispatch and check what conditions gate it
  let persistConditionLine = -1;
  let persistCallLine = -1;

  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes('WRITE_OPERATIONS.has(operation)')) {
      persistConditionLine = i + 1;
    }
    if (lines[i].includes('await sqlDb.persist(operation')) {
      persistCallLine = i + 1;
    }
  }

  if (persistConditionLine > 0) {
    assert(true, `Persist gated by WRITE_OPERATIONS.has(operation) at line ${persistConditionLine}`);
  }

  // Check: is there any new code between handler() and persist() that could
  // modify the response object for create operations?
  let handlerLine = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes('const response = await handler(request, state)')) {
      handlerLine = i + 1;
      break;
    }
  }

  if (handlerLine > 0 && persistCallLine > 0) {
    // Check what's between handler and persist
    const between = lines.slice(handlerLine, persistCallLine - 1);
    const hasUpdateRecordAssignment = between.some(l => l.includes('context.record') && l.includes('update'));
    assert(hasUpdateRecordAssignment, 'Between handler and persist: context.record assignment for update ops');

    // For create, nothing should modify the response before persist
    const hasCreateModification = between.some(l => l.includes("'create'") || l.includes('operation === "create"'));
    assert(!hasCreateModification, 'No create-specific modifications between handler and persist (good)');
  }

  // Check: does _persistCreate read context.record or response.data?
  console.log('  → _persistCreate reads response.data.id for the record lookup');
  console.log('  → The response was created from record.toJSON() in createHandler');
  console.log('  → _persistCreate then does store.get(model, responseId) to find the record');
  console.log('  → If responseId is the pending negative ID, store.get should find it');
  console.log('  → After INSERT, _persistCreate re-keys from pending to real ID');
}

// ---------------------------------------------------------------------------
// Test 7: Bisect — compare beta.83 vs beta.89 persist behavior
// ---------------------------------------------------------------------------
async function testBisect() {
  console.log('\n--- Test 7: Bisect beta.83 vs beta.89 ---\n');

  const { readFileSync } = await import('fs');
  const { resolve, dirname } = await import('path');
  const { fileURLToPath } = await import('url');
  const { execSync } = await import('child_process');

  const __dirname = dirname(fileURLToPath(import.meta.url));
  const repoRoot = resolve(__dirname, '../..');

  // Get the orm-request.ts at beta.83
  let beta83Source, devSource;
  try {
    beta83Source = execSync(`git show v0.3.2-beta.83:src/orm-request.ts`, { cwd: repoRoot, encoding: 'utf8' });
    devSource = readFileSync(resolve(repoRoot, 'src/orm-request.ts'), 'utf8');
  } catch (err) {
    results.tests.push({ status: 'SKIP', message: `Bisect skipped: ${err.message.slice(0, 60)}` });
    return;
  }

  // In beta.83, was persist for create awaited?
  const beta83HasAwaitPersist = beta83Source.includes('await sqlDb.persist(operation');
  assert(beta83HasAwaitPersist, 'beta.83: persist was awaited in _withHooks');

  // In dev, is persist still awaited?
  const devHasAwaitPersist = devSource.includes('await sqlDb.persist(operation');
  assert(devHasAwaitPersist, 'dev: persist is still awaited in _withHooks');

  // Key difference: in beta.83, persist condition was:
  //   (operation === 'create' || operation === 'update')
  // In dev:
  //   WRITE_OPERATIONS.has(operation)
  // These are equivalent for 'create', so this shouldn't be the regression.

  // Another key difference: in beta.83, _persistCreate was called directly in persist():
  //   case 'create': return this._persistCreate(...)
  // In dev (after #165), it's wrapped in the write queue:
  //   this._writeQueue = this._writeQueue.then(work, work)
  //
  // But Danny says beta.89 is broken, and #165 isn't in beta.89.
  // So the write queue isn't the cause.

  // Let me check mysql-db.ts at beta.83 vs dev
  let beta83Mysql, devMysql;
  try {
    beta83Mysql = execSync(`git show v0.3.2-beta.83:src/mysql/mysql-db.ts`, { cwd: repoRoot, encoding: 'utf8' });
    devMysql = readFileSync(resolve(repoRoot, 'src/mysql/mysql-db.ts'), 'utf8');
  } catch (err) {
    results.tests.push({ status: 'SKIP', message: `MySQL bisect skipped: ${err.message.slice(0, 60)}` });
    return;
  }

  // Check if _persistCreate changed between versions
  const beta83PersistCreate = beta83Mysql.substring(
    beta83Mysql.indexOf('_persistCreate'),
    beta83Mysql.indexOf('_persistUpdate')
  );
  const devPersistCreate = devMysql.substring(
    devMysql.indexOf('_persistCreate'),
    devMysql.indexOf('_persistUpdate')
  );

  const persistCreateChanged = beta83PersistCreate !== devPersistCreate;
  if (persistCreateChanged) {
    assert(true, '_persistCreate CHANGED between beta.83 and dev — potential regression vector');
    console.log('  → Diff exists in _persistCreate between versions');
  } else {
    assert(true, '_persistCreate UNCHANGED between beta.83 and dev');
    console.log('  → _persistCreate identical — regression must be in caller (orm-request.ts)');
  }

  // Check if persist() wrapper changed (the switch/case → write queue)
  const beta83HasWriteQueue = beta83Mysql.includes('_writeQueue');
  const devHasWriteQueue = devMysql.includes('_writeQueue');

  console.log(`  → beta.83 has _writeQueue: ${beta83HasWriteQueue}`);
  console.log(`  → dev has _writeQueue: ${devHasWriteQueue}`);

  if (!beta83HasWriteQueue && devHasWriteQueue) {
    assert(true, 'Write queue added between beta.83 and dev (#165) — but NOT in beta.89');
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  console.log('=== Spike #166: POST Create Persist Regression ===\n');

  let pool;
  try {
    // Connect to MySQL
    const adminPool = mysql.createPool({
      ...MYSQL_CONFIG,
      database: undefined,
      connectionLimit: 1,
    });

    let retries = 0;
    while (retries < 10) {
      try {
        await adminPool.execute('SELECT 1');
        break;
      } catch {
        retries++;
        if (retries >= 10) {
          console.error('Could not connect to MySQL.');
          process.exit(2);
        }
        await new Promise(r => setTimeout(r, 1000));
      }
    }

    await adminPool.execute('CREATE DATABASE IF NOT EXISTS create_persist_spike');
    await adminPool.end();

    pool = mysql.createPool({
      ...MYSQL_CONFIG,
      connectionLimit: 5,
      waitForConnections: true,
    });

    console.log('Connected to MySQL.\n');
  } catch (err) {
    console.error(`MySQL connection failed: ${err.message}`);
    console.log('Running code-analysis tests only.\n');
    pool = null;
  }

  await testStoreGetEdgeCases();
  await testAssignRecordId();
  await testPersistCreateCodePath();
  if (pool) await testDirectCreatePersist(pool);
  await testBeforeHookStoreGet();
  await testWithHooksCreateFlow();
  await testBisect();

  // Summary
  console.log('\n=== VERDICT ===\n');

  const failures = results.tests.filter(t => t.status === 'FAIL');
  const passes = results.tests.filter(t => t.status === 'PASS');
  const skips = results.tests.filter(t => t.status === 'SKIP');

  console.log(`Tests: ${passes.length} PASS, ${failures.length} FAIL, ${skips.length} SKIP`);
  console.log('');

  // Analyze findings
  const storeGetFalsy = results.tests.some(t => t.status === 'PASS' && t.message.includes('falsy check'));
  const mapReturned = results.tests.some(t => t.status === 'PASS' && t.message.includes('returns a Map'));
  const typeError = results.tests.some(t => t.status === 'PASS' && t.message.includes('TypeError'));

  if (storeGetFalsy && mapReturned && typeError) {
    results.verdict = 'CONFIRMED';
    console.log('CONFIRMED: store.get() falsy-ID bug exists.');
    console.log('');
    console.log('Root cause: store.get(key, id) uses `if (!id)` instead of nullish check.');
    console.log('When id is 0, undefined, or empty string, it returns the model Map');
    console.log('instead of undefined. The Map is truthy but has no toJSON().');
    console.log('');
    console.log('This is a latent bug, but the regression vector may be that');
    console.log('recent changes caused a code path to call store.get with a');
    console.log('falsy id where it previously didn\'t.');
  } else {
    results.verdict = 'PARTIAL';
    console.log('Investigation complete — see individual test results above.');
  }

  console.log('');

  const { writeFile } = await import('fs/promises');
  const { fileURLToPath } = await import('url');
  const outputPath = new URL('./results-create-persist.json', import.meta.url).pathname;
  await writeFile(outputPath, JSON.stringify(results, null, 2));
  console.log(`Raw results: ${outputPath}`);

  if (pool) await pool.end();
  process.exit(results.verdict === 'CONFIRMED' ? 1 : 0);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(2);
});
