import QUnit from 'qunit';
import { setupIntegrationTests } from 'stonyx/test-helpers';
import { setupMysqlTests, pool } from '../../helpers/mysql-test-helper.js';
import { introspectModels, introspectViews, getTopologicalOrder } from '../../../src/mysql/schema-introspector.js';

QUnit.module('[Integration] MySQL — Schema Introspection', function (hooks) {
  setupIntegrationTests(hooks);
  setupMysqlTests(hooks, { tables: ['category', 'owner', 'animal', 'trait', 'phone-number'] });

  QUnit.test('introspectModels returns schemas for all sample models', function (assert) {
const schemas = introspectModels();

    assert.ok(schemas['owner'], 'owner schema exists');
    assert.ok(schemas['animal'], 'animal schema exists');
    assert.ok(schemas['category'], 'category schema exists');
    assert.ok(schemas['trait'], 'trait schema exists');
    assert.ok(schemas['phone-number'], 'phone-number schema exists');
  });

  QUnit.test('owner schema has correct table name, id type, and column types', function (assert) {
const schemas = introspectModels();
    const owner = schemas['owner'];

    assert.strictEqual(owner.table, 'owners', 'table name is owners');
    assert.strictEqual(owner.idType, 'string', 'id type is string');
    assert.strictEqual(owner.columns.gender, 'VARCHAR(255)', 'gender column is VARCHAR(255)');
    assert.strictEqual(owner.columns.age, 'INT', 'age column is INT');
  });

  QUnit.test('animal schema has FK to owner', function (assert) {
const schemas = introspectModels();
    const animal = schemas['animal'];

    assert.ok(animal.foreignKeys.owner_id, 'owner_id FK exists');
    assert.strictEqual(animal.foreignKeys.owner_id.references, 'owners', 'FK references owners table');
    assert.strictEqual(animal.foreignKeys.owner_id.column, 'id', 'FK references id column');
  });

  QUnit.test('all tables created successfully in MySQL', async function (assert) {
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

  QUnit.test('topological order places parents before children', function (assert) {
const schemas = introspectModels();
    const order = getTopologicalOrder(schemas);

    const ownerIdx = order.indexOf('owner');
    const animalIdx = order.indexOf('animal');
    const categoryIdx = order.indexOf('category');
    const traitIdx = order.indexOf('trait');

    assert.ok(ownerIdx < animalIdx, 'owner comes before animal');
    assert.ok(categoryIdx < traitIdx, 'category comes before trait');
  });

  QUnit.test('introspectViews returns schemas for sample views', function (assert) {
const viewSchemas = introspectViews();

    assert.ok(viewSchemas['owner-animal-count'], 'owner-animal-count view schema exists');
    assert.ok(viewSchemas['animal-count-by-size'], 'animal-count-by-size view schema exists');
  });

  QUnit.test('owner-animal-count view schema has correct structure', function (assert) {
const viewSchemas = introspectViews();
    const view = viewSchemas['owner-animal-count'];

    assert.strictEqual(view.source, 'owner', 'source is owner');
    assert.true(view.isView, 'isView is true');
    assert.ok(view.aggregates.animalCount, 'animalCount aggregate exists');
    assert.strictEqual(view.aggregates.animalCount.aggregateType, 'count', 'animalCount is a count aggregate');
  });

  QUnit.test('animal-count-by-size view schema has groupBy size', function (assert) {
const viewSchemas = introspectViews();
    const view = viewSchemas['animal-count-by-size'];

    assert.strictEqual(view.groupBy, 'size', 'groupBy is size');
    assert.strictEqual(view.source, 'animal', 'source is animal');
    assert.true(view.isView, 'isView is true');
  });
});
