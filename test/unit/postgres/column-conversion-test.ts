// @ts-nocheck
/**
 * #292 — JSON array values bypass type conversion on the Postgres update path.
 *
 * Scope: Postgres + TimescaleDB (by inheritance). DynamoDB must remain
 * byte-identical.
 *
 * Tier: unit. The integration tier is NOT available as a gate — the shared CI
 * workflow (abofs/stonyx-workflows/.github/workflows/ci.yml@main) has no
 * `services:` block, so every integration assertion skip-passes.
 *
 * Harness note: the existing `createMockDeps` in
 * postgres-db-write-serialization-test.ts stubs `buildUpdate` to return
 * `{ values: [] }`. That would make every assertion here vacuous. This file
 * injects the REAL `buildInsert`/`buildUpdate` and fakes only the pool.
 */
import QUnit from 'qunit';
import sinon from 'sinon';
import pgUtils from 'pg/lib/utils.js';
import PostgresDB from '../../../src/postgres/postgres-db.js';
import TimescaleDB from '../../../src/timescale/timescale-db.js';
import DynamoDBDB from '../../../src/dynamodb/dynamodb-db.js';
import { buildInsert, buildUpdate } from '../../../src/postgres/query-builder.js';
import { buildUpdateItem } from '../../../src/dynamodb/operation-builder.js';
import { createMockDeps as createDynamoDeps, buildDb as buildDynamoDb, resetInstance as resetDynamoInstance }
  from '../../helpers/dynamodb-test-helper.js';
import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const { module, test } = QUnit;
const { prepareValue } = pgUtils;
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

const TAGS_SCHEMA = {
  table: 'widgets',
  idType: 'number',
  columns: { name: 'VARCHAR(100)', tags: 'JSONB' },
  foreignKeys: {},
  relationships: { belongsTo: {}, hasMany: {} },
  vectorColumns: {},
  memory: true,
};

/**
 * Postgres deps with the REAL query builders and the REAL column converter.
 * Only the pool is faked, so `values` is the array actually bound to pg.
 */
function createPgDeps(schema = TAGS_SCHEMA) {
  const mockPool = { query: sinon.stub().resolves({ rows: [] }) };

  return {
    getPool: sinon.stub().resolves(mockPool),
    closePool: sinon.stub().resolves(),
    ensureMigrationsTable: sinon.stub().resolves(),
    getAppliedMigrations: sinon.stub().resolves([]),
    getMigrationFiles: sinon.stub().resolves([]),
    applyMigration: sinon.stub().resolves(),
    parseMigrationFile: sinon.stub(),
    introspectModels: sinon.stub().returns({ widget: schema }),
    introspectViews: sinon.stub().returns({}),
    getTopologicalOrder: sinon.stub().returns([]),
    schemasToSnapshot: sinon.stub().returns({}),
    loadLatestSnapshot: sinon.stub().resolves({}),
    detectSchemaDrift: sinon.stub().returns({ hasChanges: false }),
    // REAL builders — a stub here makes every assertion in this file vacuous.
    buildInsert,
    buildUpdate,
    buildDelete: sinon.stub().returns({ sql: 'DELETE ...', values: [] }),
    buildSelect: sinon.stub().returns({ sql: 'SELECT ...', values: [] }),
    buildVectorSearch: sinon.stub().returns({ sql: 'SELECT ...', values: [] }),
    buildHybridSearch: sinon.stub().returns({ sql: 'SELECT ...', values: [] }),
    createRecord: sinon.stub().callsFake((_n, data) => ({ id: data.id, __data: data, __relationships: {} })),
    store: { get: sinon.stub().returns(new Map()), data: new Map(), _memoryResolver: null },
    confirm: sinon.stub().resolves(false),
    readFile: sinon.stub().resolves(''),
    getPluralName: sinon.stub().callsFake(n => n + 's'),
    config: {
      orm: {
        postgres: { migrationsDir: 'migrations', migrationsTable: '__migrations' },
        timescale: { migrationsDir: 'migrations', migrationsTable: '__migrations' },
      },
      rootPath: '/tmp',
    },
    log: { db: sinon.stub(), warn: sinon.stub(), error: sinon.stub() },
    path: { resolve: sinon.stub().returns('/tmp/migrations'), join: sinon.stub().returns('/tmp/migrations/file') },
    _mockPool: mockPool,
    // NOTE: convertRow / postgresJsonRule are deliberately NOT overridden —
    // the real implementations must run.
  };
}

function makeRecord(data, id = 1) {
  return { id, __data: { ...data }, __relationships: {} };
}

/** Run an UPDATE through the driver and return { sql, values }. */
async function runUpdate(Ctor, deps, data, oldState = {}) {
  // The driver is a singleton keyed on the constructor. Reset it here, not
  // only in beforeEach: a single test may instantiate more than once, and a
  // stale instance silently reuses the PREVIOUS deps.
  Ctor.instance = undefined;
  const db = new Ctor(deps);
  db.pool = deps._mockPool;
  await db.persist('update', 'widget', { record: makeRecord(data), oldState }, {});
  const call = deps._mockPool.query.getCall(0);
  return { sql: call.args[0], values: call.args[1] };
}

/** Run a CREATE through the driver and return { sql, values }. */
async function runCreate(Ctor, deps, data, id = 1) {
  const record = makeRecord(data, id);
  deps.store.get = sinon.stub().callsFake((_name, wantedId) =>
    (wantedId === undefined ? new Map() : record));

  Ctor.instance = undefined;
  const db = new Ctor(deps);
  db.pool = deps._mockPool;
  await db.persist('create', 'widget', { rawData: { ...data } }, { data: { id } });
  const call = deps._mockPool.query.getCall(0);
  return { sql: call.args[0], values: call.args[1] };
}

/**
 * Locate the parameter index for a column from the generated SQL rather than
 * hardcoding it — `updated_at` is appended by _persistUpdate and shifts the
 * order.
 */
function paramFor(sql, values, column) {
  const match = sql.match(new RegExp(`"${column}" = \\$(\\d+)`));
  if (!match) throw new Error(`column "${column}" not found in SQL: ${sql}`);
  return values[Number(match[1]) - 1];
}

module('[Unit] Column conversion — Postgres update path (#292)', function(hooks) {
  hooks.beforeEach(function() {
    PostgresDB.instance = undefined;
    TimescaleDB.instance = undefined;
  });

  hooks.afterEach(function() {
    PostgresDB.instance = undefined;
    TimescaleDB.instance = undefined;
    sinon.restore();
  });

  // --- AC3: POSITIVE CONTROL, oracle liveness -----------------------------
  // Assertion AC2 below is only meaningful while pg renders a raw JS array as
  // a Postgres array literal. If pg's coercion ever changes, that oracle is
  // dead and this test goes red first.
  test('POSITIVE CONTROL: pg prepareValue still renders raw arrays as array literals', function(assert) {
    assert.strictEqual(prepareValue([1, 2, 3]), '{"1","2","3"}',
      'prepareValue([1,2,3]) is a Postgres array literal, not JSON');
    assert.strictEqual(prepareValue([]), '{}',
      'prepareValue([]) is {} — valid JSON, which is why the empty-array case corrupts silently');
  });

  // --- AC1 + AC2 ----------------------------------------------------------
  test('_persistUpdate binds the JSON string for a JSONB column', async function(assert) {
    const deps = createPgDeps();
    const { sql, values } = await runUpdate(PostgresDB, deps, { tags: [1, 2, 3] });
    const bound = paramFor(sql, values, 'tags');

    assert.strictEqual(typeof bound, 'string', 'bound value is a string, not an Array');
    assert.strictEqual(bound, '[1,2,3]', 'bound value is the JSON string "[1,2,3]"');
    assert.strictEqual(prepareValue(bound), '[1,2,3]',
      'pg sends valid JSON to the JSONB column (pre-fix: {"1","2","3"})');
  });

  test('_persistUpdate converts the empty array — the silently-corrupting case', async function(assert) {
    const deps = createPgDeps();
    const { sql, values } = await runUpdate(PostgresDB, deps, { tags: [] });
    const bound = paramFor(sql, values, 'tags');

    assert.strictEqual(bound, '[]', 'empty array binds as "[]"');
    assert.strictEqual(prepareValue(bound), '[]', 'pg sends [] (pre-fix: {} — valid JSON, no error)');
  });

  // --- AC4: POSITIVE CONTROL, sentinel sensitivity ------------------------
  // A converter that blanket-stringifies passes the assertion above and fails
  // this one. Both must pass.
  test('POSITIVE CONTROL: a non-JSONB column is not converted', async function(assert) {
    const deps = createPgDeps();
    const { sql, values } = await runUpdate(PostgresDB, deps, { name: [1, 2, 3] });
    const bound = paramFor(sql, values, 'name');

    assert.notStrictEqual(typeof bound, 'string', 'VARCHAR(100) column value is not stringified');
    assert.deepEqual(bound, [1, 2, 3], 'VARCHAR(100) column binds the raw Array');
  });

  test('POSITIVE CONTROL: updated_at is not in schema.columns and passes through untouched',
    async function(assert) {
      const deps = createPgDeps();
      const { sql, values } = await runUpdate(PostgresDB, deps, { tags: [1, 2, 3] });
      const bound = paramFor(sql, values, 'updated_at');

      assert.ok(bound instanceof Date,
        'updated_at (undefined column type) is still a Date — the rule is a no-op for it');
    });

  // --- AC5: HARNESS CONTROL -----------------------------------------------
  // This passes today, pre- and post-fix. A red here means the harness is
  // mis-wired, not that the fix is wrong.
  test('HARNESS CONTROL: _persistCreate binds the JSON string for a JSONB column', async function(assert) {
    const deps = createPgDeps();
    const { values } = await runCreate(PostgresDB, deps, { id: 1, tags: [1, 2, 3] });

    assert.ok(values.includes('[1,2,3]'), 'create path binds "[1,2,3]" (unchanged by this fix)');
    assert.notOk(values.some(v => Array.isArray(v)), 'no raw Array reaches pg on the create path');
  });

  // --- AC6: string pass-through, BOTH paths -------------------------------
  test('a JSONB column holding a JSON string is passed through unchanged on the update path',
    async function(assert) {
      const deps = createPgDeps();
      const { sql, values } = await runUpdate(PostgresDB, deps, { tags: '{"a":1}' });

      assert.strictEqual(paramFor(sql, values, 'tags'), '{"a":1}',
        'string is NOT double-encoded (an unconditional JSON.stringify would give "{\\"a\\":1}")');
    });

  test('a JSONB column holding a JSON string is passed through unchanged on the create path',
    async function(assert) {
      const deps = createPgDeps();
      const { values } = await runCreate(PostgresDB, deps, { id: 1, tags: '{"a":1}' });

      assert.ok(values.includes('{"a":1}'), 'create path still stores the object the string describes');
      assert.notOk(values.includes('"{\\"a\\":1}"'), 'create path did not double-encode');
    });

  // --- AC7: TimescaleDB inherits ------------------------------------------
  test('TimescaleDB inherits the fix — no write-path override', async function(assert) {
    const deps = createPgDeps();
    const { sql, values } = await runUpdate(TimescaleDB, deps, { tags: [1, 2, 3] });
    const bound = paramFor(sql, values, 'tags');

    assert.strictEqual(typeof bound, 'string', 'TimescaleDB binds a string, not an Array');
    assert.strictEqual(bound, '[1,2,3]', 'TimescaleDB binds "[1,2,3]"');
    assert.strictEqual(prepareValue(bound), '[1,2,3]', 'TimescaleDB sends valid JSON');
  });

  // --- MEASURED KNOCK-ON: JSONB null --------------------------------------
  // Sharing one rule across both paths necessarily picks ONE null semantic.
  // Measured pre-fix: create binds 'null' (JSONB scalar null), update binds SQL
  // NULL. The create path is required to stay byte-identical, so the update
  // path converges on create's semantic. #292 lists JSONB-null unification as
  // deliberately deferred; this test pins the change so it is visible rather
  // than silent. If review rules the other way, this test is the one to flip.
  test('KNOCK-ON: null in a JSONB column now binds the JSONB scalar null on BOTH paths',
    async function(assert) {
      const updateDeps = createPgDeps();
      const update = await runUpdate(PostgresDB, updateDeps, { tags: null }, { tags: [1] });

      assert.strictEqual(paramFor(update.sql, update.values, 'tags'), 'null',
        'update binds the string "null" (pre-fix: SQL NULL) -- measured behaviour change');

      const createDeps = createPgDeps();
      const create = await runCreate(PostgresDB, createDeps, { id: 1, tags: null });

      assert.ok(create.values.includes('null'),
        'create binds the string "null" -- unchanged by this fix');
    });

  // --- AC8: no inline stringify left --------------------------------------
  test('src/postgres/postgres-db.ts contains no JSON.stringify', function(assert) {
    const source = readFileSync(path.join(repoRoot, 'src/postgres/postgres-db.ts'), 'utf8');
    const occurrences = source.split('JSON.stringify').length - 1;

    assert.strictEqual(occurrences, 0,
      'conversion lives in the shared module, not inline in the driver');
    assert.ok(source.includes('convertRow'), 'the driver routes through convertRow (guards the count above)');
  });
});

module('[Unit] Column conversion — DynamoDB is unchanged (#292)', function(hooks) {
  hooks.beforeEach(resetDynamoInstance);
  hooks.afterEach(function() {
    resetDynamoInstance();
    sinon.restore();
  });

  // --- AC9 ----------------------------------------------------------------
  // The REAL buildUpdateItem is injected; the helper's stub returns an empty
  // ExpressionAttributeValues and would make this vacuous.
  test('UpdateCommand ExpressionAttributeValues leave arrays and objects unstringified',
    async function(assert) {
      const deps = createDynamoDeps({
        buildUpdateItem,
        introspectModels: sinon.stub().returns({
          widget: {
            table: 'widgets',
            idType: 'string',
            columns: { tags: 'JSONB', meta: 'JSONB', when: 'TIMESTAMPTZ', gone: 'JSONB' },
            foreignKeys: {},
            relationships: { belongsTo: {}, hasMany: {} },
            vectorColumns: {},
            memory: true,
          },
        }),
      });

      const { db, mockClient } = buildDynamoDb(deps);
      const record = {
        id: 'w1',
        __data: {
          tags: [1, 2, 3],
          meta: { a: 1 },
          when: new Date('2020-01-01T00:00:00.000Z'),
          gone: null,
        },
        __relationships: {},
      };

      await db.persist('update', 'widget', { record, oldState: {} }, {});

      const command = mockClient.send.getCall(0).args[0];

      assert.deepEqual(command.params.ExpressionAttributeValues, {
        ':tags': [1, 2, 3],
        ':meta': { a: 1 },
        ':when': '2020-01-01T00:00:00.000Z',
        ':gone': null,
      }, 'arrays and objects are marshalled natively by DocumentClient — NOT stringified');
    });
});
