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
// null means MySQL is unavailable — tests should assert.expect(0) and return
export let pool = null;

/**
 * Setup MySQL integration test lifecycle.
 * Must be called AFTER setupIntegrationTests(hooks) so Orm.instance exists.
 * If MySQL is unreachable, pool stays null and tests should guard with:
 *   if (!pool) { assert.expect(0); return; }
 */
export function setupMysqlTests(hooks, { tables = [] } = {}) {
  let tableOrder = [];
  let tableNames = {};

  hooks.before(async function () {
    // Check if MySQL is reachable before attempting setup
    try {
      const conn = await mysql.createConnection(TEST_MYSQL_CONFIG);
      await conn.end();
    } catch {
      // MySQL not available — pool stays null, tests will skip
      return;
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
    if (!pool) return;

    await pool.execute('SET FOREIGN_KEY_CHECKS=0');
    for (const name of tableOrder) {
      await pool.execute(`TRUNCATE TABLE \`${tableNames[name]}\``);
    }
    await pool.execute('SET FOREIGN_KEY_CHECKS=1');
  });

  hooks.after(async function () {
    if (!pool) return;

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
