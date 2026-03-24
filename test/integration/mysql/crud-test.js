import QUnit from 'qunit';
import { setupIntegrationTests } from 'stonyx/test-helpers';
import { setupMysqlTests, pool } from '../../helpers/mysql-test-helper.js';
import MysqlDB from '../../../src/mysql/mysql-db.js';
import { introspectModels, introspectViews } from '../../../src/mysql/schema-introspector.js';
import { buildInsert, buildUpdate, buildDelete, buildSelect } from '../../../src/mysql/query-builder.js';
import { createRecord, store } from '@stonyx/orm';

QUnit.module('[Integration] MySQL — CRUD', function (hooks) {
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

  QUnit.test('_persistCreate inserts a record with string id', async function (assert) {
    if (!pool) { assert.expect(0); return; }
    const db = createDb();

    const record = createRecord('owner', { id: 'owner-1', gender: 'male', age: 30 });
    await db._persistCreate('owner', {}, { data: { id: 'owner-1' } });

    const [rows] = await pool.execute('SELECT * FROM `owners` WHERE `id` = ?', ['owner-1']);
    assert.strictEqual(rows.length, 1, 'record inserted into MySQL');
    assert.strictEqual(rows[0].id, 'owner-1', 'correct id');
    assert.strictEqual(rows[0].gender, 'male', 'correct gender');
    assert.strictEqual(rows[0].age, 30, 'correct age');
  });

  QUnit.test('findRecord reads back a record from MySQL', async function (assert) {
    if (!pool) { assert.expect(0); return; }
    const db = createDb();

    await pool.execute(
      'INSERT INTO `owners` (`id`, `gender`, `age`) VALUES (?, ?, ?)',
      ['owner-read-1', 'female', 25]
    );

    const record = await db.findRecord('owner', 'owner-read-1');

    assert.ok(record, 'record was found');
    assert.strictEqual(record.id, 'owner-read-1', 'correct id');
    assert.strictEqual(record.__data.gender, 'female', 'correct gender');
    assert.strictEqual(record.__data.age, 25, 'correct age');
  });

  QUnit.test('findAll returns all records', async function (assert) {
    if (!pool) { assert.expect(0); return; }
    const db = createDb();

    await pool.execute('INSERT INTO `owners` (`id`, `gender`, `age`) VALUES (?, ?, ?)', ['o1', 'male', 20]);
    await pool.execute('INSERT INTO `owners` (`id`, `gender`, `age`) VALUES (?, ?, ?)', ['o2', 'female', 30]);
    await pool.execute('INSERT INTO `owners` (`id`, `gender`, `age`) VALUES (?, ?, ?)', ['o3', 'male', 40]);

    const records = await db.findAll('owner');

    assert.strictEqual(records.length, 3, 'all 3 records returned');
  });

  QUnit.test('_persistUpdate writes only changed columns', async function (assert) {
    if (!pool) { assert.expect(0); return; }
    const db = createDb();

    await pool.execute(
      'INSERT INTO `owners` (`id`, `gender`, `age`) VALUES (?, ?, ?)',
      ['owner-upd-1', 'male', 25]
    );

    const record = createRecord('owner', { id: 'owner-upd-1', gender: 'male', age: 35 }, { isDbRecord: true, serialize: false, transform: false });
    const oldState = { gender: 'male', age: 25 };

    await db._persistUpdate('owner', { record, oldState }, {});

    const [rows] = await pool.execute('SELECT * FROM `owners` WHERE `id` = ?', ['owner-upd-1']);
    assert.strictEqual(rows[0].age, 35, 'age was updated to 35');
    assert.strictEqual(rows[0].gender, 'male', 'gender unchanged');
  });

  QUnit.test('_persistUpdate with null clears the column', async function (assert) {
    if (!pool) { assert.expect(0); return; }
    const db = createDb();

    await pool.execute(
      'INSERT INTO `owners` (`id`, `gender`, `age`) VALUES (?, ?, ?)',
      ['owner-null-1', 'male', 25]
    );

    const record = createRecord('owner', { id: 'owner-null-1', gender: null, age: 25 }, { isDbRecord: true, serialize: false, transform: false });
    const oldState = { gender: 'male', age: 25 };

    await db._persistUpdate('owner', { record, oldState }, {});

    const [rows] = await pool.execute('SELECT * FROM `owners` WHERE `id` = ?', ['owner-null-1']);
    assert.strictEqual(rows[0].gender, null, 'gender was cleared to null');
  });

  QUnit.test('_persistDelete removes the record', async function (assert) {
    if (!pool) { assert.expect(0); return; }
    const db = createDb();

    await pool.execute(
      'INSERT INTO `owners` (`id`, `gender`, `age`) VALUES (?, ?, ?)',
      ['owner-del-1', 'male', 30]
    );

    const [before] = await pool.execute('SELECT * FROM `owners` WHERE `id` = ?', ['owner-del-1']);
    assert.strictEqual(before.length, 1, 'record exists before delete');

    await db._persistDelete('owner', { recordId: 'owner-del-1' });

    const [after] = await pool.execute('SELECT * FROM `owners` WHERE `id` = ?', ['owner-del-1']);
    assert.strictEqual(after.length, 0, 'record removed after delete');
  });
});
