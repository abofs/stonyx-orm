import { introspectModels, buildTableDDL, getTopologicalOrder } from '../../src/postgres/schema-introspector.js';
import PostgresDB from '../../src/postgres/postgres-db.js';

const TEST_PG_CONFIG = {
  host: process.env.PG_TEST_HOST || 'localhost',
  port: parseInt(process.env.PG_TEST_PORT || '5432'),
  user: process.env.PG_TEST_USER || 'stonyx_test',
  password: process.env.PG_TEST_PASSWORD || 'stonyx_test',
  database: process.env.PG_TEST_DATABASE || 'stonyx_orm_test',
  connectionLimit: 5,
};

export let pool = null;

export function setupPostgresTests(hooks, { tables = [] } = {}) {
  let tableOrder = [];
  let tableNames = {};

  hooks.before(async function () {
    try {
      const pg = await import('pg');
      const { Pool } = pg.default;
      const testPool = new Pool(TEST_PG_CONFIG);
      await testPool.query('SELECT 1');
      pool = testPool;
    } catch {
      return;
    }

    PostgresDB.instance = null;

    const schemas = introspectModels();
    const fullOrder = getTopologicalOrder(schemas);
    tableOrder = fullOrder.filter(name => tables.includes(name));

    for (const name of tableOrder) {
      tableNames[name] = schemas[name].table;
    }

    for (const name of tableOrder) {
      const ddl = buildTableDDL(name, schemas[name], schemas);
      const statements = ddl.split(';').map(s => s.trim()).filter(s => s.length > 0 && !s.startsWith('--'));
      for (const stmt of statements) {
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

    await pool.end();
    pool = null;
    PostgresDB.instance = null;
  });
}
