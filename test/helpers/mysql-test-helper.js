// test/helpers/mysql-test-helper.js
import mysql from 'mysql2/promise';
import { introspectModels, buildTableDDL, getTopologicalOrder } from '../../src/mysql/schema-introspector.js';
import MysqlDB from '../../src/mysql/mysql-db.js';

const TEST_MYSQL_CONFIG = {
  host: 'localhost',
  port: 3306,
  user: 'stonyx_test',
  password: 'stonyx_test',
  database: 'stonyx_orm_test',
  connectionLimit: 5,
};

// Shared pool reference — importable by test files
export let pool = null;

// Flag for tests to check — set during setupMysqlTests hooks.before
export let mysqlSkipped = false;

/**
 * Check if MySQL is reachable.
 */
export async function canConnectToMysql() {
  try {
    const conn = await mysql.createConnection(TEST_MYSQL_CONFIG);
    await conn.end();
    return true;
  } catch {
    return false;
  }
}

/**
 * Returns true if the test should be skipped (call at start of each test).
 * Usage: if (skipIfNoMysql(assert)) return;
 */
export function skipIfNoMysql(assert) {
  if (mysqlSkipped) {
    assert.expect(0);
    return true;
  }
  return false;
}

/**
 * Setup MySQL integration test lifecycle.
 * Must be called AFTER setupIntegrationTests(hooks) so Orm.instance exists.
 * Handles connectivity check internally — no top-level await needed.
 */
export function setupMysqlTests(hooks, { tables = [] } = {}) {
  let tableOrder = [];
  let tableNames = {};

  hooks.before(async function () {
    // Check connectivity
    const available = await canConnectToMysql();
    if (!available) {
      if (process.env.CI) {
        mysqlSkipped = true;
        return; // Skip setup in CI when MySQL unavailable
      }
      // Locally, let it fail naturally by proceeding (pool creation will error)
    }

    // Create pool
    pool = mysql.createPool(TEST_MYSQL_CONFIG);

    // Reset MysqlDB singleton
    MysqlDB.instance = null;

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
      await pool.execute(ddl);
    }
  });

  hooks.beforeEach(function () {
    MysqlDB.instance = null;
  });

  hooks.afterEach(async function () {
    MysqlDB.instance = null;
    if (mysqlSkipped || !pool) return;

    await pool.execute('SET FOREIGN_KEY_CHECKS=0');
    for (const name of tableOrder) {
      await pool.execute(`TRUNCATE TABLE \`${tableNames[name]}\``);
    }
    await pool.execute('SET FOREIGN_KEY_CHECKS=1');
  });

  hooks.after(async function () {
    if (mysqlSkipped || !pool) return;

    await pool.execute('SET FOREIGN_KEY_CHECKS=0');
    for (const name of [...tableOrder].reverse()) {
      await pool.execute(`DROP TABLE IF EXISTS \`${tableNames[name]}\``);
    }
    await pool.execute('SET FOREIGN_KEY_CHECKS=1');

    if (pool) {
      await pool.end();
      pool = null;
    }

    MysqlDB.instance = null;
  });
}
