// test/helpers/timescale-test-helper.ts
import pg from 'pg';
import { introspectModels, buildTableDDL, buildVectorIndexDDL, getTopologicalOrder } from '../../src/postgres/schema-introspector.js';
import TimescaleDB from '../../src/timescale/timescale-db.js';
import PostgresDB from '../../src/postgres/postgres-db.js';

const TEST_TS_CONFIG = {
  host: 'localhost',
  port: 5434,
  user: 'postgres',
  password: 'testpass',
  database: 'stonyx_test',
  max: 5,
};

// Shared pool reference — importable by test files
// null means TimescaleDB is unavailable — tests should assert.expect(0) and return
export let pool: any = null;

/**
 * Setup TimescaleDB integration test lifecycle.
 * Must be called AFTER setupIntegrationTests(hooks) so Orm.instance exists.
 * If TimescaleDB is unreachable, pool stays null and tests should guard with:
 *   if (!pool) { assert.expect(0); return; }
 */
export function setupTimescaleTests(hooks: any, { tables = [] as string[] } = {}) {
  let tableOrder: string[] = [];
  let tableNames: Record<string, string> = {};

  hooks.before(async function () {
    // Check if TimescaleDB is reachable before attempting setup
    try {
      const client = new (pg as any).Client(TEST_TS_CONFIG);
      await client.connect();
      await client.query('CREATE EXTENSION IF NOT EXISTS timescaledb');
      await client.end();
    } catch {
      // TimescaleDB not available — pool stays null, tests will skip
      return;
    }

    // Create pool
    pool = new (pg as any).Pool(TEST_TS_CONFIG);

    // Reset singletons
    (TimescaleDB as any).instance = null;
    (PostgresDB as any).instance = null;

    // Introspect schemas from the now-initialized ORM
    const schemas: any = introspectModels();
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
    (TimescaleDB as any).instance = null;
    (PostgresDB as any).instance = null;
  });

  hooks.afterEach(async function () {
    (TimescaleDB as any).instance = null;
    (PostgresDB as any).instance = null;
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

    (TimescaleDB as any).instance = null;
    (PostgresDB as any).instance = null;
  });
}

export { TEST_TS_CONFIG };
