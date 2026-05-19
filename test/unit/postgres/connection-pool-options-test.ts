// @ts-nocheck
import QUnit from 'qunit';
import sinon from 'sinon';

const { module, test } = QUnit;

/**
 * To test getPool() without a real Postgres connection we need to intercept
 * the `new pg.Pool(...)` call. getPool() does `const { default: pg } = await import('pg')`
 * so once pg is loaded in the ESM cache, replacing `pg.default.Pool` (or
 * equivalently `pg.Pool` on the CJS wrapper) lets us capture constructor args.
 *
 * Between every test we call closePool() to reset the module-level singleton
 * so the next getPool() call constructs a fresh Pool.
 */

let pgModule: any;
let OriginalPool: any;
let getPool: typeof import('../../../src/postgres/connection.js').getPool;
let closePool: typeof import('../../../src/postgres/connection.js').closePool;

module('[Unit] Postgres connection — pool pass-through options', function (hooks) {

  hooks.before(async function () {
    // Pre-load pg so it's in the ESM cache before getPool() runs
    pgModule = await import('pg');
    OriginalPool = pgModule.default.Pool;

    // Import the module under test
    const conn = await import('../../../src/postgres/connection.js');
    getPool = conn.getPool;
    closePool = conn.closePool;
  });

  hooks.beforeEach(function () {
    // Replace Pool with a sinon stub that returns a fake pool object
    const fakePool = {
      query: sinon.stub().resolves(),
      end: sinon.stub().resolves(),
    };
    pgModule.default.Pool = sinon.stub().returns(fakePool);
  });

  hooks.afterEach(async function () {
    // Reset the singleton so each test gets a fresh getPool() call
    await closePool();
    sinon.restore();
  });

  hooks.after(function () {
    // Restore the original Pool constructor
    pgModule.default.Pool = OriginalPool;
  });

  // ── Assertion 1: keepalives pass-through ────────────────────────────
  test('Pool receives keepalives: true when pgConfig includes it', async function (assert) {
    await getPool({
      host: 'localhost', port: 5432, user: 'u', password: 'p',
      database: 'db', connectionLimit: 5,
      keepalives: true,
    }, []);

    const ctorArgs = pgModule.default.Pool.firstCall.args[0];
    assert.strictEqual(ctorArgs.keepalives, true, 'keepalives passed through');
  });

  // ── Assertion 2: keepalivesIdle pass-through ────────────────────────
  test('Pool receives keepalivesIdle: 60 when pgConfig includes it', async function (assert) {
    await getPool({
      host: 'localhost', port: 5432, user: 'u', password: 'p',
      database: 'db', connectionLimit: 5,
      keepalivesIdle: 60,
    }, []);

    const ctorArgs = pgModule.default.Pool.firstCall.args[0];
    assert.strictEqual(ctorArgs.keepalivesIdle, 60, 'keepalivesIdle passed through');
  });

  // ── Assertion 3: default idleTimeoutMillis preserved ────────────────
  test('Pool receives idleTimeoutMillis: 30000 when consumer does not override', async function (assert) {
    await getPool({
      host: 'localhost', port: 5432, user: 'u', password: 'p',
      database: 'db', connectionLimit: 5,
    }, []);

    const ctorArgs = pgModule.default.Pool.firstCall.args[0];
    assert.strictEqual(ctorArgs.idleTimeoutMillis, 30000, 'default idleTimeoutMillis preserved');
  });

  // ── Assertion 4: consumer override wins ─────────────────────────────
  test('Pool receives idleTimeoutMillis: 240000 when consumer overrides it', async function (assert) {
    await getPool({
      host: 'localhost', port: 5432, user: 'u', password: 'p',
      database: 'db', connectionLimit: 5,
      idleTimeoutMillis: 240000,
    }, []);

    const ctorArgs = pgModule.default.Pool.firstCall.args[0];
    assert.strictEqual(ctorArgs.idleTimeoutMillis, 240000, 'consumer override wins');
  });

  // ── Assertion 5: ORM-only fields stripped ───────────────────────────
  test('Pool does NOT receive migrationsDir or migrationsTable', async function (assert) {
    await getPool({
      host: 'localhost', port: 5432, user: 'u', password: 'p',
      database: 'db', connectionLimit: 5,
      migrationsDir: '/some/path',
      migrationsTable: 'schema_migrations',
    }, []);

    const ctorArgs = pgModule.default.Pool.firstCall.args[0];
    assert.false('migrationsDir' in ctorArgs, 'migrationsDir stripped');
    assert.false('migrationsTable' in ctorArgs, 'migrationsTable stripped');
  });

  // ── Assertion 6: connectionLimit → max rename preserved ─────────────
  test('Pool receives max: 10 when connectionLimit: 10', async function (assert) {
    await getPool({
      host: 'localhost', port: 5432, user: 'u', password: 'p',
      database: 'db', connectionLimit: 10,
    }, []);

    const ctorArgs = pgModule.default.Pool.firstCall.args[0];
    assert.strictEqual(ctorArgs.max, 10, 'connectionLimit mapped to max');
    assert.false('connectionLimit' in ctorArgs, 'connectionLimit itself not passed to Pool');
  });
});
