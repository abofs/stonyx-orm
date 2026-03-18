import QUnit from 'qunit';
import { setupIntegrationTests } from 'stonyx/test-helpers';
import { setupMysqlTests, pool, skipIfNoMysql } from '../../helpers/mysql-test-helper.js';
import MysqlDB from '../../../src/mysql/mysql-db.js';
import { introspectModels, introspectViews } from '../../../src/mysql/schema-introspector.js';
import { buildInsert, buildUpdate, buildDelete, buildSelect } from '../../../src/mysql/query-builder.js';
import { createRecord, store } from '@stonyx/orm';

QUnit.module('[Integration] MySQL — FK Resolution', function (hooks) {
  setupIntegrationTests(hooks);
  setupMysqlTests(hooks, { tables: ['category', 'owner', 'animal', 'trait', 'phone-number'] });

  function createDb() {
    MysqlDB.instance = null;
    const db = new MysqlDB({
      getPool: async () => pool,
      config: { orm: { mysql: { migrationsTable: '__test_migrations' } }, rootPath: '.' },
      introspectModels,
      introspectViews: () => ({}),
      buildInsert,
      buildUpdate,
      buildDelete,
      buildSelect,
      createRecord,
      store,
    });
    db.pool = pool;
    return db;
  }

  QUnit.test('_recordToRow extracts FK value from relationship', function (assert) {
    if (skipIfNoMysql(assert)) return;

    const db = createDb();
    const schemas = introspectModels();
    const animalSchema = schemas['animal'];

    // Create an owner record in the store
    const owner = createRecord('owner', { id: 'fk-owner-1', gender: 'male', age: 30 });

    // Create an animal record with the owner relationship
    const animal = createRecord('animal', { id: 1, type: 'dog', age: 3, size: 'large', owner: 'fk-owner-1' });

    const row = db._recordToRow(animal, animalSchema);

    assert.ok(row.owner_id !== undefined, 'row has owner_id');
    assert.strictEqual(row.owner_id, 'fk-owner-1', 'owner_id extracted from relationship');
  });

  QUnit.test('round-trip: insert with FK and read back with FK remapped', async function (assert) {
    if (skipIfNoMysql(assert)) return;

    const db = createDb();

    // Insert owner directly into MySQL
    await pool.execute(
      'INSERT INTO `owners` (`id`, `gender`, `age`) VALUES (?, ?, ?)',
      ['rt-owner-1', 'female', 28]
    );

    // Insert animal with FK to owner
    await pool.execute(
      'INSERT INTO `animals` (`type`, `age`, `size`, `owner_id`) VALUES (?, ?, ?, ?)',
      ['{"name":"dog"}', 5, 'medium', 'rt-owner-1']
    );

    // Get the auto-increment ID
    const [inserted] = await pool.execute('SELECT id FROM `animals` WHERE `owner_id` = ?', ['rt-owner-1']);
    const animalId = inserted[0].id;

    // Read back via findRecord
    const record = await db.findRecord('animal', animalId);

    assert.ok(record, 'animal record found');
    assert.strictEqual(record.__data.owner, 'rt-owner-1', 'owner FK remapped from owner_id to owner');
  });

  QUnit.test('findAll with FK condition filters correctly', async function (assert) {
    if (skipIfNoMysql(assert)) return;

    const db = createDb();

    // Insert 2 owners
    await pool.execute('INSERT INTO `owners` (`id`, `gender`, `age`) VALUES (?, ?, ?)', ['filter-o1', 'male', 25]);
    await pool.execute('INSERT INTO `owners` (`id`, `gender`, `age`) VALUES (?, ?, ?)', ['filter-o2', 'female', 30]);

    // Insert 3 animals: 2 for owner1, 1 for owner2
    await pool.execute('INSERT INTO `animals` (`type`, `age`, `size`, `owner_id`) VALUES (?, ?, ?, ?)', ['{"name":"cat"}', 2, 'small', 'filter-o1']);
    await pool.execute('INSERT INTO `animals` (`type`, `age`, `size`, `owner_id`) VALUES (?, ?, ?, ?)', ['{"name":"dog"}', 4, 'large', 'filter-o1']);
    await pool.execute('INSERT INTO `animals` (`type`, `age`, `size`, `owner_id`) VALUES (?, ?, ?, ?)', ['{"name":"bird"}', 1, 'small', 'filter-o2']);

    const records = await db.findAll('animal', { owner_id: 'filter-o1' });

    assert.strictEqual(records.length, 2, 'only animals belonging to filter-o1 returned');
  });

  QUnit.test('trait belongsTo category with string FK', async function (assert) {
    if (skipIfNoMysql(assert)) return;

    const db = createDb();

    // Insert category with string ID
    await pool.execute('INSERT INTO `categories` (`id`, `name`) VALUES (?, ?)', ['cat-behavior', 'Behavior']);

    // Insert trait referencing category
    await pool.execute(
      'INSERT INTO `traits` (`type`, `value`, `category_id`) VALUES (?, ?, ?)',
      ['personality', 'friendly', 'cat-behavior']
    );

    // Get the auto-increment ID
    const [inserted] = await pool.execute('SELECT id FROM `traits` WHERE `category_id` = ?', ['cat-behavior']);
    const traitId = inserted[0].id;

    // Read back via findRecord
    const record = await db.findRecord('trait', traitId);

    assert.ok(record, 'trait record found');
    assert.strictEqual(record.__data.category, 'cat-behavior', 'category FK remapped with string value');
  });
});
