import QUnit from 'qunit';
import { setupIntegrationTests } from 'stonyx/test-helpers';
import { setupMysqlTests, pool } from '../../helpers/mysql-test-helper.js';
import { introspectModels, introspectViews, buildViewDDL } from '../../../src/mysql/schema-introspector.js';

QUnit.module('[Integration] MySQL — Migration Generation', function (hooks) {
  setupIntegrationTests(hooks);
  setupMysqlTests(hooks, { tables: ['category', 'owner', 'animal', 'trait', 'phone-number'] });

  QUnit.test('buildTableDDL produces valid SQL that MySQL accepts', async function (assert) {
    if (!pool) { assert.expect(0); return; }
    // Tables are already created by setupMysqlTests using buildTableDDL — verify they exist
    const [rows] = await pool.execute(
      `SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = 'stonyx_orm_test' AND TABLE_NAME = 'owners'`
    );
    assert.strictEqual(rows.length, 1, 'owners table exists from DDL execution');
  });

  QUnit.test('ALTER TABLE ADD COLUMN SQL is valid MySQL', async function (assert) {
    if (!pool) { assert.expect(0); return; }
    await pool.execute('ALTER TABLE `owners` ADD COLUMN `nickname` VARCHAR(255)');

    const [rows] = await pool.execute(
      `SELECT COLUMN_NAME FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = 'stonyx_orm_test' AND TABLE_NAME = 'owners' AND COLUMN_NAME = 'nickname'`
    );
    assert.strictEqual(rows.length, 1, 'nickname column was added successfully');

    // Clean up
    await pool.execute('ALTER TABLE `owners` DROP COLUMN `nickname`');
  });

  QUnit.test('buildViewDDL produces valid SQL for animal-count-by-size view', async function (assert) {
    if (!pool) { assert.expect(0); return; }
    const modelSchemas = introspectModels();
    const viewSchemas = introspectViews();
    const viewSchema = viewSchemas['animal-count-by-size'];

    const ddl = buildViewDDL('animal-count-by-size', viewSchema, modelSchemas);

    // Execute the DDL — should succeed
    await pool.execute(ddl);

    // Verify view exists in information_schema
    const [rows] = await pool.execute(
      `SELECT TABLE_NAME FROM information_schema.VIEWS
       WHERE TABLE_SCHEMA = 'stonyx_orm_test' AND TABLE_NAME = 'animal-count-by-sizes'`
    );
    assert.strictEqual(rows.length, 1, 'view exists in information_schema');

    // Clean up
    await pool.execute('DROP VIEW IF EXISTS `animal-count-by-sizes`');
  });
});
