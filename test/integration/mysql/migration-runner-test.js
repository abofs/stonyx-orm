import QUnit from 'qunit';
import mysql from 'mysql2/promise';
import { setupIntegrationTests } from 'stonyx/test-helpers';
import { ensureMigrationsTable, getAppliedMigrations, applyMigration, rollbackMigration, parseMigrationFile } from '../../../src/mysql/migration-runner.js';

const TEST_CONFIG = {
  host: 'localhost',
  port: 3306,
  user: 'stonyx_test',
  password: 'stonyx_test',
  database: 'stonyx_orm_test',
};
const MIGRATIONS_TABLE = '__test_runner_migrations';

let testPool;

QUnit.module('[Integration] MySQL — Migration Runner', function (hooks) {
  setupIntegrationTests(hooks);

  hooks.before(async function () {
    try {
      const conn = await mysql.createConnection({
        host: 'localhost', port: 3306, user: 'stonyx_test',
        password: 'stonyx_test', database: 'stonyx_orm_test',
      });
      await conn.end();
    } catch {
      return; // MySQL not available — testPool stays null
    }
    testPool = mysql.createPool(TEST_CONFIG);
  });

  hooks.afterEach(async function () {
    if (!testPool) return;

    // Clean up: drop migrations table and test_items table
    await testPool.execute('SET FOREIGN_KEY_CHECKS=0');
    await testPool.execute(`DROP TABLE IF EXISTS \`${MIGRATIONS_TABLE}\``);
    await testPool.execute('DROP TABLE IF EXISTS `test_items`');
    await testPool.execute('SET FOREIGN_KEY_CHECKS=1');
  });

  hooks.after(async function () {
    if (testPool) {
      await testPool.end();
      testPool = null;
    }
  });

  QUnit.test('ensureMigrationsTable creates the tracking table', async function (assert) {
    if (!testPool) { assert.expect(0); return; }
    await ensureMigrationsTable(testPool, MIGRATIONS_TABLE);

    const [rows] = await testPool.execute(
      `SELECT TABLE_NAME FROM information_schema.TABLES
       WHERE TABLE_SCHEMA = 'stonyx_orm_test' AND TABLE_NAME = ?`,
      [MIGRATIONS_TABLE]
    );
    assert.strictEqual(rows.length, 1, 'migrations table was created');
  });

  QUnit.test('ensureMigrationsTable is idempotent', async function (assert) {
    if (!testPool) { assert.expect(0); return; }
    await ensureMigrationsTable(testPool, MIGRATIONS_TABLE);
    await ensureMigrationsTable(testPool, MIGRATIONS_TABLE);

    const [rows] = await testPool.execute(
      `SELECT TABLE_NAME FROM information_schema.TABLES
       WHERE TABLE_SCHEMA = 'stonyx_orm_test' AND TABLE_NAME = ?`,
      [MIGRATIONS_TABLE]
    );
    assert.strictEqual(rows.length, 1, 'migrations table still exists after second call');
  });

  QUnit.test('applyMigration executes SQL and records in tracking table', async function (assert) {
    if (!testPool) { assert.expect(0); return; }
    await ensureMigrationsTable(testPool, MIGRATIONS_TABLE);

    const upSql = 'CREATE TABLE `test_items` (`id` INT AUTO_INCREMENT PRIMARY KEY, `name` VARCHAR(255))';
    await applyMigration(testPool, '001_create_test_items.sql', upSql, MIGRATIONS_TABLE);

    // Verify table was created
    const [tableRows] = await testPool.execute(
      `SELECT TABLE_NAME FROM information_schema.TABLES
       WHERE TABLE_SCHEMA = 'stonyx_orm_test' AND TABLE_NAME = 'test_items'`
    );
    assert.strictEqual(tableRows.length, 1, 'test_items table was created');

    // Verify migration was recorded
    const applied = await getAppliedMigrations(testPool, MIGRATIONS_TABLE);
    assert.ok(applied.includes('001_create_test_items.sql'), 'migration recorded in tracking table');
  });

  QUnit.test('re-applying already-applied migration is skipped via pending filter', async function (assert) {
    if (!testPool) { assert.expect(0); return; }
    await ensureMigrationsTable(testPool, MIGRATIONS_TABLE);

    const upSql = 'CREATE TABLE `test_items` (`id` INT AUTO_INCREMENT PRIMARY KEY, `name` VARCHAR(255))';
    await applyMigration(testPool, '001_create_test_items.sql', upSql, MIGRATIONS_TABLE);

    // Simulate pending check: filter out already-applied migrations
    const applied = await getAppliedMigrations(testPool, MIGRATIONS_TABLE);
    const allMigrations = ['001_create_test_items.sql'];
    const pending = allMigrations.filter(f => !applied.includes(f));

    assert.strictEqual(pending.length, 0, 'no pending migrations after applying');
  });

  QUnit.test('getAppliedMigrations returns empty array when none applied', async function (assert) {
    if (!testPool) { assert.expect(0); return; }
    await ensureMigrationsTable(testPool, MIGRATIONS_TABLE);

    const applied = await getAppliedMigrations(testPool, MIGRATIONS_TABLE);
    assert.deepEqual(applied, [], 'returns empty array');
  });

  QUnit.test('applyMigration rolls back on SQL error', async function (assert) {
    if (!testPool) { assert.expect(0); return; }
    await ensureMigrationsTable(testPool, MIGRATIONS_TABLE);

    const badSql = 'CREATE TABLE `test_items` (`id` INT PRIMARY KEY); INSERT INTO `nonexistent_table` VALUES (1)';

    try {
      await applyMigration(testPool, '002_bad_migration.sql', badSql, MIGRATIONS_TABLE);
      assert.ok(false, 'should have thrown an error');
    } catch (error) {
      assert.ok(error, 'error was thrown');
    }

    // Verify migration was NOT recorded
    const applied = await getAppliedMigrations(testPool, MIGRATIONS_TABLE);
    assert.notOk(applied.includes('002_bad_migration.sql'), 'failed migration was not recorded');
  });

  QUnit.test('rollbackMigration executes DOWN SQL and removes tracking record', async function (assert) {
    if (!testPool) { assert.expect(0); return; }
    await ensureMigrationsTable(testPool, MIGRATIONS_TABLE);

    // First apply a migration
    const upSql = 'CREATE TABLE `test_items` (`id` INT AUTO_INCREMENT PRIMARY KEY, `name` VARCHAR(255))';
    await applyMigration(testPool, '001_create_test_items.sql', upSql, MIGRATIONS_TABLE);

    // Verify it was applied
    let applied = await getAppliedMigrations(testPool, MIGRATIONS_TABLE);
    assert.ok(applied.includes('001_create_test_items.sql'), 'migration was applied');

    // Rollback
    const downSql = 'DROP TABLE IF EXISTS `test_items`';
    await rollbackMigration(testPool, '001_create_test_items.sql', downSql, MIGRATIONS_TABLE);

    // Verify table was dropped
    const [tableRows] = await testPool.execute(
      `SELECT TABLE_NAME FROM information_schema.TABLES
       WHERE TABLE_SCHEMA = 'stonyx_orm_test' AND TABLE_NAME = 'test_items'`
    );
    assert.strictEqual(tableRows.length, 0, 'test_items table was dropped');

    // Verify migration record was removed
    applied = await getAppliedMigrations(testPool, MIGRATIONS_TABLE);
    assert.notOk(applied.includes('001_create_test_items.sql'), 'migration record was removed');
  });

  QUnit.test('parseMigrationFile splits UP and DOWN sections', function (assert) {
    if (!testPool) { assert.expect(0); return; }
    const content = `-- UP
CREATE TABLE \`items\` (\`id\` INT PRIMARY KEY);
ALTER TABLE \`items\` ADD COLUMN \`name\` VARCHAR(255);

-- DOWN
DROP TABLE IF EXISTS \`items\`;`;

    const { up, down } = parseMigrationFile(content);

    assert.ok(up.includes('CREATE TABLE'), 'UP section contains CREATE TABLE');
    assert.ok(up.includes('ALTER TABLE'), 'UP section contains ALTER TABLE');
    assert.ok(down.includes('DROP TABLE'), 'DOWN section contains DROP TABLE');
    assert.notOk(up.includes('DROP TABLE'), 'UP section does not contain DROP TABLE');
    assert.notOk(down.includes('CREATE TABLE'), 'DOWN section does not contain CREATE TABLE');
  });
});
