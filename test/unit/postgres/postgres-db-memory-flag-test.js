import QUnit from 'qunit';
import sinon from 'sinon';
import PostgresDB from '../../../src/postgres/postgres-db.js';

const { module, test } = QUnit;

function createMockDeps(overrides = {}) {
  return {
    getPool: sinon.stub().resolves({}),
    closePool: sinon.stub().resolves(),
    ensureMigrationsTable: sinon.stub().resolves(),
    getAppliedMigrations: sinon.stub().resolves([]),
    getMigrationFiles: sinon.stub().resolves([]),
    applyMigration: sinon.stub().resolves(),
    parseMigrationFile: sinon.stub().returns({ up: 'CREATE TABLE t (id INTEGER);', down: 'DROP TABLE t;' }),
    introspectModels: sinon.stub().returns({}),
    introspectViews: sinon.stub().returns({}),
    getTopologicalOrder: sinon.stub().returns([]),
    schemasToSnapshot: sinon.stub().returns({}),
    loadLatestSnapshot: sinon.stub().resolves({}),
    detectSchemaDrift: sinon.stub().returns({ hasChanges: false }),
    buildInsert: sinon.stub().returns({ sql: 'INSERT INTO "test" ("name") VALUES ($1)', values: ['test'] }),
    buildUpdate: sinon.stub().returns({ sql: 'UPDATE "test" SET "name" = $1 WHERE "id" = $2', values: ['test', 1] }),
    buildDelete: sinon.stub().returns({ sql: 'DELETE FROM "test" WHERE "id" = $1', values: [1] }),
    buildSelect: sinon.stub().returns({ sql: 'SELECT * FROM "test"', values: [] }),
    createRecord: sinon.stub().callsFake((name, data) => ({ id: data.id, __model: { __name: name }, __data: data })),
    store: { get: sinon.stub() },
    confirm: sinon.stub().resolves(true),
    readFile: sinon.stub().resolves(''),
    getPluralName: sinon.stub(),
    config: {
      rootPath: '/app',
      orm: {
        postgres: {
          host: 'localhost',
          port: 5432,
          migrationsDir: 'migrations',
          migrationsTable: '__migrations',
        }
      }
    },
    log: { db: sinon.stub(), warn: sinon.stub() },
    path: {
      resolve: sinon.stub().returns('/app/migrations'),
      join: sinon.stub().callsFake((...args) => args.join('/')),
    },
    ...overrides,
  };
}

module('[Unit] PostgresDB.findRecord', function (hooks) {
  hooks.beforeEach(function () { PostgresDB.instance = null; });
  hooks.afterEach(function () { PostgresDB.instance = null; sinon.restore(); });

  test('findRecord queries by ID and returns a record', async function (assert) {
    const deps = createMockDeps({
      introspectModels: sinon.stub().returns({
        alert: { table: 'alerts', columns: { message: 'VARCHAR(255)' }, foreignKeys: {} },
      }),
      buildSelect: sinon.stub().returns({ sql: 'SELECT * FROM "alerts" WHERE "id" = $1', values: [42] }),
    });
    const db = new PostgresDB(deps);
    db.pool = { query: sinon.stub().resolves({ rows: [{ id: 42, message: 'test' }] }) };
    const record = await db.findRecord('alert', 42);
    assert.ok(deps.buildSelect.calledOnce);
    assert.deepEqual(deps.buildSelect.firstCall.args, ['alerts', { id: 42 }]);
    assert.strictEqual(record.id, 42);
  });

  test('findRecord returns undefined when no rows found', async function (assert) {
    const deps = createMockDeps({
      introspectModels: sinon.stub().returns({
        alert: { table: 'alerts', columns: {}, foreignKeys: {} },
      }),
      buildSelect: sinon.stub().returns({ sql: 'SELECT * FROM "alerts" WHERE "id" = $1', values: [999] }),
    });
    const db = new PostgresDB(deps);
    db.pool = { query: sinon.stub().resolves({ rows: [] }) };
    const record = await db.findRecord('alert', 999);
    assert.strictEqual(record, undefined);
  });

  test('findRecord handles undefined_table error gracefully', async function (assert) {
    const deps = createMockDeps({
      introspectModels: sinon.stub().returns({
        alert: { table: 'alerts', columns: {}, foreignKeys: {} },
      }),
      buildSelect: sinon.stub().returns({ sql: 'SELECT * FROM "alerts"', values: [] }),
    });
    const db = new PostgresDB(deps);
    const error = new Error('relation "alerts" does not exist');
    error.code = '42P01';
    db.pool = { query: sinon.stub().rejects(error) };
    const record = await db.findRecord('alert', 1);
    assert.strictEqual(record, undefined);
  });
});

module('[Unit] PostgresDB.findAll', function (hooks) {
  hooks.beforeEach(function () { PostgresDB.instance = null; });
  hooks.afterEach(function () { PostgresDB.instance = null; sinon.restore(); });

  test('findAll returns records', async function (assert) {
    const deps = createMockDeps({
      introspectModels: sinon.stub().returns({
        alert: { table: 'alerts', columns: { message: 'VARCHAR(255)' }, foreignKeys: {} },
      }),
      buildSelect: sinon.stub().returns({ sql: 'SELECT * FROM "alerts"', values: [] }),
    });
    const db = new PostgresDB(deps);
    db.pool = { query: sinon.stub().resolves({ rows: [{ id: 1 }, { id: 2 }] }) };
    const records = await db.findAll('alert');
    assert.strictEqual(records.length, 2);
  });

  test('findAll handles undefined_table gracefully', async function (assert) {
    const deps = createMockDeps({
      introspectModels: sinon.stub().returns({
        alert: { table: 'alerts', columns: {}, foreignKeys: {} },
      }),
      buildSelect: sinon.stub().returns({ sql: 'SELECT * FROM "alerts"', values: [] }),
    });
    const db = new PostgresDB(deps);
    const error = new Error('relation "alerts" does not exist');
    error.code = '42P01';
    db.pool = { query: sinon.stub().rejects(error) };
    const records = await db.findAll('alert');
    assert.deepEqual(records, []);
  });
});

module('[Unit] PostgresDB._evictIfNotMemory', function (hooks) {
  hooks.beforeEach(function () { PostgresDB.instance = null; });
  hooks.afterEach(function () { PostgresDB.instance = null; sinon.restore(); });

  test('evicts record when memory resolver returns false', function (assert) {
    const modelStore = new Map();
    modelStore.set(42, { id: 42 });
    const deps = createMockDeps({
      store: { get: sinon.stub().returns(modelStore), _memoryResolver: (name) => name !== 'alert' },
    });
    const db = new PostgresDB(deps);
    db._evictIfNotMemory('alert', { id: 42 });
    assert.notOk(modelStore.has(42));
  });

  test('does not evict when memory resolver returns true', function (assert) {
    const modelStore = new Map();
    modelStore.set(1, { id: 1 });
    const deps = createMockDeps({
      store: { get: sinon.stub().returns(modelStore), _memoryResolver: () => true },
    });
    const db = new PostgresDB(deps);
    db._evictIfNotMemory('session', { id: 1 });
    assert.ok(modelStore.has(1));
  });
});

module('[Unit] PostgresDB._rowToRawData', function (hooks) {
  hooks.beforeEach(function () { PostgresDB.instance = null; });
  hooks.afterEach(function () { PostgresDB.instance = null; sinon.restore(); });

  test('remaps FK columns to relationship keys', function (assert) {
    const deps = createMockDeps();
    const db = new PostgresDB(deps);
    const rawData = db._rowToRawData(
      { id: 1, name: 'test', owner_id: 5, created_at: new Date(), updated_at: new Date() },
      { columns: { name: 'VARCHAR(255)' }, foreignKeys: { owner_id: { references: 'owners', column: 'id' } } }
    );
    assert.strictEqual(rawData.owner, 5, 'FK remapped to relationship key');
    assert.strictEqual(rawData.owner_id, undefined, 'FK column removed');
    assert.strictEqual(rawData.created_at, undefined, 'created_at stripped');
    assert.strictEqual(rawData.updated_at, undefined, 'updated_at stripped');
  });

  test('converts BIGINT string values to Number', function (assert) {
    const deps = createMockDeps();
    const db = new PostgresDB(deps);
    const rawData = db._rowToRawData(
      { id: 1, ts: '1711382400', created_at: new Date(), updated_at: new Date() },
      { columns: { ts: 'BIGINT' }, foreignKeys: {} }
    );
    assert.strictEqual(rawData.ts, 1711382400);
    assert.strictEqual(typeof rawData.ts, 'number');
  });
});

module('[Unit] PostgresDB._recordToRow', function (hooks) {
  hooks.beforeEach(function () { PostgresDB.instance = null; });
  hooks.afterEach(function () { PostgresDB.instance = null; sinon.restore(); });

  test('does not stringify JSONB values', function (assert) {
    const deps = createMockDeps();
    const db = new PostgresDB(deps);
    const record = { id: 1, __data: { id: 1, config: { key: 'value' } }, __relationships: {} };
    const schema = { columns: { config: 'JSONB' }, foreignKeys: {} };
    const row = db._recordToRow(record, schema);
    assert.deepEqual(row.config, { key: 'value' });
    assert.strictEqual(typeof row.config, 'object');
  });

  test('extracts FK values from relationships', function (assert) {
    const deps = createMockDeps();
    const db = new PostgresDB(deps);
    const record = { id: 1, __data: { id: 1 }, __relationships: { owner: { id: 5 } } };
    const schema = { columns: {}, foreignKeys: { owner_id: { references: 'owners', column: 'id' } } };
    const row = db._recordToRow(record, schema);
    assert.strictEqual(row.owner_id, 5);
  });
});

module('[Unit] PostgresDB._persistCreate', function (hooks) {
  hooks.beforeEach(function () { PostgresDB.instance = null; });
  hooks.afterEach(function () { PostgresDB.instance = null; sinon.restore(); });

  test('appends RETURNING id and re-keys pending records', async function (assert) {
    const modelStore = new Map();
    const record = {
      id: '__pending_123',
      __data: { id: '__pending_123', name: 'test', __pendingSqlId: true },
      __relationships: {},
    };
    modelStore.set('__pending_123', record);
    const deps = createMockDeps({
      introspectModels: sinon.stub().returns({
        alert: { table: 'alerts', columns: { name: 'VARCHAR(255)' }, foreignKeys: {} },
      }),
      buildInsert: sinon.stub().returns({ sql: 'INSERT INTO "alerts" ("name") VALUES ($1)', values: ['test'] }),
      store: { get: sinon.stub().callsFake((name, id) => id ? modelStore.get(id) : modelStore) },
    });
    const db = new PostgresDB(deps);
    db.pool = { query: sinon.stub().resolves({ rows: [{ id: 42 }] }) };
    await db._persistCreate('alert', {}, { data: { id: '__pending_123' } });
    const executedSql = db.pool.query.firstCall.args[0];
    assert.true(executedSql.includes('RETURNING id'));
    assert.strictEqual(record.__data.id, 42);
    assert.strictEqual(record.__data.__pendingSqlId, undefined);
  });
});

module('[Unit] PostgresDB._persistUpdate', function (hooks) {
  hooks.beforeEach(function () { PostgresDB.instance = null; });
  hooks.afterEach(function () { PostgresDB.instance = null; sinon.restore(); });

  test('includes updated_at in changed columns', async function (assert) {
    const deps = createMockDeps({
      introspectModels: sinon.stub().returns({
        alert: { table: 'alerts', columns: { name: 'VARCHAR(255)' }, foreignKeys: {} },
      }),
      buildUpdate: sinon.stub().returns({ sql: 'UPDATE "alerts" SET "name" = $1 WHERE "id" = $2', values: ['new', 1] }),
    });
    const db = new PostgresDB(deps);
    db.pool = { query: sinon.stub().resolves({ rows: [] }) };
    const record = { id: 1, __data: { id: 1, name: 'new' }, __relationships: {} };
    await db._persistUpdate('alert', { record, oldState: { name: 'old' } }, {});
    const buildUpdateCall = deps.buildUpdate.firstCall;
    assert.ok(buildUpdateCall);
    const changedData = buildUpdateCall.args[2];
    assert.ok(changedData.updated_at instanceof Date);
    assert.strictEqual(changedData.name, 'new');
  });

  test('skips update when no columns changed', async function (assert) {
    const deps = createMockDeps({
      introspectModels: sinon.stub().returns({
        alert: { table: 'alerts', columns: { name: 'VARCHAR(255)' }, foreignKeys: {} },
      }),
    });
    const db = new PostgresDB(deps);
    db.pool = { query: sinon.stub().resolves({ rows: [] }) };
    const record = { id: 1, __data: { id: 1, name: 'same' }, __relationships: {} };
    await db._persistUpdate('alert', { record, oldState: { name: 'same' } }, {});
    assert.ok(deps.buildUpdate.notCalled);
  });
});

module('[Unit] PostgresDB._persistDelete', function (hooks) {
  hooks.beforeEach(function () { PostgresDB.instance = null; });
  hooks.afterEach(function () { PostgresDB.instance = null; sinon.restore(); });

  test('deletes by record ID', async function (assert) {
    const deps = createMockDeps({
      introspectModels: sinon.stub().returns({
        alert: { table: 'alerts', columns: {}, foreignKeys: {} },
      }),
      buildDelete: sinon.stub().returns({ sql: 'DELETE FROM "alerts" WHERE "id" = $1', values: [5] }),
    });
    const db = new PostgresDB(deps);
    db.pool = { query: sinon.stub().resolves({ rows: [] }) };
    await db._persistDelete('alert', { recordId: 5 });
    assert.ok(deps.buildDelete.calledOnce);
    assert.deepEqual(deps.buildDelete.firstCall.args, ['alerts', 5]);
  });
});
