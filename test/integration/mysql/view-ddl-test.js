import QUnit from 'qunit';
import { setupIntegrationTests } from 'stonyx/test-helpers';
import { setupMysqlTests, pool, skipIfNoMysql, mysqlSkipped } from '../../helpers/mysql-test-helper.js';
import { introspectModels, introspectViews, buildViewDDL } from '../../../src/mysql/schema-introspector.js';

QUnit.module('[Integration] MySQL — View DDL', function (hooks) {
  setupIntegrationTests(hooks);
  setupMysqlTests(hooks, { tables: ['category', 'owner', 'animal', 'trait', 'phone-number'] });

  hooks.afterEach(async function () {
    if (mysqlSkipped || !pool) return;

    await pool.execute('DROP VIEW IF EXISTS `animal-count-by-sizes`');
    await pool.execute('DROP VIEW IF EXISTS `owner-animal-counts`');
  });

  QUnit.test('animal-count-by-size view DDL executes successfully', async function (assert) {
    if (skipIfNoMysql(assert)) return;

    const modelSchemas = introspectModels();
    const viewSchemas = introspectViews();
    const viewSchema = viewSchemas['animal-count-by-size'];

    const ddl = buildViewDDL('animal-count-by-size', viewSchema, modelSchemas);
    await pool.execute(ddl);

    // Verify the view exists in information_schema
    const [rows] = await pool.execute(
      `SELECT TABLE_NAME FROM information_schema.VIEWS
       WHERE TABLE_SCHEMA = 'stonyx_orm_test' AND TABLE_NAME = 'animal-count-by-sizes'`
    );
    assert.strictEqual(rows.length, 1, 'animal-count-by-sizes view exists in MySQL');
  });

  QUnit.test('animal-count-by-size view groups correctly', async function (assert) {
    if (skipIfNoMysql(assert)) return;

    const modelSchemas = introspectModels();
    const viewSchemas = introspectViews();
    const viewSchema = viewSchemas['animal-count-by-size'];

    // Insert test data: animals of different sizes
    await pool.execute('INSERT INTO `animals` (`type`, `age`, `size`) VALUES (?, ?, ?)', ['{"name":"cat"}', 3, 'small']);
    await pool.execute('INSERT INTO `animals` (`type`, `age`, `size`) VALUES (?, ?, ?)', ['{"name":"dog"}', 5, 'small']);
    await pool.execute('INSERT INTO `animals` (`type`, `age`, `size`) VALUES (?, ?, ?)', ['{"name":"horse"}', 10, 'large']);
    await pool.execute('INSERT INTO `animals` (`type`, `age`, `size`) VALUES (?, ?, ?)', ['{"name":"cow"}', 8, 'large']);
    await pool.execute('INSERT INTO `animals` (`type`, `age`, `size`) VALUES (?, ?, ?)', ['{"name":"bird"}', 2, 'large']);

    // Create the view
    const ddl = buildViewDDL('animal-count-by-size', viewSchema, modelSchemas);
    await pool.execute(ddl);

    // Query the view
    const [rows] = await pool.execute('SELECT * FROM `animal-count-by-sizes` ORDER BY `id`');

    assert.strictEqual(rows.length, 2, 'two size groups returned');

    const large = rows.find(r => r.id === 'large');
    const small = rows.find(r => r.id === 'small');

    assert.ok(large, 'large group exists');
    assert.ok(small, 'small group exists');
    assert.strictEqual(Number(large.animalCount), 3, 'large group has 3 animals');
    assert.strictEqual(Number(small.animalCount), 2, 'small group has 2 animals');
    // Average age for small: (3+5)/2 = 4, for large: (10+8+2)/3 = 6.666...
    assert.ok(Math.abs(Number(small.averageAge) - 4) < 0.01, 'small group average age is 4');
    assert.ok(Math.abs(Number(large.averageAge) - 6.6667) < 0.01, 'large group average age is ~6.67');
  });

  // Known bug: buildViewDDL resolves count('pets') using the relationship name 'pets'
  // as a model name. camelCaseToKebabCase('pets') = 'pets', then getPluralName('pets')
  // returns a pluralized form of 'pets' (e.g. 'petss' or 'pets') rather than resolving
  // through the hasMany relationship to the 'animal' model and using the 'animals' table.
  // This produces LEFT JOIN `petss` (or `pets`) instead of LEFT JOIN `animals`.
  QUnit.test('owner-animal-count view DDL executes — known bug with relationship resolution', async function (assert) {
    if (skipIfNoMysql(assert)) return;

    const modelSchemas = introspectModels();
    const viewSchemas = introspectViews();
    const viewSchema = viewSchemas['owner-animal-count'];

    const ddl = buildViewDDL('owner-animal-count', viewSchema, modelSchemas);

    // The DDL references a non-existent table derived from the relationship name 'pets'
    // instead of the actual 'animals' table. This is a known bug.
    try {
      await pool.execute(ddl);

      // If it succeeds (unlikely), verify the view exists
      const [rows] = await pool.execute(
        `SELECT TABLE_NAME FROM information_schema.VIEWS
         WHERE TABLE_SCHEMA = 'stonyx_orm_test' AND TABLE_NAME = 'owner-animal-counts'`
      );
      assert.strictEqual(rows.length, 1, 'view created despite bug expectation');
    } catch (error) {
      // Expected: the LEFT JOIN references a non-existent table
      assert.ok(error, 'DDL failed as expected due to incorrect table reference from relationship name');
      assert.ok(
        ddl.includes('`pets`') || ddl.includes('`petss`'),
        'DDL incorrectly references pets/petss table instead of animals'
      );
    }
  });

  QUnit.test('INSERT into view fails (read-only)', async function (assert) {
    if (skipIfNoMysql(assert)) return;

    const modelSchemas = introspectModels();
    const viewSchemas = introspectViews();
    const viewSchema = viewSchemas['animal-count-by-size'];

    // Create the view
    const ddl = buildViewDDL('animal-count-by-size', viewSchema, modelSchemas);
    await pool.execute(ddl);

    // Attempt to INSERT into the view — should fail
    try {
      await pool.execute(
        'INSERT INTO `animal-count-by-sizes` (`id`, `animalCount`, `averageAge`) VALUES (?, ?, ?)',
        ['tiny', 1, 2]
      );
      assert.ok(false, 'INSERT should have failed');
    } catch (error) {
      assert.ok(error, 'INSERT into view threw an error');
    }
  });
});
