import QUnit from 'qunit';
import sinon from 'sinon';
import Orm from '@stonyx/orm';
import { introspectViews, buildViewDDL, viewSchemasToSnapshot } from '../../../src/mysql/schema-introspector.js';
import View from '../../../src/view.js';
import { count, avg, sum, min, max, AggregateProperty } from '../../../src/aggregates.js';
import { attr } from '@stonyx/orm';
import { registerPluralName } from '../../../src/plural-registry.js';

const { module, test } = QUnit;

class AnimalCountBySizeView extends View {
  static source = 'animal';
  static groupBy = 'size';

  id = attr('string');
  animalCount = count();
  averageAge = avg('age');
}

class GroupBySumView extends View {
  static source = 'animal';
  static groupBy = 'size';

  id = attr('string');
  totalAge = sum('age');
}

module('[Unit] MySQL — View groupBy Schema', function(hooks) {
  let originalInstance;

  hooks.beforeEach(function() {
    originalInstance = Orm.instance;

    Orm.instance = {
      views: {
        AnimalCountBySizeView,
        GroupBySumView,
      },
      models: {},
      transforms: {
        number: (v) => parseInt(v),
        float: (v) => parseFloat(v),
        passthrough: (v) => v,
        string: (v) => String(v),
      },
    };

    registerPluralName('animal', { pluralName: 'animals' });
    registerPluralName('animal-count-by-size', AnimalCountBySizeView);
    registerPluralName('group-by-sum', GroupBySumView);
  });

  hooks.afterEach(function() {
    Orm.instance = originalInstance;
    sinon.restore();
  });

  module('introspectViews', function() {
    test('includes groupBy in schema', function(assert) {
      const schemas = introspectViews();
      const stats = schemas['animal-count-by-size'];

      assert.strictEqual(stats.groupBy, 'size', 'groupBy field is set');
    });

    test('non-groupBy views have no groupBy', function(assert) {
      Orm.instance.views = {
        AnimalCountBySizeView,
      };

      const schemas = introspectViews();
      const stats = schemas['animal-count-by-size'];

      assert.strictEqual(stats.groupBy, 'size', 'groupBy view has it set');
    });

    test('field-level aggregates have undefined relationship', function(assert) {
      const schemas = introspectViews();
      const stats = schemas['animal-count-by-size'];

      assert.strictEqual(stats.aggregates.animalCount.relationship, undefined, 'count() has no relationship');
      assert.strictEqual(stats.aggregates.averageAge.relationship, undefined, 'avg(field) has no relationship');
      assert.strictEqual(stats.aggregates.averageAge.field, 'age', 'avg(field) has correct field');
    });
  });

  module('buildViewDDL', function() {
    test('groupBy generates SELECT field AS id instead of source.id', function(assert) {
      const schemas = introspectViews();
      const modelSchemas = { animal: { table: 'animals', idType: 'number' } };
      const ddl = buildViewDDL('animal-count-by-size', schemas['animal-count-by-size'], modelSchemas);

      assert.ok(ddl.includes('`animals`.`size` AS `id`'), 'selects groupBy field as id');
      assert.notOk(ddl.includes('`animals`.`id` AS `id`'), 'does not select source id');
    });

    test('field-level count() generates COUNT(*)', function(assert) {
      const schemas = introspectViews();
      const modelSchemas = { animal: { table: 'animals', idType: 'number' } };
      const ddl = buildViewDDL('animal-count-by-size', schemas['animal-count-by-size'], modelSchemas);

      assert.ok(ddl.includes('COUNT(*) AS `animalCount`'), 'count() generates COUNT(*)');
    });

    test('field-level avg generates AVG(source.field)', function(assert) {
      const schemas = introspectViews();
      const modelSchemas = { animal: { table: 'animals', idType: 'number' } };
      const ddl = buildViewDDL('animal-count-by-size', schemas['animal-count-by-size'], modelSchemas);

      assert.ok(ddl.includes('AVG(`animals`.`age`) AS `averageAge`'), 'avg(field) generates AVG SQL');
    });

    test('field-level sum generates SUM(source.field)', function(assert) {
      const schemas = introspectViews();
      const modelSchemas = { animal: { table: 'animals', idType: 'number' } };
      const ddl = buildViewDDL('group-by-sum', schemas['group-by-sum'], modelSchemas);

      assert.ok(ddl.includes('SUM(`animals`.`age`) AS `totalAge`'), 'sum(field) generates SUM SQL');
    });

    test('GROUP BY uses the groupBy field not source id', function(assert) {
      const schemas = introspectViews();
      const modelSchemas = { animal: { table: 'animals', idType: 'number' } };
      const ddl = buildViewDDL('animal-count-by-size', schemas['animal-count-by-size'], modelSchemas);

      assert.ok(ddl.includes('GROUP BY `animals`.`size`'), 'groups by the groupBy field');
      assert.notOk(ddl.includes('GROUP BY `animals`.`id`'), 'does not group by source id');
    });

    test('no LEFT JOINs for field-level aggregates', function(assert) {
      const schemas = introspectViews();
      const modelSchemas = { animal: { table: 'animals', idType: 'number' } };
      const ddl = buildViewDDL('animal-count-by-size', schemas['animal-count-by-size'], modelSchemas);

      assert.notOk(ddl.includes('LEFT JOIN'), 'no joins needed for field-level aggregates');
    });
  });

  module('viewSchemasToSnapshot', function() {
    test('snapshot includes groupBy for diff detection', function(assert) {
      const schemas = introspectViews();
      const snapshot = viewSchemasToSnapshot(schemas);

      assert.strictEqual(snapshot['animal-count-by-size'].groupBy, 'size', 'groupBy in snapshot');
    });

    test('snapshot omits groupBy when not set', function(assert) {
      // Use a non-groupBy view
      class PlainView extends View {
        static source = 'animal';
        animalCount = count('traits');
      }
      Orm.instance.views = { PlainView };
      registerPluralName('plain', PlainView);
      registerPluralName('trait', { pluralName: 'traits' });

      const schemas = introspectViews();
      const snapshot = viewSchemasToSnapshot(schemas);

      assert.strictEqual(snapshot['plain'].groupBy, undefined, 'no groupBy in snapshot');
    });
  });
});
