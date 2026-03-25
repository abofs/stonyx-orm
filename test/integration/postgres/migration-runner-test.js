import QUnit from 'qunit';
import { pool } from '../../helpers/postgres-test-helper.js';
import { ensureMigrationsTable, applyMigration, getAppliedMigrations, rollbackMigration } from '../../../src/postgres/migration-runner.js';

const { module, test } = QUnit;

module('[Integration] Postgres Migration Runner', function (hooks) {
  hooks.before(async function () {
    if (!pool) return;
    await pool.query('DROP TABLE IF EXISTS "__test_migrations"');
  });

  hooks.after(async function () {
    if (!pool) return;
    await pool.query('DROP TABLE IF EXISTS "__test_migrations"');
    await pool.query('DROP TABLE IF EXISTS "__test_table"');
  });

  test('ensureMigrationsTable creates the tracking table', async function (assert) {
    if (!pool) { assert.expect(0); return; }

    await ensureMigrationsTable(pool, '__test_migrations');

    const result = await pool.query(
      "SELECT table_name FROM information_schema.tables WHERE table_name = '__test_migrations'"
    );
    assert.strictEqual(result.rows.length, 1);
  });

  test('applyMigration executes SQL and records in tracking table', async function (assert) {
    if (!pool) { assert.expect(0); return; }

    await ensureMigrationsTable(pool, '__test_migrations');

    const upSql = 'CREATE TABLE "__test_table" ("id" INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY, "name" VARCHAR(255))';
    await applyMigration(pool, '001_test.sql', upSql, '__test_migrations');

    const applied = await getAppliedMigrations(pool, '__test_migrations');
    assert.true(applied.includes('001_test.sql'));

    const tableCheck = await pool.query(
      "SELECT table_name FROM information_schema.tables WHERE table_name = '__test_table'"
    );
    assert.strictEqual(tableCheck.rows.length, 1);
  });

  test('rollbackMigration reverses and removes tracking entry', async function (assert) {
    if (!pool) { assert.expect(0); return; }

    const downSql = 'DROP TABLE IF EXISTS "__test_table"';
    await rollbackMigration(pool, '001_test.sql', downSql, '__test_migrations');

    const applied = await getAppliedMigrations(pool, '__test_migrations');
    assert.false(applied.includes('001_test.sql'));
  });
});
