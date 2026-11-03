// @ts-nocheck
import QUnit from 'qunit';
import sinon from 'sinon';
import { EventEmitter } from 'events';
import MysqlDB from '../../../src/mysql/mysql-db.js';
import { buildInsert, buildInsertMany, buildUpdate, buildDelete } from '../../../src/mysql/query-builder.js';

const { module, test } = QUnit;

const widgetSchema = {
  table: 'widgets',
  idType: 'number',
  columns: { name: 'VARCHAR(100)', color: 'VARCHAR(100)' },
  foreignKeys: {},
  relationships: { belongsTo: {}, hasMany: {} },
  vectorColumns: {},
  memory: false,
};

function makeWidget(id, data = {}) {
  return { id, __data: { id, ...data }, __relationships: {} };
}

function createHarness({ mysqlConfig = {}, records = [] } = {}) {
  const widgets = new Map(records.map(record => [record.id, record]));
  const executedSql = [];
  let heldQueryGate = null;
  let openHeldQueryGate = () => {};
  let queryFailure = () => null;

  const pool = {
    execute: sinon.stub().callsFake(async (sql, values) => {
      executedSql.push({ sql, values });
      if (heldQueryGate) {
        const gate = heldQueryGate;
        heldQueryGate = null;
        await gate;
      }
      const failure = queryFailure(sql, values);
      if (failure) throw failure;
      return [sql.startsWith('INSERT') ? { insertId: 1000 + executedSql.length * 100 } : { affectedRows: 1 }, null];
    }),
  };

  const fakeProcess = new EventEmitter();
  const deps = {
    getPool: sinon.stub().resolves(pool),
    closePool: sinon.stub().resolves(),
    ensureMigrationsTable: sinon.stub().resolves(),
    getAppliedMigrations: sinon.stub().resolves([]),
    getMigrationFiles: sinon.stub().resolves([]),
    applyMigration: sinon.stub().resolves(),
    parseMigrationFile: sinon.stub(),
    introspectModels: sinon.stub().returns({ widget: widgetSchema }),
    introspectViews: sinon.stub().returns({}),
    getTopologicalOrder: sinon.stub().returns([]),
    schemasToSnapshot: sinon.stub().returns({}),
    loadLatestSnapshot: sinon.stub().resolves({}),
    detectSchemaDrift: sinon.stub().returns({ hasChanges: false }),
    buildInsert,
    buildInsertMany,
    buildUpdate,
    buildDelete,
    buildSelect: sinon.stub().returns({ sql: 'SELECT', values: [] }),
    createRecord: sinon.stub(),
    store: {
      get: sinon.stub().callsFake((_name, id) => (id === undefined ? widgets : widgets.get(id) ?? null)),
      data: new Map([['widget', widgets]]),
      _memoryResolver: null,
    },
    confirm: sinon.stub().resolves(false),
    readFile: sinon.stub().resolves(''),
    getPluralName: sinon.stub().callsFake(name => name + 's'),
    config: { orm: { mysql: { migrationsDir: 'migrations', migrationsTable: '__migrations', ...mysqlConfig } }, rootPath: '/tmp' },
    log: { db: sinon.stub(), warn: sinon.stub(), error: sinon.stub() },
    path: { resolve: sinon.stub().returns('/tmp/migrations'), join: sinon.stub().returns('/tmp/migrations/file') },
    process: fakeProcess,
  };

  const db = new MysqlDB(deps);
  db.pool = pool;

  return {
    db,
    deps,
    pool,
    widgets,
    executedSql,
    fakeProcess,
    holdNextQuery() { heldQueryGate = new Promise(resolve => { openHeldQueryGate = resolve; }); },
    async releaseHeldQuery() {
      await new Promise(resolve => setImmediate(resolve));
      openHeldQueryGate();
    },
    failQueriesWhere(predicate) { queryFailure = predicate; },
  };
}

function persistCreate(db, record) {
  const { id, ...attributes } = record.__data;
  return db.persist('create', 'widget', { rawData: { id, ...attributes } }, { data: { id } });
}

async function settle(promises) {
  return Promise.all(promises.map(promise => promise.then(() => 'fulfilled', error => error)));
}

module('[Unit] MysqlDB — write batching and queue bounds (#309)', function(hooks) {
  hooks.beforeEach(function() {
    MysqlDB.instance = undefined;
  });

  hooks.afterEach(function() {
    MysqlDB.instance = undefined;
    sinon.restore();
  });

  test('a burst of creates queued behind an in-flight write lands in one multi-row insert', async function(assert) {
    const burstSize = 50;
    const records = Array.from({ length: burstSize }, (_, index) => makeWidget(index + 1, { name: `widget-${index + 1}` }));
    const harness = createHarness({ records });

    harness.holdNextQuery();
    const inFlightWrite = harness.db.persist('delete', 'widget', { recordId: 999 }, {});
    const queuedCreates = records.map(record => persistCreate(harness.db, record));
    await harness.releaseHeldQuery();
    await Promise.all([inFlightWrite, ...queuedCreates]);

    const insertQueries = harness.executedSql.filter(({ sql }) => sql.startsWith('INSERT'));
    assert.strictEqual(insertQueries.length, 1, `${burstSize} queued creates use one insert round trip`);
    assert.deepEqual(
      insertQueries[0].values.filter(value => typeof value === 'string'),
      records.map(record => record.__data.name),
      'every queued create is in the insert, in queue order',
    );
  });

  test('a batch never exceeds the configured writeBatchSize', async function(assert) {
    const records = Array.from({ length: 10 }, (_, index) => makeWidget(index + 1, { name: `widget-${index + 1}` }));
    const harness = createHarness({ records, mysqlConfig: { writeBatchSize: 4 } });

    harness.holdNextQuery();
    const inFlightWrite = harness.db.persist('delete', 'widget', { recordId: 999 }, {});
    const queuedCreates = records.map(record => persistCreate(harness.db, record));
    await harness.releaseHeldQuery();
    await Promise.all([inFlightWrite, ...queuedCreates]);

    const insertRowCounts = harness.executedSql
      .filter(({ sql }) => sql.startsWith('INSERT'))
      .map(({ sql }) => (sql.match(/\),\s*\(/g)?.length ?? 0) + 1);
    assert.deepEqual(insertRowCounts, [4, 4, 2], 'ten creates split into batches of at most four');
  });

  test('a batch is split so no insert exceeds the MySQL prepared statement placeholder limit', async function(assert) {
    const burstSize = 25000;
    const records = Array.from({ length: burstSize }, (_, index) => makeWidget(index + 1, { name: `n${index}`, color: 'red' }));
    const harness = createHarness({ records, mysqlConfig: { writeBatchSize: burstSize, writeQueueLimit: burstSize } });

    harness.holdNextQuery();
    const inFlightWrite = harness.db.persist('delete', 'widget', { recordId: 999 }, {});
    const queuedCreates = records.map(record => persistCreate(harness.db, record));
    await harness.releaseHeldQuery();
    await Promise.all([inFlightWrite, ...queuedCreates]);

    const insertQueries = harness.executedSql.filter(({ sql }) => sql.startsWith('INSERT'));
    assert.ok(insertQueries.length > 1, 'the burst needed more than one insert');
    assert.ok(insertQueries.every(({ values }) => values.length <= 65535), 'every insert binds at most 65535 parameters');
    assert.strictEqual(insertQueries.reduce((total, { values }) => total + values.length, 0), burstSize * 3, 'every value was bound exactly once');
  });

  test('rows missing a column use DEFAULT rather than binding NULL', async function(assert) {
    const records = [makeWidget(1, { name: 'a', color: 'red' }), makeWidget(2, { name: 'b' })];
    const harness = createHarness({ records });

    harness.holdNextQuery();
    const inFlightWrite = harness.db.persist('delete', 'widget', { recordId: 999 }, {});
    const queuedCreates = records.map(record => persistCreate(harness.db, record));
    await harness.releaseHeldQuery();
    await Promise.all([inFlightWrite, ...queuedCreates]);

    const [insert] = harness.executedSql.filter(({ sql }) => sql.startsWith('INSERT'));
    assert.strictEqual(insert.sql, 'INSERT INTO `widgets` (`id`, `name`, `color`) VALUES (?, ?, ?), (?, ?, DEFAULT)');
    assert.deepEqual(insert.values, [1, 'a', 'red', 2, 'b']);
  });

  test('pending ids in a batch are re-keyed consecutively from the first insertId, in row order', async function(assert) {
    const records = [makeWidget('pending-1', { name: 'a' }), makeWidget('pending-2', { name: 'b' })];
    const harness = createHarness({ records });

    harness.holdNextQuery();
    const inFlightWrite = harness.db.persist('delete', 'widget', { recordId: 999 }, {});
    const responses = records.map(record => ({ data: { id: record.id } }));
    const queuedCreates = records.map((record, index) => harness.db.persist(
      'create', 'widget', { rawData: { name: record.__data.name, __pendingSqlId: true } }, responses[index],
    ));
    await harness.releaseHeldQuery();
    await Promise.all([inFlightWrite, ...queuedCreates]);

    const [insert] = harness.executedSql.filter(({ sql }) => sql.startsWith('INSERT'));
    assert.false(insert.sql.includes('`id`,'), 'pending ids are not inserted');
    assert.deepEqual(responses.map(response => response.data.id), [1200, 1201], 'responses carry the generated ids');
    assert.deepEqual([...harness.widgets.keys()].sort(), [1200, 1201], 'store is re-keyed to the generated ids');
    assert.deepEqual(records.map(record => record.id), [1200, 1201], 'records carry the generated ids');
  });

  test('pending-id creates are never batched with explicit-id creates, so insertId maps to the right rows', async function(assert) {
    const records = [
      makeWidget('pending-1', { name: 'a' }),
      makeWidget(7, { name: 'b' }),
      makeWidget('pending-2', { name: 'c' }),
      makeWidget('pending-3', { name: 'd' }),
    ];
    const harness = createHarness({ records });

    harness.holdNextQuery();
    const inFlightWrite = harness.db.persist('delete', 'widget', { recordId: 999 }, {});
    const responses = records.map(record => ({ data: { id: record.id } }));
    const queuedCreates = records.map((record, index) => {
      const isPending = typeof record.id === 'string';
      const rawData = isPending ? { name: record.__data.name, __pendingSqlId: true } : { id: record.id, name: record.__data.name };
      return harness.db.persist('create', 'widget', { rawData }, responses[index]);
    });
    await harness.releaseHeldQuery();
    await Promise.all([inFlightWrite, ...queuedCreates]);

    const insertRowCounts = harness.executedSql
      .filter(({ sql }) => sql.startsWith('INSERT'))
      .map(({ sql }) => (sql.match(/\),\s*\(/g)?.length ?? 0) + 1);
    assert.deepEqual(insertRowCounts, [1, 1, 2], 'the explicit-id create splits the pending-id run');
    assert.deepEqual(responses.map(response => response.data.id), [1200, 7, 1400, 1401], 'each pending row gets its own generated id');
  });

  test('a record\'s create and its following update execute in enqueue order and are never merged', async function(assert) {
    const first = makeWidget(1, { name: 'first' });
    const second = makeWidget(2, { name: 'second' });
    const harness = createHarness({ records: [first, second] });

    harness.holdNextQuery();
    const inFlightWrite = harness.db.persist('delete', 'widget', { recordId: 999 }, {});
    const createFirst = persistCreate(harness.db, first);
    first.__data.name = 'renamed';
    const updateFirst = harness.db.persist('update', 'widget', { record: first, oldState: { name: 'first' } }, {});
    const createSecond = persistCreate(harness.db, second);
    await harness.releaseHeldQuery();
    await Promise.all([inFlightWrite, createFirst, updateFirst, createSecond]);

    assert.deepEqual(harness.executedSql.map(({ sql }) => sql.split(' ')[0]), ['DELETE', 'INSERT', 'UPDATE', 'INSERT'],
      'the update runs after its own create and before the next create');
    assert.strictEqual(harness.executedSql[1].values[0], 1, 'the first insert is the updated record\'s create');
    assert.strictEqual(harness.executedSql[2].values.at(-1), 1, 'the update targets that record');
    assert.strictEqual(harness.executedSql[3].values[0], 2, 'the later create is a separate insert');
  });

  test('a rejected batch retries each row alone so siblings land and only the bad row rejects', async function(assert) {
    const records = Array.from({ length: 5 }, (_, index) => makeWidget(index + 1, { name: index === 2 ? 'bad' : `widget-${index + 1}` }));
    const harness = createHarness({ records });
    const rowError = new Error('value too long for type character varying(100)');
    harness.failQueriesWhere((sql, values) => (sql.startsWith('INSERT') && values.includes('bad') ? rowError : null));

    harness.holdNextQuery();
    const inFlightWrite = harness.db.persist('delete', 'widget', { recordId: 999 }, {});
    const queuedCreates = records.map(record => persistCreate(harness.db, record));
    await harness.releaseHeldQuery();
    const outcomes = await settle([inFlightWrite, ...queuedCreates]);

    assert.deepEqual(outcomes, ['fulfilled', 'fulfilled', 'fulfilled', rowError, 'fulfilled', 'fulfilled'],
      'only the bad row\'s persist rejects, with its own error');
    const singleRowInserts = harness.executedSql.filter(({ sql }) => sql.startsWith('INSERT') && !sql.includes('), ('));
    assert.deepEqual(singleRowInserts.map(({ values }) => values[0]), [1, 2, 3, 4, 5], 'every sibling was retried on its own');
  });

  test('a create group that throws before its insert rejects every write in it and the queue keeps draining', async function(assert) {
    const records = [makeWidget(1, { name: 'a' }), makeWidget(2, { name: 'b' })];
    const harness = createHarness({ records });
    const schemaError = new Error('model introspection failed');
    harness.deps.introspectModels.onSecondCall().throws(schemaError);

    harness.holdNextQuery();
    const inFlightWrite = harness.db.persist('delete', 'widget', { recordId: 999 }, {});
    const queuedCreates = records.map(record => persistCreate(harness.db, record));
    const laterDelete = harness.db.persist('delete', 'widget', { recordId: 998 }, {});
    await harness.releaseHeldQuery();
    const outcomes = await settle([inFlightWrite, ...queuedCreates, laterDelete]);

    assert.deepEqual(outcomes, ['fulfilled', schemaError, schemaError, 'fulfilled'], 'the failed group rejects and the next write still runs');
    assert.strictEqual(harness.db.pendingWriteCount, 0, 'no write is left in flight');
  });

  test('an insert whose SQL cannot be built rejects its writes instead of leaving them pending', async function(assert) {
    const records = [makeWidget(1, { name: 'a' }), makeWidget(2, { name: 'b' })];
    const harness = createHarness({ records });
    harness.deps.introspectModels.returns({ widget: { ...widgetSchema, table: 'bad table' }, gadget: { ...widgetSchema, table: 'gadgets' } });

    harness.holdNextQuery();
    const inFlightWrite = harness.db.persist('delete', 'gadget', { recordId: 999 }, {});
    const queuedCreates = records.map(record => persistCreate(harness.db, record));
    await harness.releaseHeldQuery();
    const outcomes = await settle([inFlightWrite, ...queuedCreates]);

    assert.strictEqual(outcomes[0], 'fulfilled');
    assert.true(outcomes.slice(1).every(outcome => /Invalid SQL table name/.test(outcome?.message)), 'each create rejects with the build error');
    assert.strictEqual(harness.db.pendingWriteCount, 0, 'no write is left in flight');
  });

  test('writes beyond writeQueueLimit are rejected while the queue is full, then accepted once it drains', async function(assert) {
    const records = Array.from({ length: 5 }, (_, index) => makeWidget(index + 1, { name: `widget-${index + 1}` }));
    const harness = createHarness({ records, mysqlConfig: { writeQueueLimit: 3 } });

    harness.holdNextQuery();
    const inFlightWrite = harness.db.persist('delete', 'widget', { recordId: 999 }, {});
    await Promise.resolve();
    const queuedCreates = records.slice(0, 4).map(record => persistCreate(harness.db, record));
    const overflow = await Promise.race([
      settle(queuedCreates.slice(3)),
      new Promise(resolve => setTimeout(() => resolve(['still queued']), 200)),
    ]);

    assert.strictEqual(overflow[0]?.name, 'WriteQueueFullError', 'the fourth queued write is rejected');
    assert.true(/writeQueueLimit/.test(overflow[0]?.message), 'the error names the setting');
    assert.strictEqual(harness.db.pendingWriteCount, 4, 'one write in flight and three queued, nothing beyond the limit');

    await harness.releaseHeldQuery();
    await settle([inFlightWrite, ...queuedCreates.slice(0, 3)]);
    await persistCreate(harness.db, records[4]);
    assert.strictEqual(harness.db.pendingWriteCount, 0, 'the queue drained and accepted a new write');
  });

  test('the default queue limit is finite', async function(assert) {
    const harness = createHarness();
    assert.true(Number.isFinite(harness.db.writeQueueLimit) && harness.db.writeQueueLimit > 0);
    assert.true(Number.isFinite(harness.db.writeBatchSize) && harness.db.writeBatchSize > 1);
  });

  test('process exit with writes still queued is reported as a loss, per model', async function(assert) {
    const records = Array.from({ length: 3 }, (_, index) => makeWidget(index + 1, { name: `widget-${index + 1}` }));
    const harness = createHarness({ records });
    await harness.db.init();

    harness.holdNextQuery();
    harness.db.persist('delete', 'widget', { recordId: 999 }, {}).catch(() => {});
    records.forEach(record => persistCreate(harness.db, record).catch(() => {}));
    await new Promise(resolve => setImmediate(resolve));

    harness.fakeProcess.emit('exit', 1);

    assert.true(harness.deps.log.error.calledOnce, 'one error is logged on exit');
    const [message] = harness.deps.log.error.firstCall.args;
    assert.true(message.includes('4 queued write(s)'), `message counts in-flight and queued writes: ${message}`);
    assert.true(message.includes('widget: 4'), 'message breaks the loss down by model');
  });

  test('process exit with an empty queue reports nothing', async function(assert) {
    const harness = createHarness();
    await harness.db.init();
    harness.fakeProcess.emit('exit', 0);
    assert.true(harness.deps.log.error.notCalled);
  });

  test('shutdown drains queued writes before closing the pool and refuses writes after it begins', async function(assert) {
    const records = Array.from({ length: 3 }, (_, index) => makeWidget(index + 1, { name: `widget-${index + 1}` }));
    const harness = createHarness({ records });
    await harness.db.init();

    harness.holdNextQuery();
    const inFlightWrite = harness.db.persist('delete', 'widget', { recordId: 999 }, {});
    const queuedCreates = records.map(record => persistCreate(harness.db, record));
    await new Promise(resolve => setImmediate(resolve));

    const shutdown = harness.db.shutdown();
    const lateWrite = await settle([harness.db.persist('delete', 'widget', { recordId: 5 }, {})]);
    assert.strictEqual(lateWrite[0].name, 'WriteQueueClosedError', 'a write after shutdown began is rejected');
    assert.true(harness.deps.closePool.notCalled, 'the pool stays open while writes are queued');

    await harness.releaseHeldQuery();
    await shutdown;
    await Promise.all([inFlightWrite, ...queuedCreates]);

    assert.strictEqual(harness.executedSql.filter(({ sql }) => sql.startsWith('INSERT')).length, 1, 'queued creates were written');
    assert.true(harness.deps.closePool.calledOnce, 'the pool closes after the queue drained');
    assert.strictEqual(harness.fakeProcess.listenerCount('exit'), 0, 'the exit report is unregistered after a clean shutdown');
  });

  test('init after shutdown accepts writes again', async function(assert) {
    const harness = createHarness({ records: [makeWidget(1, { name: 'a' })] });
    await harness.db.init();
    await harness.db.shutdown();
    await harness.db.init();
    await persistCreate(harness.db, harness.widgets.get(1));
    assert.strictEqual(harness.executedSql.filter(({ sql }) => sql.startsWith('INSERT')).length, 1);
    assert.strictEqual(harness.fakeProcess.listenerCount('exit'), 1, 'exactly one exit report is registered');
  });
});
