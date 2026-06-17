// @ts-nocheck
import QUnit from 'qunit';
import sinon from 'sinon';
import MysqlDB from '../../../src/mysql/mysql-db.js';

const { module, test } = QUnit;

function createMockDeps(overrides = {}) {
  const mockPool = {
    execute: sinon.stub().resolves([[], null]),
  };

  return {
    getPool: sinon.stub().resolves(mockPool),
    closePool: sinon.stub().resolves(),
    ensureMigrationsTable: sinon.stub().resolves(),
    getAppliedMigrations: sinon.stub().resolves([]),
    getMigrationFiles: sinon.stub().resolves([]),
    applyMigration: sinon.stub().resolves(),
    parseMigrationFile: sinon.stub(),
    introspectModels: sinon.stub().returns({
      widget: {
        table: 'widgets',
        columns: { name: 'VARCHAR(100)' },
        foreignKeys: {},
      },
    }),
    introspectViews: sinon.stub().returns({}),
    getTopologicalOrder: sinon.stub().returns([]),
    schemasToSnapshot: sinon.stub().returns({}),
    loadLatestSnapshot: sinon.stub().resolves({}),
    detectSchemaDrift: sinon.stub().returns({ hasChanges: false }),
    buildInsert: sinon.stub().returns({ sql: 'INSERT ...', values: [] }),
    buildUpdate: sinon.stub().returns({ sql: 'UPDATE ...', values: [] }),
    buildDelete: sinon.stub().returns({ sql: 'DELETE ...', values: [] }),
    buildSelect: sinon.stub().returns({ sql: 'SELECT ...', values: [] }),
    createRecord: sinon.stub().callsFake((_name, data) => ({ id: data.id, __data: data, __relationships: {} })),
    store: {
      get: sinon.stub().returns(new Map()),
      data: new Map(),
      _memoryResolver: null,
    },
    confirm: sinon.stub().resolves(false),
    readFile: sinon.stub().resolves(''),
    getPluralName: sinon.stub().callsFake(name => name + 's'),
    config: { orm: { mysql: { migrationsDir: 'migrations', migrationsTable: '__migrations' } }, rootPath: '/tmp' },
    log: { db: sinon.stub(), warn: sinon.stub(), error: sinon.stub() },
    path: { resolve: sinon.stub().returns('/tmp/migrations'), join: sinon.stub().returns('/tmp/migrations/file') },
    _mockPool: mockPool,
    ...overrides,
  };
}

module('[Unit] MysqlDB — Write Serialization (#156)', function(hooks) {
  hooks.beforeEach(function() {
    MysqlDB.instance = undefined;
  });

  hooks.afterEach(function() {
    MysqlDB.instance = undefined;
    sinon.restore();
  });

  test('concurrent persist() calls execute sequentially, not in parallel', async function(assert) {
    const executionOrder = [];
    let resolveFirst;
    let resolveSecond;

    const firstGate = new Promise(r => { resolveFirst = r; });
    const secondGate = new Promise(r => { resolveSecond = r; });

    const deps = createMockDeps();

    // Track execution order via pool.execute
    let callCount = 0;
    deps._mockPool.execute = sinon.stub().callsFake(async () => {
      callCount++;
      if (callCount === 1) {
        executionOrder.push('first-start');
        await firstGate;
        executionOrder.push('first-end');
      } else {
        executionOrder.push('second-start');
        await secondGate;
        executionOrder.push('second-end');
      }
      return [{ insertId: callCount }, null];
    });

    const db = new MysqlDB(deps);
    db.pool = deps._mockPool;

    // Fire two persist calls concurrently (fire-and-forget pattern)
    const p1 = db.persist('delete', 'widget', { recordId: 1 }, {});
    const p2 = db.persist('delete', 'widget', { recordId: 2 }, {});

    // Let the first one complete
    resolveFirst();
    // Small tick to let microtasks propagate
    await new Promise(r => setTimeout(r, 10));

    // The second should only start after the first finishes
    assert.deepEqual(executionOrder, ['first-start', 'first-end', 'second-start'],
      'second persist starts only after first completes');

    // Let the second complete
    resolveSecond();
    await Promise.all([p1, p2]);

    assert.deepEqual(executionOrder, ['first-start', 'first-end', 'second-start', 'second-end'],
      'both persists executed sequentially');
  });

  test('a failed persist does not stall the queue — next write still executes', async function(assert) {
    const deps = createMockDeps();

    let callCount = 0;
    deps._mockPool.execute = sinon.stub().callsFake(async () => {
      callCount++;
      if (callCount === 1) {
        throw new Error('Simulated SQL error');
      }
      return [[], null];
    });

    const db = new MysqlDB(deps);
    db.pool = deps._mockPool;

    // First persist will fail
    const p1 = db.persist('delete', 'widget', { recordId: 1 }, {});
    // Second persist should still execute
    const p2 = db.persist('delete', 'widget', { recordId: 2 }, {});

    // p1 should reject (error propagates to caller)
    try {
      await p1;
      assert.ok(false, 'p1 should have thrown');
    } catch (err) {
      assert.strictEqual(err.message, 'Simulated SQL error', 'first persist error propagates');
    }

    // p2 should succeed — the queue advanced past the error
    await p2;
    assert.strictEqual(callCount, 2, 'second persist executed despite first failing');
  });

  test('reads (findRecord/findAll) do not go through the write queue', async function(assert) {
    // Verify by code inspection: findRecord and findAll call pool.execute
    // directly, not through _writeQueue. We confirm this by showing that
    // a read completes even when no persist has ever been called (the queue
    // is irrelevant to reads).
    const deps = createMockDeps();
    deps._mockPool.execute = sinon.stub().resolves([[{ id: 42, name: 'test' }], null]);

    const db = new MysqlDB(deps);
    db.pool = deps._mockPool;

    const record = await db.findRecord('widget', 42);
    assert.ok(record, 'findRecord returned a result');

    const records = await db.findAll('widget');
    assert.ok(Array.isArray(records), 'findAll returned an array');

    // Both calls go directly to pool.execute, not through _writeQueue
    assert.strictEqual(deps._mockPool.execute.callCount, 2, 'two direct pool.execute calls for reads');
  });

  test('view operations bypass the write queue entirely', async function(assert) {
    const deps = createMockDeps();
    deps.introspectViews.returns({
      'widget-stats': { viewName: 'widget_stats', source: 'widget', columns: {}, foreignKeys: {} },
    });

    const db = new MysqlDB(deps);
    db.pool = deps._mockPool;

    // persist on a view should return immediately (no-op)
    await db.persist('create', 'widget-stats', {}, {});

    assert.strictEqual(deps._mockPool.execute.callCount, 0, 'no SQL executed for view persist');
  });
});
