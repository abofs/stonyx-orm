import QUnit from 'qunit';
import { setupIntegrationTests } from 'stonyx/test-helpers';
import { canConnectToMysql, setupMysqlTests, pool } from '../../helpers/mysql-test-helper.js';

const mysqlAvailable = await canConnectToMysql();
const moduleFunc = mysqlAvailable || !process.env.CI ? QUnit.module : QUnit.module.skip;

moduleFunc('[Integration] MySQL — Schema Introspection (smoke test)', function (hooks) {
  setupIntegrationTests(hooks);
  setupMysqlTests(hooks, { tables: ['owner'] });

  QUnit.test('owner table is created and queryable', async function (assert) {
    const [rows] = await pool.execute('SHOW TABLES LIKE "owners"');
    assert.strictEqual(rows.length, 1, 'owners table exists');
  });
});
