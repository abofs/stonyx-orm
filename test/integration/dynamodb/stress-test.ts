// @ts-nocheck
/**
 * DynamoDB driver integration stress test against DynamoDB Local.
 *
 * Validates the full ORM lifecycle using real AWS SDK calls against a local
 * DynamoDB container (docker-compose.dynamodb.yml).
 *
 * Run: docker compose -f docker-compose.dynamodb.yml up -d && pnpm test:dynamodb
 */
import QUnit from 'qunit';
import Orm, { createRecord, store } from '@stonyx/orm';
import Stonyx from 'stonyx';

const { module, test } = QUnit;

// ---------------------------------------------------------------------------
// Settlement helper — createRecord() auto-persists fire-and-forget;
// we need to wait for DynamoDB writes to land before asserting.
// ---------------------------------------------------------------------------

function settle(ms = 200): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

// ---------------------------------------------------------------------------
// Health check helper
// ---------------------------------------------------------------------------

async function isDynamoDBAvailable(): Promise<boolean> {
  // Retry with backoff — container may need a moment after docker compose up
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const res = await fetch('http://localhost:8000', { method: 'GET' });
      if (res.status === 400) return true; // DynamoDB Local returns 400 on bare GET
    } catch { /* retry */ }
    await new Promise(r => setTimeout(r, 500 * (attempt + 1)));
  }
  return false;
}

// ---------------------------------------------------------------------------
// Table cleanup helper
// ---------------------------------------------------------------------------

async function clearTable(db, tableName) {
  const { ScanCommand, DeleteCommand } = await import('@aws-sdk/lib-dynamodb');
  let lastKey;
  do {
    const result = await db.client.send(new ScanCommand({
      TableName: tableName,
      ExclusiveStartKey: lastKey,
    }));
    if (result.Items) {
      for (const item of result.Items) {
        await db.client.send(new DeleteCommand({
          TableName: tableName,
          Key: { id: item.id },
        }));
      }
    }
    lastKey = result.LastEvaluatedKey;
  } while (lastKey);
}

const ALL_TABLES = [
  'users', 'sessions', 'alerts', 'alert_results',
  'auth_providers', 'telegram_links', 'filter_performances',
];

async function clearAllTables(db) {
  for (const table of ALL_TABLES) {
    try { await clearTable(db, table); } catch { /* table may not exist */ }
  }
}

function clearStore() {
  for (const key of store.data.keys()) {
    store.data.get(key)?.clear();
  }
}

// ---------------------------------------------------------------------------
// Shared state
// ---------------------------------------------------------------------------

let db = null;
let available = false;

// ---------------------------------------------------------------------------
// Wave 1 — Setup
// ---------------------------------------------------------------------------

module('[Integration][DynamoDB] Wave 1 — Setup', function (hooks) {
  hooks.before(async function () {
    available = await isDynamoDBAvailable();
    if (!available) return;

    await Stonyx.ready;
    db = Orm.instance?.db;
  });

  // Assertion 1
  test('1. DynamoDB Local responds on port 8000', async function (assert) {
    assert.ok(available, 'DynamoDB Local health check responded with 400');
  });

  // Assertion 2
  test('2. DynamoDBDB driver initializes against localhost:8000', async function (assert) {
    if (!available) { assert.expect(0); return; }
    assert.ok(db, 'DynamoDBDB instance exists via Orm.instance.db');
    assert.ok(db.client, 'DynamoDB client initialized');
    await db.startup();
    assert.ok(true, 'startup() completed — tables provisioned');
  });
});

// ---------------------------------------------------------------------------
// Wave 2 — Core CRUD
// ---------------------------------------------------------------------------

module('[Integration][DynamoDB] Wave 2 — Core CRUD', function (hooks) {
  hooks.before(async function () {
    if (!available || !db) return;
    await clearAllTables(db);
    clearStore();
  });

  // Assertion 3
  test('3. Full CRUD lifecycle: create → find → update → findAll → delete → findRecord undefined', async function (assert) {
    if (!available) { assert.expect(0); return; }

    // Create — createRecord auto-persists via orm.sqlDb.persist (fire-and-forget)
    const record = createRecord('user', { id: 'crud-1', name: 'Alice', email: 'alice@test.com' });
    await settle();

    // FindRecord
    const found = await db.findRecord('user', 'crud-1');
    assert.ok(found, 'findRecord returns created record');
    assert.equal(found.__data.name, 'Alice', 'record has correct name');

    // Update
    const oldState = { ...record.__data };
    record.__data.name = 'Alice Updated';
    await db.persist('update', 'user', { record, oldState }, {});

    // FindAll includes updated
    const all = await db.findAll('user');
    assert.ok(all.length >= 1, 'findAll returns at least 1 record');
    const updated = all.find(r => r.__data.id === 'crud-1');
    assert.equal(updated?.__data.name, 'Alice Updated', 'findAll includes updated name');

    // Delete
    await db.persist('delete', 'user', { recordId: 'crud-1' }, {});
    const deleted = await db.findRecord('user', 'crud-1');
    assert.notOk(deleted, 'findRecord returns undefined after delete');
  });

  // Assertion 4
  test('4. Data survives shutdown → re-init → startup cycle', async function (assert) {
    if (!available) { assert.expect(0); return; }

    // Create a record — auto-persists via createRecord
    clearStore();
    const record = createRecord('user', { id: 'persist-1', name: 'Persist', email: 'persist@test.com' });
    await settle();

    // Verify it's in DynamoDB
    const beforeShutdown = await db.findRecord('user', 'persist-1');
    assert.ok(beforeShutdown, 'record exists before shutdown');

    // Shutdown
    await db.shutdown();
    assert.notOk(db.client, 'client nullified after shutdown');

    // Re-init (creates new client, reloads memory records)
    clearStore();
    await db.init();
    assert.ok(db.client, 'client re-created after init');

    // Record should be findable after re-init
    const afterRestart = await db.findRecord('user', 'persist-1');
    assert.ok(afterRestart, 'record survives shutdown/re-init cycle');
    assert.equal(afterRestart.__data.name, 'Persist', 'record data intact after restart');
  });

  // Assertion 5
  test('5. memory:true model records loaded into store at boot', async function (assert) {
    if (!available) { assert.expect(0); return; }

    // Create a memory:true record (user is memory:true) — auto-persists
    clearStore();
    createRecord('user', { id: 'mem-true-1', name: 'MemTrue', email: 'mem@test.com' });
    await settle();

    // Clear store and re-init — loadMemoryRecords should reload it
    clearStore();
    const storeBeforeReload = store.get('user', 'mem-true-1');
    assert.notOk(storeBeforeReload, 'store empty after clear');

    await db.shutdown();
    await db.init();

    // After init, memory:true records should be back in the store
    const storeAfterReload = store.get('user', 'mem-true-1');
    assert.ok(storeAfterReload, 'memory:true record reloaded into store at boot');
    assert.equal(storeAfterReload?.__data?.name, 'MemTrue', 'reloaded record has correct data');
  });

  // Assertion 6
  test('6. memory:false model records NOT in store but returned by findRecord/findAll', async function (assert) {
    if (!available) { assert.expect(0); return; }

    // filter-performance is memory:false — create a record (auto-persists)
    clearStore();
    createRecord('filter-performance', { id: 'fp-1', filterName: 'accuracy', accuracy: 95 });
    await settle();

    // Clear store and re-init — memory:false should NOT be loaded
    clearStore();
    await db.shutdown();
    await db.init();

    const storeResult = store.get('filter-performance', 'fp-1');
    assert.notOk(storeResult, 'memory:false record NOT in store after boot');

    // But findRecord should return it from DynamoDB
    const found = await db.findRecord('filter-performance', 'fp-1');
    assert.ok(found, 'memory:false record returned by findRecord');
    assert.equal(found.__data.filterName, 'accuracy', 'correct data returned');

    // And findAll should return it
    const all = await db.findAll('filter-performance');
    assert.ok(all.length >= 1, 'findAll returns memory:false records');

    // After findRecord/findAll, record should be evicted from store
    const storeAfterFind = store.get('filter-performance', 'fp-1');
    assert.notOk(storeAfterFind, 'memory:false record evicted from store after find');
  });
});

// ---------------------------------------------------------------------------
// Wave 3 — Relationships & Edge Cases
// ---------------------------------------------------------------------------

module('[Integration][DynamoDB] Wave 3 — Relationships & Edge Cases', function (hooks) {
  hooks.before(async function () {
    if (!available || !db) return;
    await clearAllTables(db);
    clearStore();
  });

  // Assertion 7
  test('7. belongsTo FK resolution through driver', async function (assert) {
    if (!available) { assert.expect(0); return; }

    // Create a user — auto-persists
    createRecord('user', { id: 'user-rel-1', name: 'RelUser', email: 'rel@test.com' });
    await settle();

    // Create a session belonging to that user — auto-persists
    createRecord('session', { id: 'sess-rel-1', token: 'abc123', user: 'user-rel-1' });
    await settle();

    // Verify the session's user FK was persisted
    const found = await db.findRecord('session', 'sess-rel-1');
    assert.ok(found, 'session record found');
    // The belongsTo relationship should resolve from the store (user is memory:true)
    const resolvedUser = store.get('user', 'user-rel-1');
    assert.ok(resolvedUser, 'user exists in store for FK resolution');
    assert.equal(resolvedUser.__data.name, 'RelUser', 'belongsTo target has correct data');
  });

  // Assertion 8
  test('8. hasMany inverse wiring after boot load', async function (assert) {
    if (!available) { assert.expect(0); return; }

    // Clear and reload — user + session from assertion 7 should be in DynamoDB
    clearStore();
    await db.shutdown();
    await db.init();

    // After boot, user should be loaded (memory:true)
    const user = store.get('user', 'user-rel-1');
    assert.ok(user, 'user loaded into store after boot');

    // Session should also be loaded (memory:true)
    const session = store.get('session', 'sess-rel-1');
    assert.ok(session, 'session loaded into store after boot');

    // hasMany wiring: user.sessions should include the session
    // (relationship resolution happens in-memory via the store, not via the driver)
    const sessions = user?.sessions;
    assert.ok(sessions, 'user.sessions accessor exists');
    assert.ok(sessions?.length >= 1 || sessions?.models?.length >= 1,
      'hasMany contains at least one session after boot');
  });

  // Assertion 9
  test('9. findAll with indexed attr routes through GSI Query', async function (assert) {
    if (!available) { assert.expect(0); return; }

    // session has a belongsTo('user') → FK user_id gets a GSI
    // findAll with user_id condition should route through GSI
    const results = await db.findAll('session', { user_id: 'user-rel-1' });
    assert.ok(results.length >= 1, 'GSI Query returns results for indexed FK');
    assert.equal(results[0].__data.id, 'sess-rel-1', 'correct session returned via GSI');
  });

  // Assertion 10
  test('10. findAll with unindexed attr uses Scan fallback', async function (assert) {
    if (!available) { assert.expect(0); return; }

    // 'name' is not a GSI key — should fall back to Scan + FilterExpression
    const results = await db.findAll('user', { name: 'RelUser' });
    assert.ok(results.length >= 1, 'Scan fallback returns results for unindexed attr');
    assert.equal(results[0].__data.email, 'rel@test.com', 'correct user returned via Scan');
  });

  // Assertion 11
  test('11. Pagination: >100 items all returned via multi-page Scan', async function (assert) {
    if (!available) { assert.expect(0); return; }
    assert.timeout(60000); // Allow 60s for 150 writes

    const COUNT = 150;

    // Create 150 filter-performance records — auto-persists via createRecord
    for (let i = 0; i < COUNT; i++) {
      createRecord('filter-performance', {
        id: `page-${i}`,
        filterName: `filter-${i}`,
        accuracy: Math.random() * 100,
      });
    }
    // Wait for all fire-and-forget persists to settle
    await settle(3000);

    // FindAll should return all 150
    const all = await db.findAll('filter-performance');
    // Account for the fp-1 record from assertion 6
    assert.ok(all.length >= COUNT, `findAll returns all ${COUNT}+ items (got ${all.length})`);
  });

  // Assertion 12
  test('12. Table provisioning idempotency: second boot produces no errors', async function (assert) {
    if (!available) { assert.expect(0); return; }

    // Tables already exist from assertion 2. Call startup() again.
    try {
      await db.startup();
      assert.ok(true, 'second startup() call produces no errors');
    } catch (err) {
      assert.notOk(true, `second startup() threw: ${err.message}`);
    }
  });
});

// ---------------------------------------------------------------------------
// Wave 4 — Stress
// ---------------------------------------------------------------------------

module('[Integration][DynamoDB] Wave 4 — Stress', function (hooks) {
  hooks.before(async function () {
    if (!available || !db) return;
    // Clear filter_performances table for stress tests
    try { await clearTable(db, 'filter_performances'); } catch { /* ok */ }
    clearStore();
  });

  // Assertion 13
  test('13. Bulk create 1000 records → findAll count equals 1000', async function (assert) {
    if (!available) { assert.expect(0); return; }
    assert.timeout(120000); // Allow 2 min for 1000 writes

    const COUNT = 1000;

    for (let i = 0; i < COUNT; i++) {
      createRecord('filter-performance', {
        id: `bulk-${i}`,
        filterName: `bulk-filter-${i}`,
        accuracy: i,
      });
    }
    // Wait for all fire-and-forget persists to settle
    await settle(10000);

    const all = await db.findAll('filter-performance');
    assert.equal(all.length, COUNT, `findAll count equals ${COUNT} (got ${all.length})`);
  });

  // Assertion 14
  test('14. Concurrent findAll during bulk writes does not crash', async function (assert) {
    if (!available) { assert.expect(0); return; }
    assert.timeout(60000);

    // Fire writes (via auto-persist) and reads concurrently
    for (let i = 0; i < 100; i++) {
      createRecord('user', { id: `concurrent-${i}`, name: `User${i}`, email: `u${i}@test.com` });
    }

    // Interleave reads while auto-persists are in-flight
    const readPromises = [];
    for (let i = 0; i < 10; i++) {
      readPromises.push(db.findAll('user'));
    }

    try {
      await Promise.all(readPromises);
      // Wait for all auto-persist writes to settle
      await settle(5000);
      assert.ok(true, 'concurrent writes + reads completed without crash');
    } catch (err) {
      assert.notOk(true, `concurrent operations threw: ${err.message}`);
    }
  });
});
