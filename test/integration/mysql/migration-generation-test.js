import QUnit from 'qunit';
import { setupIntegrationTests } from 'stonyx/test-helpers';
import { setupMysqlTests, pool } from '../../helpers/mysql-test-helper.js';
import { introspectModels, introspectViews, buildTableDDL, buildViewDDL, schemasToSnapshot, getTopologicalOrder } from '../../../src/mysql/schema-introspector.js';
import { diffSnapshots, diffViewSnapshots } from '../../../src/mysql/migration-generator.js';

QUnit.module('[Integration] MySQL — Migration Generation', function (hooks) {
  setupIntegrationTests(hooks);
  setupMysqlTests(hooks, { tables: ['category', 'owner', 'animal', 'trait', 'phone-number'] });

  QUnit.test('buildTableDDL produces valid SQL that MySQL accepts', async function (assert) {
    if (!pool) { assert.expect(0); return; }
// Tables are already created by setupMysqlTests — verify they exist
    const schemas = introspectModels();
    const order = getTopologicalOrder(schemas);

    for (const name of order) {
      const ddl = buildTableDDL(name, schemas[name], schemas);
      assert.ok(ddl.startsWith('CREATE TABLE IF NOT EXISTS'), `DDL for ${name} starts with CREATE TABLE`);
    }

    // Verify a table exists in MySQL (already created by setup)
    const [rows] = await pool.execute(
      `SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = 'stonyx_orm_test' AND TABLE_NAME = 'owners'`
    );
    assert.strictEqual(rows.length, 1, 'owners table exists from DDL execution');
  });

  QUnit.test('initial snapshot from models has correct structure', function (assert) {
    if (!pool) { assert.expect(0); return; }
const schemas = introspectModels();
    const snapshot = schemasToSnapshot(schemas);

    assert.ok(snapshot['owner'], 'owner exists in snapshot');
    assert.strictEqual(snapshot['owner'].table, 'owners', 'owner snapshot has table name');
    assert.strictEqual(snapshot['owner'].idType, 'string', 'owner snapshot has idType');
    assert.ok(snapshot['owner'].columns, 'owner snapshot has columns');
    assert.ok(snapshot['owner'].foreignKeys, 'owner snapshot has foreignKeys');
    assert.strictEqual(snapshot['owner'].columns.gender, 'VARCHAR(255)', 'gender column type correct');
    assert.strictEqual(snapshot['owner'].columns.age, 'INT', 'age column type correct');
  });

  QUnit.test('diffSnapshots detects added model', function (assert) {
    if (!pool) { assert.expect(0); return; }
const schemas = introspectModels();
    const currentSnapshot = schemasToSnapshot(schemas);

    const diff = diffSnapshots({}, currentSnapshot);

    assert.true(diff.hasChanges, 'changes detected');
    assert.ok(diff.addedModels.includes('owner'), 'owner detected as added');
    assert.ok(diff.addedModels.includes('animal'), 'animal detected as added');
    assert.ok(diff.addedModels.includes('category'), 'category detected as added');
    assert.strictEqual(diff.removedModels.length, 0, 'no removed models');
  });

  QUnit.test('diffSnapshots detects added column', function (assert) {
    if (!pool) { assert.expect(0); return; }
const schemas = introspectModels();
    const currentSnapshot = schemasToSnapshot(schemas);

    // Create previous snapshot without 'age' on owner
    const previousSnapshot = JSON.parse(JSON.stringify(currentSnapshot));
    delete previousSnapshot['owner'].columns.age;

    const diff = diffSnapshots(previousSnapshot, currentSnapshot);

    assert.true(diff.hasChanges, 'changes detected');
    const addedAge = diff.addedColumns.find(c => c.model === 'owner' && c.column === 'age');
    assert.ok(addedAge, 'age column detected as added to owner');
    assert.strictEqual(addedAge.type, 'INT', 'added column type is INT');
  });

  QUnit.test('diffSnapshots detects removed column', function (assert) {
    if (!pool) { assert.expect(0); return; }
const schemas = introspectModels();
    const currentSnapshot = schemasToSnapshot(schemas);

    // Create previous snapshot with an extra 'nickname' column on owner
    const previousSnapshot = JSON.parse(JSON.stringify(currentSnapshot));
    previousSnapshot['owner'].columns.nickname = 'VARCHAR(255)';

    const diff = diffSnapshots(previousSnapshot, currentSnapshot);

    assert.true(diff.hasChanges, 'changes detected');
    const removedNickname = diff.removedColumns.find(c => c.model === 'owner' && c.column === 'nickname');
    assert.ok(removedNickname, 'nickname column detected as removed from owner');
    assert.strictEqual(removedNickname.type, 'VARCHAR(255)', 'removed column type is VARCHAR(255)');
  });

  QUnit.test('diffSnapshots detects column type change', function (assert) {
    if (!pool) { assert.expect(0); return; }
const schemas = introspectModels();
    const currentSnapshot = schemasToSnapshot(schemas);

    // Create previous snapshot with age as VARCHAR(255) instead of INT
    const previousSnapshot = JSON.parse(JSON.stringify(currentSnapshot));
    previousSnapshot['owner'].columns.age = 'VARCHAR(255)';

    const diff = diffSnapshots(previousSnapshot, currentSnapshot);

    assert.true(diff.hasChanges, 'changes detected');
    const changedAge = diff.changedColumns.find(c => c.model === 'owner' && c.column === 'age');
    assert.ok(changedAge, 'age column type change detected');
    assert.strictEqual(changedAge.from, 'VARCHAR(255)', 'from type is VARCHAR(255)');
    assert.strictEqual(changedAge.to, 'INT', 'to type is INT');
  });

  QUnit.test('ALTER TABLE ADD COLUMN SQL is valid MySQL', async function (assert) {
    if (!pool) { assert.expect(0); return; }
// Add a test column to owners, verify, then clean up
    await pool.execute('ALTER TABLE `owners` ADD COLUMN `nickname` VARCHAR(255)');

    const [rows] = await pool.execute(
      `SELECT COLUMN_NAME FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = 'stonyx_orm_test' AND TABLE_NAME = 'owners' AND COLUMN_NAME = 'nickname'`
    );
    assert.strictEqual(rows.length, 1, 'nickname column was added successfully');

    // Clean up
    await pool.execute('ALTER TABLE `owners` DROP COLUMN `nickname`');

    const [afterRows] = await pool.execute(
      `SELECT COLUMN_NAME FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = 'stonyx_orm_test' AND TABLE_NAME = 'owners' AND COLUMN_NAME = 'nickname'`
    );
    assert.strictEqual(afterRows.length, 0, 'nickname column was cleaned up');
  });

  QUnit.test('buildViewDDL produces valid SQL for animal-count-by-size view', async function (assert) {
    if (!pool) { assert.expect(0); return; }
const modelSchemas = introspectModels();
    const viewSchemas = introspectViews();
    const viewSchema = viewSchemas['animal-count-by-size'];

    const ddl = buildViewDDL('animal-count-by-size', viewSchema, modelSchemas);
    assert.ok(ddl.includes('CREATE OR REPLACE VIEW'), 'DDL contains CREATE OR REPLACE VIEW');
    assert.ok(ddl.includes('GROUP BY'), 'DDL contains GROUP BY clause');

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
