import QUnit from 'qunit';
import sinon from 'sinon';
import MysqlDB from '../../../src/mysql/mysql-db.js';

const { module, test } = QUnit;

function createMockDeps(overrides = {}) {
  return {
    getPool: sinon.stub().resolves({}),
    closePool: sinon.stub().resolves(),
    ensureMigrationsTable: sinon.stub().resolves(),
    getAppliedMigrations: sinon.stub().resolves([]),
    getMigrationFiles: sinon.stub().resolves([]),
    applyMigration: sinon.stub().resolves(),
    parseMigrationFile: sinon.stub().returns({ up: 'CREATE TABLE t (id INT);', down: 'DROP TABLE t;' }),
    introspectModels: sinon.stub().returns({}),
    getTopologicalOrder: sinon.stub().returns([]),
    schemasToSnapshot: sinon.stub().returns({}),
    loadLatestSnapshot: sinon.stub().resolves({}),
    detectSchemaDrift: sinon.stub().returns({ hasChanges: false }),
    buildInsert: sinon.stub().returns({ sql: '', values: [] }),
    buildUpdate: sinon.stub().returns({ sql: '', values: [] }),
    buildDelete: sinon.stub().returns({ sql: '', values: [] }),
    buildSelect: sinon.stub().returns({ sql: '', values: [] }),
    createRecord: sinon.stub(),
    store: { get: sinon.stub() },
    confirm: sinon.stub().resolves(true),
    readFile: sinon.stub().resolves('-- UP\nCREATE TABLE t (id INT);\n-- DOWN\nDROP TABLE t;'),
    pluralize: sinon.stub(),
    config: {
      rootPath: '/app',
      orm: {
        mysql: {
          host: 'localhost',
          port: 3306,
          migrationsDir: 'migrations',
          migrationsTable: '__migrations',
        }
      }
    },
    log: {
      db: sinon.stub(),
      warn: sinon.stub(),
    },
    path: {
      resolve: sinon.stub().returns('/app/migrations'),
      join: sinon.stub().callsFake((...args) => args.join('/')),
    },
    ...overrides,
  };
}

module('[Unit] MysqlDB Startup', function(hooks) {
  hooks.beforeEach(function() {
    MysqlDB.instance = null;
  });

  hooks.afterEach(function() {
    MysqlDB.instance = null;
    sinon.restore();
  });

  test('applies pending migrations when user confirms prompt', async function(assert) {
    const deps = createMockDeps({
      getAppliedMigrations: sinon.stub().resolves(['001.sql']),
      getMigrationFiles: sinon.stub().resolves(['001.sql', '002.sql', '003.sql']),
      confirm: sinon.stub().resolves(true),
    });

    const db = new MysqlDB(deps);
    db.pool = { execute: sinon.stub().resolves([[]]) };

    await db.startup();

    assert.ok(deps.applyMigration.calledTwice, 'applyMigration called for each pending migration');
    assert.ok(deps.applyMigration.firstCall.args[1] === '002.sql', 'first pending migration applied');
    assert.ok(deps.applyMigration.secondCall.args[1] === '003.sql', 'second pending migration applied');
  });

  test('skips migrations when user declines prompt', async function(assert) {
    const deps = createMockDeps({
      getAppliedMigrations: sinon.stub().resolves([]),
      getMigrationFiles: sinon.stub().resolves(['001.sql']),
      confirm: sinon.stub().resolves(false),
    });

    const db = new MysqlDB(deps);
    db.pool = { execute: sinon.stub().resolves([[]]) };

    await db.startup();

    assert.ok(deps.applyMigration.notCalled, 'applyMigration was not called');
    assert.ok(deps.log.warn.calledOnce, 'warning logged about skipping');
  });

  test('does nothing when no pending migrations exist', async function(assert) {
    const deps = createMockDeps({
      getAppliedMigrations: sinon.stub().resolves(['001.sql', '002.sql']),
      getMigrationFiles: sinon.stub().resolves(['001.sql', '002.sql']),
    });

    const db = new MysqlDB(deps);
    db.pool = { execute: sinon.stub().resolves([[]]) };

    await db.startup();

    assert.ok(deps.confirm.notCalled, 'confirm was not called');
    assert.ok(deps.applyMigration.notCalled, 'applyMigration was not called');
  });

  test('reloads records after applying migrations', async function(assert) {
    const deps = createMockDeps({
      getAppliedMigrations: sinon.stub().resolves([]),
      getMigrationFiles: sinon.stub().resolves(['001.sql']),
      confirm: sinon.stub().resolves(true),
      introspectModels: sinon.stub().returns({}),
      getTopologicalOrder: sinon.stub().returns([]),
    });

    const db = new MysqlDB(deps);
    db.pool = { execute: sinon.stub().resolves([[]]) };

    const loadSpy = sinon.spy(db, 'loadMemoryRecords');

    await db.startup();

    assert.ok(loadSpy.calledOnce, 'loadMemoryRecords was called after migrations applied');
  });

  test('checks schema drift and warns when drift detected', async function(assert) {
    const deps = createMockDeps({
      loadLatestSnapshot: sinon.stub().resolves({ users: { columns: {} } }),
      detectSchemaDrift: sinon.stub().returns({ hasChanges: true }),
    });

    const db = new MysqlDB(deps);
    db.pool = { execute: sinon.stub().resolves([[]]) };

    await db.startup();

    assert.ok(deps.detectSchemaDrift.calledOnce, 'detectSchemaDrift was called');
    assert.ok(deps.log.warn.called, 'warning about drift was logged');
  });

  test('does not warn about drift when no snapshot exists', async function(assert) {
    const deps = createMockDeps({
      loadLatestSnapshot: sinon.stub().resolves({}),
      detectSchemaDrift: sinon.stub().returns({ hasChanges: true }),
    });

    const db = new MysqlDB(deps);
    db.pool = { execute: sinon.stub().resolves([[]]) };

    await db.startup();

    assert.ok(deps.detectSchemaDrift.notCalled, 'detectSchemaDrift was not called when snapshot is empty');
    assert.ok(deps.log.warn.notCalled, 'no drift warning logged');
  });

  test('prompt message includes correct pending migration count', async function(assert) {
    const deps = createMockDeps({
      getAppliedMigrations: sinon.stub().resolves([]),
      getMigrationFiles: sinon.stub().resolves(['001.sql', '002.sql', '003.sql']),
      confirm: sinon.stub().resolves(false),
    });

    const db = new MysqlDB(deps);
    db.pool = { execute: sinon.stub().resolves([[]]) };

    await db.startup();

    const confirmArg = deps.confirm.firstCall.args[0];
    assert.ok(confirmArg.includes('3'), 'prompt mentions 3 pending migrations');
  });
});

module('[Unit] MysqlDB._rowToRawData — Boolean Coercion', function(hooks) {
  hooks.beforeEach(function() {
    MysqlDB.instance = null;
  });

  hooks.afterEach(function() {
    MysqlDB.instance = null;
    sinon.restore();
  });

  test('converts TINYINT(1) value 1 to true', function(assert) {
    const db = new MysqlDB(createMockDeps());

    const row = { id: 'link-1', active: 1, expiration: 99999 };
    const schema = {
      columns: { active: 'TINYINT(1)', expiration: 'INT' },
      foreignKeys: {},
    };

    const result = db._rowToRawData(row, schema);

    assert.strictEqual(result.active, true, 'active=1 should be converted to true');
    assert.strictEqual(result.expiration, 99999, 'non-boolean INT column should be unchanged');
  });

  test('converts TINYINT(1) value 0 to false', function(assert) {
    const db = new MysqlDB(createMockDeps());

    const row = { id: 'link-2', active: 0, expiration: 99999 };
    const schema = {
      columns: { active: 'TINYINT(1)', expiration: 'INT' },
      foreignKeys: {},
    };

    const result = db._rowToRawData(row, schema);

    assert.strictEqual(result.active, false, 'active=0 should be converted to false');
  });

  test('preserves null for TINYINT(1) columns', function(assert) {
    const db = new MysqlDB(createMockDeps());

    const row = { id: 'link-3', active: null, expiration: 99999 };
    const schema = {
      columns: { active: 'TINYINT(1)', expiration: 'INT' },
      foreignKeys: {},
    };

    const result = db._rowToRawData(row, schema);

    assert.strictEqual(result.active, null, 'null boolean value should stay null');
  });

  test('does not convert non-boolean columns', function(assert) {
    const db = new MysqlDB(createMockDeps());

    const row = { id: 'link-4', active: 1, expiration: 12345, name: 'test' };
    const schema = {
      columns: { active: 'TINYINT(1)', expiration: 'INT', name: 'VARCHAR(255)' },
      foreignKeys: {},
    };

    const result = db._rowToRawData(row, schema);

    assert.strictEqual(result.expiration, 12345, 'INT column unchanged');
    assert.strictEqual(result.name, 'test', 'VARCHAR column unchanged');
    assert.strictEqual(result.active, true, 'TINYINT(1) column converted');
  });
});

module('[Unit] MysqlDB.save — No-op for MySQL', function(hooks) {
  hooks.beforeEach(function() {
    MysqlDB.instance = null;
  });

  hooks.afterEach(function() {
    MysqlDB.instance = null;
    sinon.restore();
  });

  test('save() exists and is a function', function(assert) {
    const db = new MysqlDB(createMockDeps());
    assert.strictEqual(typeof db.save, 'function', 'save is a function');
  });

  test('save() returns a Promise', async function(assert) {
    const db = new MysqlDB(createMockDeps());
    const result = db.save();
    assert.ok(result instanceof Promise, 'save() returns a Promise');
    await result;
    assert.ok(true, 'save() resolves without error');
  });

  test('save() does not execute any SQL', async function(assert) {
    const deps = createMockDeps();
    const db = new MysqlDB(deps);
    db.pool = { execute: sinon.stub().resolves([[]]) };

    await db.save();

    assert.ok(db.pool.execute.notCalled, 'no SQL executed during save()');
  });
});
