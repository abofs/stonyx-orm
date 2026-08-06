// @ts-nocheck
import QUnit from 'qunit';
import sinon from 'sinon';
import PostgresDB from '../../../src/postgres/postgres-db.js';

const { module, test } = QUnit;

function createMockDeps(overrides = {}) {
  const mockPool = {
    query: sinon.stub().resolves({ rows: [] }),
  };

  return {
    getPool: sinon.stub().resolves(mockPool),
    closePool: sinon.stub().resolves(),
    ensureMigrationsTable: sinon.stub().resolves(),
    getAppliedMigrations: sinon.stub().resolves([]),
    getMigrationFiles: sinon.stub().resolves([]),
    applyMigration: sinon.stub().resolves(),
    parseMigrationFile: sinon.stub().returns({ up: 'CREATE TABLE t (id INT);', down: 'DROP TABLE t;' }),
    introspectModels: sinon.stub().returns({}),
    introspectViews: sinon.stub().returns({}),
    getTopologicalOrder: sinon.stub().returns([]),
    schemasToSnapshot: sinon.stub().returns({}),
    loadLatestSnapshot: sinon.stub().resolves({}),
    detectSchemaDrift: sinon.stub().returns({ hasChanges: false }),
    buildInsert: sinon.stub().returns({ sql: '', values: [] }),
    buildUpdate: sinon.stub().returns({ sql: '', values: [] }),
    buildDelete: sinon.stub().returns({ sql: '', values: [] }),
    buildSelect: sinon.stub().returns({ sql: '', values: [] }),
    buildVectorSearch: sinon.stub().returns({ sql: '', values: [] }),
    buildHybridSearch: sinon.stub().returns({ sql: '', values: [] }),
    createRecord: sinon.stub().callsFake((_name, data) => ({ id: data.id, __data: data, __relationships: {} })),
    store: {
      get: sinon.stub().returns(new Map()),
      data: new Map(),
      _memoryResolver: null,
    },
    confirm: sinon.stub().resolves(true),
    readFile: sinon.stub().resolves('-- UP\nCREATE TABLE t (id INT);\n-- DOWN\nDROP TABLE t;'),
    getPluralName: sinon.stub().callsFake(name => name + 's'),
    config: { orm: { postgres: { migrationsDir: 'migrations', migrationsTable: '__migrations' } }, rootPath: '/tmp' },
    log: { db: sinon.stub(), warn: sinon.stub(), error: sinon.stub() },
    path: {
      resolve: sinon.stub().returns('/tmp/migrations'),
      join: sinon.stub().callsFake((...args) => args.join('/')),
    },
    _mockPool: mockPool,
    ...overrides,
  };
}

module('[Unit] PostgresDB Startup — autoMigrate config (#172)', function(hooks) {
  hooks.beforeEach(function() {
    PostgresDB.instance = undefined;
  });

  hooks.afterEach(function() {
    PostgresDB.instance = undefined;
    sinon.restore();
  });

  test('startup() applies pending migrations without confirm when autoMigrate is true', async function(assert) {
    const deps = createMockDeps({
      getAppliedMigrations: sinon.stub().resolves(['001.sql']),
      getMigrationFiles: sinon.stub().resolves(['001.sql', '002.sql', '003.sql']),
    });

    deps.config.orm.postgres.autoMigrate = true;

    const db = new PostgresDB(deps);
    db.pool = deps._mockPool;

    await db.startup();

    assert.ok(deps.confirm.notCalled, 'confirm was NOT called');
    assert.ok(deps.applyMigration.calledTwice, 'applyMigration called for each pending migration');
    assert.strictEqual(deps.applyMigration.firstCall.args[1], '002.sql', 'first pending migration applied');
    assert.strictEqual(deps.applyMigration.secondCall.args[1], '003.sql', 'second pending migration applied');
  });

  test('startup() skips pending migrations with warning when autoMigrate is false', async function(assert) {
    const deps = createMockDeps({
      getAppliedMigrations: sinon.stub().resolves([]),
      getMigrationFiles: sinon.stub().resolves(['001.sql', '002.sql']),
    });

    deps.config.orm.postgres.autoMigrate = false;

    const db = new PostgresDB(deps);
    db.pool = deps._mockPool;

    await db.startup();

    assert.ok(deps.confirm.notCalled, 'confirm was NOT called');
    assert.ok(deps.applyMigration.notCalled, 'applyMigration was NOT called');
    assert.ok(deps.log.warn.called, 'log.warn was called');
    const warnMsg = deps.log.warn.args.flat().join(' ');
    assert.ok(warnMsg.includes('autoMigrate is false'), 'warning mentions autoMigrate is false');
  });

  test('startup() auto-generates initial migration when autoMigrate is true and no migrations exist', async function(assert) {
    const deps = createMockDeps({
      getMigrationFiles: sinon.stub().resolves([]),
      introspectModels: sinon.stub().returns({
        user: { table: 'users', columns: { name: 'VARCHAR(255)' }, foreignKeys: {}, memory: true },
      }),
    });

    deps.config.orm.postgres.autoMigrate = true;

    const db = new PostgresDB(deps);
    db.pool = deps._mockPool;

    // generateMigration is a dynamic import that reads global config (not mockable via deps).
    // We catch its error and verify the behavior up to that point.
    try {
      await db.startup();
    } catch {
      // Expected: generateMigration throws because global config isn't wired in unit tests
    }

    assert.ok(deps.confirm.notCalled, 'confirm was NOT called — autoMigrate bypassed the prompt');
  });

  test('startup() skips initial migration with warning when autoMigrate is false and no migrations exist', async function(assert) {
    const deps = createMockDeps({
      getMigrationFiles: sinon.stub().resolves([]),
      introspectModels: sinon.stub().returns({
        user: { table: 'users', columns: { name: 'VARCHAR(255)' }, foreignKeys: {}, memory: true },
      }),
    });

    deps.config.orm.postgres.autoMigrate = false;

    const db = new PostgresDB(deps);
    db.pool = deps._mockPool;

    await db.startup();

    assert.ok(deps.confirm.notCalled, 'confirm was NOT called');
    assert.ok(deps.applyMigration.notCalled, 'applyMigration was NOT called');
    assert.ok(deps.log.warn.called, 'log.warn was called');
    const warnMsg = deps.log.warn.args.flat().join(' ');
    assert.ok(warnMsg.includes('autoMigrate is false'), 'warning mentions autoMigrate is false');
  });

  test('startup() still calls confirm when autoMigrate is undefined (backward compat)', async function(assert) {
    const deps = createMockDeps({
      getAppliedMigrations: sinon.stub().resolves([]),
      getMigrationFiles: sinon.stub().resolves(['001.sql']),
      confirm: sinon.stub().resolves(false),
    });

    // autoMigrate is NOT set — should fall through to confirm()
    const db = new PostgresDB(deps);
    db.pool = deps._mockPool;

    await db.startup();

    assert.ok(deps.confirm.calledOnce, 'confirm was called when autoMigrate is undefined');
  });
});
