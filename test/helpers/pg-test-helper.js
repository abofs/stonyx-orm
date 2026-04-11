// test/helpers/pg-test-helper.js
import pg from 'pg';
import { introspectModels, buildTableDDL, buildVectorIndexDDL, getTopologicalOrder } from '../../src/postgres/schema-introspector.js';
import PostgresDB from '../../src/postgres/postgres-db.js';

const TEST_PG_CONFIG = {
  host: 'localhost',
  port: 5433,
  user: 'postgres',
  password: 'testpass',
  database: 'stonyx_test',
  max: 5,
};

// Shared pool reference — importable by test files
// null means PostgreSQL is unavailable — tests should assert.expect(0) and return
export let pool = null;

/**
 * Setup PostgreSQL integration test lifecycle.
 * Must be called AFTER setupIntegrationTests(hooks) so Orm.instance exists.
 * If PostgreSQL is unreachable, pool stays null and tests should guard with:
 *   if (!pool) { assert.expect(0); return; }
 */
export function setupPgTests(hooks, { tables = [] } = {}) {
  let tableOrder = [];
  let tableNames = {};

  hooks.before(async function () {
    // Check if PostgreSQL is reachable before attempting setup
    try {
      const client = new pg.Client(TEST_PG_CONFIG);
      await client.connect();
      await client.query('CREATE EXTENSION IF NOT EXISTS vector');
      await client.end();
    } catch {
      // PostgreSQL not available — pool stays null, tests will skip
      return;
    }

    // Create pool
    pool = new pg.Pool(TEST_PG_CONFIG);

    // Reset PostgresDB singleton
    PostgresDB.instance = null;

    // Introspect schemas from the now-initialized ORM
    const schemas = introspectModels();
    const fullOrder = getTopologicalOrder(schemas);

    // Filter to requested tables, maintaining topological order
    tableOrder = fullOrder.filter(name => tables.includes(name));

    // Cache table name mapping
    for (const name of tableOrder) {
      tableNames[name] = schemas[name].table;
    }

    // Create tables in topological order (parents first)
    for (const name of tableOrder) {
      const ddl = buildTableDDL(name, schemas[name], schemas);
      await pool.query(ddl);

      // Create HNSW indexes for vector columns
      const indexStatements = buildVectorIndexDDL(name, schemas[name]);
      for (const stmt of indexStatements) {
        await pool.query(stmt);
      }
    }
  });

  hooks.beforeEach(function () {
    PostgresDB.instance = null;
  });

  hooks.afterEach(async function () {
    PostgresDB.instance = null;
    if (!pool) return;

    for (const name of tableOrder) {
      await pool.query(`TRUNCATE TABLE "${tableNames[name]}" CASCADE`);
    }
  });

  hooks.after(async function () {
    if (!pool) return;

    for (const name of [...tableOrder].reverse()) {
      await pool.query(`DROP TABLE IF EXISTS "${tableNames[name]}" CASCADE`);
    }

    if (pool) {
      await pool.end();
      pool = null;
    }

    PostgresDB.instance = null;
  });
}

export { TEST_PG_CONFIG };
