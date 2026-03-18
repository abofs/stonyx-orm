import QUnit from 'qunit';
import { setupIntegrationTests } from 'stonyx/test-helpers';
import { setupMysqlTests, pool } from '../../helpers/mysql-test-helper.js';

QUnit.module('[Integration] MySQL — Schema Introspection', function (hooks) {
  setupIntegrationTests(hooks);
  setupMysqlTests(hooks, { tables: ['category', 'owner', 'animal', 'trait', 'phone-number'] });

  QUnit.test('all tables created successfully in MySQL', async function (assert) {
    if (!pool) { assert.expect(0); return; }
    const expectedTables = ['categories', 'owners', 'animals', 'traits', 'phone-numbers'];

    for (const tableName of expectedTables) {
      const [rows] = await pool.execute(
        `SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = 'stonyx_orm_test' AND TABLE_NAME = ?`,
        [tableName]
      );
      assert.strictEqual(rows.length, 1, `table '${tableName}' exists in MySQL`);
    }
  });

  QUnit.test('owner table has correct column types in MySQL', async function (assert) {
    if (!pool) { assert.expect(0); return; }
    const [rows] = await pool.execute(
      `SELECT COLUMN_NAME, DATA_TYPE, COLUMN_TYPE FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = 'stonyx_orm_test' AND TABLE_NAME = 'owners'
       ORDER BY ORDINAL_POSITION`
    );

    const columnMap = {};
    for (const row of rows) {
      columnMap[row.COLUMN_NAME] = row;
    }

    assert.strictEqual(columnMap.id.DATA_TYPE, 'varchar', 'id is varchar');
    assert.strictEqual(columnMap.gender.DATA_TYPE, 'varchar', 'gender is varchar');
    assert.strictEqual(columnMap.age.DATA_TYPE, 'int', 'age is int');
    assert.ok(columnMap.created_at, 'created_at column exists');
    assert.ok(columnMap.updated_at, 'updated_at column exists');
  });

  QUnit.test('animal table FK constraint references owners', async function (assert) {
    if (!pool) { assert.expect(0); return; }
    const [rows] = await pool.execute(
      `SELECT COLUMN_NAME, REFERENCED_TABLE_NAME, REFERENCED_COLUMN_NAME
       FROM information_schema.KEY_COLUMN_USAGE
       WHERE TABLE_SCHEMA = 'stonyx_orm_test'
         AND TABLE_NAME = 'animals'
         AND REFERENCED_TABLE_NAME IS NOT NULL`
    );

    assert.ok(rows.length > 0, 'FK constraint exists on animals table');
    const ownerFk = rows.find(r => r.REFERENCED_TABLE_NAME === 'owners');
    assert.ok(ownerFk, 'FK references owners table');
    assert.strictEqual(ownerFk.COLUMN_NAME, 'owner_id', 'FK column is owner_id');
    assert.strictEqual(ownerFk.REFERENCED_COLUMN_NAME, 'id', 'FK references id column');
  });
});
