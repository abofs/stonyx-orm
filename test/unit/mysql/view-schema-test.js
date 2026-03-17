import QUnit from 'qunit';
import sinon from 'sinon';
import Orm from '@stonyx/orm';
import { introspectViews, buildViewDDL } from '../../../src/mysql/schema-introspector.js';
import View from '../../../src/view.js';
import { count, avg, sum, min, max, AggregateProperty } from '../../../src/aggregates.js';
import { attr, belongsTo, hasMany } from '@stonyx/orm';
import { registerPluralName } from '../../../src/plural-registry.js';

const { module, test } = QUnit;

class TestStatsView extends View {
  static source = 'owner';

  animalCount = count('pet');
  avgAge = avg('pet', 'age');
  totalAge = sum('pet', 'age');
  minAge = min('pet', 'age');
  maxAge = max('pet', 'age');
  owner = belongsTo('owner');
}

class SimpleCountView extends View {
  static source = 'author';

  bookCount = count('book');
}

module('[Unit] MySQL — View Schema Introspection', function(hooks) {
  let originalInstance;

  hooks.beforeEach(function() {
    originalInstance = Orm.instance;

    Orm.instance = {
      views: {
        TestStatsView,
        SimpleCountView,
      },
      models: {},
      transforms: {
        number: (v) => parseInt(v),
        float: (v) => parseFloat(v),
        passthrough: (v) => v,
        string: (v) => String(v),
      },
    };

    registerPluralName('owner', { pluralName: 'owners' });
    registerPluralName('pet', { pluralName: 'pets' });
    registerPluralName('author', { pluralName: 'authors' });
    registerPluralName('book', { pluralName: 'books' });
    registerPluralName('test-stats', TestStatsView);
    registerPluralName('simple-count', SimpleCountView);
  });

  hooks.afterEach(function() {
    Orm.instance = originalInstance;
    sinon.restore();
  });

  module('introspectViews', function() {
    test('returns schema with correct shape', function(assert) {
      const schemas = introspectViews();
      const stats = schemas['test-stats'];

      assert.ok(stats, 'view schema exists');
      assert.strictEqual(stats.source, 'owner', 'source is correct');
      assert.strictEqual(stats.isView, true, 'isView flag is true');
      assert.ok(stats.viewName, 'viewName is set');
      assert.ok(stats.aggregates, 'aggregates object exists');
      assert.ok(stats.columns !== undefined, 'columns object exists');
      assert.ok(stats.foreignKeys !== undefined, 'foreignKeys object exists');
    });

    test('aggregate properties are in aggregates map', function(assert) {
      const schemas = introspectViews();
      const stats = schemas['test-stats'];

      assert.ok(stats.aggregates.animalCount instanceof AggregateProperty, 'animalCount is AggregateProperty');
      assert.ok(stats.aggregates.avgAge instanceof AggregateProperty, 'avgAge is AggregateProperty');
      assert.ok(stats.aggregates.totalAge instanceof AggregateProperty, 'totalAge is AggregateProperty');
      assert.ok(stats.aggregates.minAge instanceof AggregateProperty, 'minAge is AggregateProperty');
      assert.ok(stats.aggregates.maxAge instanceof AggregateProperty, 'maxAge is AggregateProperty');
    });

    test('belongsTo relationships generate foreign keys', function(assert) {
      const schemas = introspectViews();
      const stats = schemas['test-stats'];

      assert.ok(stats.foreignKeys.owner_id, 'owner_id FK exists');
      assert.strictEqual(stats.foreignKeys.owner_id.references, 'owners', 'references owners table');
    });

    test('view schemas do not appear in introspectModels results', function(assert) {
      // introspectViews only inspects orm.views, not orm.models
      const schemas = introspectViews();
      assert.ok(schemas['test-stats'], 'view is in view schemas');
      // No models should be present since orm.models is empty
      const modelKeys = Object.keys(schemas).filter(k => !schemas[k].isView);
      assert.strictEqual(modelKeys.length, 0, 'no model schemas in view introspection');
    });
  });

  module('buildViewDDL', function() {
    test('generates CREATE OR REPLACE VIEW SQL', function(assert) {
      const schemas = introspectViews();
      const modelSchemas = {
        owner: { table: 'owners', idType: 'string' }
      };
      const ddl = buildViewDDL('test-stats', schemas['test-stats'], modelSchemas);

      assert.ok(ddl.startsWith('CREATE OR REPLACE VIEW'), 'starts with CREATE OR REPLACE VIEW');
    });

    test('count aggregate translates to COUNT SQL', function(assert) {
      const schemas = introspectViews();
      const modelSchemas = { owner: { table: 'owners', idType: 'string' } };
      const ddl = buildViewDDL('test-stats', schemas['test-stats'], modelSchemas);

      assert.ok(ddl.includes('COUNT(`pets`.`id`) AS `animalCount`'), 'count generates COUNT SQL');
    });

    test('avg aggregate translates to AVG SQL', function(assert) {
      const schemas = introspectViews();
      const modelSchemas = { owner: { table: 'owners', idType: 'string' } };
      const ddl = buildViewDDL('test-stats', schemas['test-stats'], modelSchemas);

      assert.ok(ddl.includes('AVG(`pets`.`age`) AS `avgAge`'), 'avg generates AVG SQL');
    });

    test('sum aggregate translates to SUM SQL', function(assert) {
      const schemas = introspectViews();
      const modelSchemas = { owner: { table: 'owners', idType: 'string' } };
      const ddl = buildViewDDL('test-stats', schemas['test-stats'], modelSchemas);

      assert.ok(ddl.includes('SUM(`pets`.`age`) AS `totalAge`'), 'sum generates SUM SQL');
    });

    test('min aggregate translates to MIN SQL', function(assert) {
      const schemas = introspectViews();
      const modelSchemas = { owner: { table: 'owners', idType: 'string' } };
      const ddl = buildViewDDL('test-stats', schemas['test-stats'], modelSchemas);

      assert.ok(ddl.includes('MIN(`pets`.`age`) AS `minAge`'), 'min generates MIN SQL');
    });

    test('max aggregate translates to MAX SQL', function(assert) {
      const schemas = introspectViews();
      const modelSchemas = { owner: { table: 'owners', idType: 'string' } };
      const ddl = buildViewDDL('test-stats', schemas['test-stats'], modelSchemas);

      assert.ok(ddl.includes('MAX(`pets`.`age`) AS `maxAge`'), 'max generates MAX SQL');
    });

    test('generates LEFT JOIN for aggregate relationship', function(assert) {
      const schemas = introspectViews();
      const modelSchemas = { owner: { table: 'owners', idType: 'string' } };
      const ddl = buildViewDDL('test-stats', schemas['test-stats'], modelSchemas);

      assert.ok(ddl.includes('LEFT JOIN `pets`'), 'includes LEFT JOIN for pets');
      assert.ok(ddl.includes('`pets`.`owner_id` = `owners`.`id`'), 'JOIN condition references FK');
    });

    test('generates GROUP BY source primary key when aggregates present', function(assert) {
      const schemas = introspectViews();
      const modelSchemas = { owner: { table: 'owners', idType: 'string' } };
      const ddl = buildViewDDL('test-stats', schemas['test-stats'], modelSchemas);

      assert.ok(ddl.includes('GROUP BY `owners`.`id`'), 'includes GROUP BY source PK');
    });

    test('throws if source is missing', function(assert) {
      assert.throws(
        () => buildViewDDL('bad-view', { columns: {}, aggregates: {} }),
        /must define a source/,
        'throws for missing source'
      );
    });

    test('uses plural registry for source table name', function(assert) {
      const schemas = introspectViews();
      const modelSchemas = { owner: { table: 'owners' } };
      const ddl = buildViewDDL('test-stats', schemas['test-stats'], modelSchemas);

      assert.ok(ddl.includes('FROM `owners`'), 'uses pluralized source table name');
    });
  });
});
