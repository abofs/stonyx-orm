import QUnit from 'qunit';
import { AggregateProperty, count, avg, sum, min, max } from '../../src/aggregates.js';

const { module, test } = QUnit;

module('[Unit] Aggregate helpers', function() {
  module('Factory functions return AggregateProperty', function() {
    test('count returns AggregateProperty with correct properties', function(assert) {
      const prop = count('pets');
      assert.ok(prop instanceof AggregateProperty);
      assert.strictEqual(prop.aggregateType, 'count');
      assert.strictEqual(prop.relationship, 'pets');
      assert.strictEqual(prop.field, undefined);
      assert.strictEqual(prop.mysqlFunction, 'COUNT');
      assert.strictEqual(prop.resultType, 'number');
    });

    test('avg returns AggregateProperty with correct properties', function(assert) {
      const prop = avg('pets', 'age');
      assert.ok(prop instanceof AggregateProperty);
      assert.strictEqual(prop.aggregateType, 'avg');
      assert.strictEqual(prop.relationship, 'pets');
      assert.strictEqual(prop.field, 'age');
      assert.strictEqual(prop.mysqlFunction, 'AVG');
      assert.strictEqual(prop.resultType, 'float');
    });

    test('sum returns AggregateProperty with correct properties', function(assert) {
      const prop = sum('pets', 'age');
      assert.ok(prop instanceof AggregateProperty);
      assert.strictEqual(prop.aggregateType, 'sum');
      assert.strictEqual(prop.relationship, 'pets');
      assert.strictEqual(prop.field, 'age');
      assert.strictEqual(prop.mysqlFunction, 'SUM');
      assert.strictEqual(prop.resultType, 'number');
    });

    test('min returns AggregateProperty with correct properties', function(assert) {
      const prop = min('pets', 'age');
      assert.ok(prop instanceof AggregateProperty);
      assert.strictEqual(prop.aggregateType, 'min');
      assert.strictEqual(prop.relationship, 'pets');
      assert.strictEqual(prop.field, 'age');
      assert.strictEqual(prop.mysqlFunction, 'MIN');
      assert.strictEqual(prop.resultType, 'number');
    });

    test('max returns AggregateProperty with correct properties', function(assert) {
      const prop = max('pets', 'age');
      assert.ok(prop instanceof AggregateProperty);
      assert.strictEqual(prop.aggregateType, 'max');
      assert.strictEqual(prop.relationship, 'pets');
      assert.strictEqual(prop.field, 'age');
      assert.strictEqual(prop.mysqlFunction, 'MAX');
      assert.strictEqual(prop.resultType, 'number');
    });
  });

  module('AggregateProperty is distinguishable from ModelProperty', function() {
    test('constructor name differs', function(assert) {
      const prop = count('pets');
      assert.strictEqual(prop.constructor.name, 'AggregateProperty');
    });
  });

  module('compute — count', function() {
    test('returns array length', function(assert) {
      const prop = count('pets');
      const records = [{ id: 1 }, { id: 2 }, { id: 3 }];
      assert.strictEqual(prop.compute(records), 3);
    });

    test('empty array returns 0', function(assert) {
      assert.strictEqual(count('pets').compute([]), 0);
    });

    test('null/undefined returns 0', function(assert) {
      assert.strictEqual(count('pets').compute(null), 0);
      assert.strictEqual(count('pets').compute(undefined), 0);
    });
  });

  module('compute — avg', function() {
    test('returns average of field values', function(assert) {
      const prop = avg('pets', 'age');
      const records = [
        { __data: { age: 2 } },
        { __data: { age: 4 } },
        { __data: { age: 6 } },
      ];
      assert.strictEqual(prop.compute(records), 4);
    });

    test('empty array returns 0', function(assert) {
      assert.strictEqual(avg('pets', 'age').compute([]), 0);
    });

    test('null/undefined returns 0', function(assert) {
      assert.strictEqual(avg('pets', 'age').compute(null), 0);
    });

    test('filters NaN values', function(assert) {
      const prop = avg('pets', 'age');
      const records = [
        { __data: { age: 2 } },
        { __data: { age: 'not-a-number' } },
        { __data: { age: 4 } },
      ];
      assert.strictEqual(prop.compute(records), 3, 'averages only numeric values');
    });
  });

  module('compute — sum', function() {
    test('returns sum of field values', function(assert) {
      const prop = sum('pets', 'age');
      const records = [
        { __data: { age: 2 } },
        { __data: { age: 4 } },
        { __data: { age: 6 } },
      ];
      assert.strictEqual(prop.compute(records), 12);
    });

    test('empty array returns 0', function(assert) {
      assert.strictEqual(sum('pets', 'age').compute([]), 0);
    });

    test('null/undefined returns 0', function(assert) {
      assert.strictEqual(sum('pets', 'age').compute(null), 0);
    });

    test('handles non-numeric values gracefully', function(assert) {
      const prop = sum('pets', 'age');
      const records = [
        { __data: { age: 2 } },
        { __data: { age: 'bad' } },
        { __data: { age: 3 } },
      ];
      assert.strictEqual(prop.compute(records), 5, 'NaN values treated as 0');
    });
  });

  module('compute — min', function() {
    test('returns minimum field value', function(assert) {
      const prop = min('pets', 'age');
      const records = [
        { __data: { age: 5 } },
        { __data: { age: 2 } },
        { __data: { age: 8 } },
      ];
      assert.strictEqual(prop.compute(records), 2);
    });

    test('empty array returns null', function(assert) {
      assert.strictEqual(min('pets', 'age').compute([]), null);
    });

    test('null/undefined returns null', function(assert) {
      assert.strictEqual(min('pets', 'age').compute(null), null);
    });
  });

  module('compute — max', function() {
    test('returns maximum field value', function(assert) {
      const prop = max('pets', 'age');
      const records = [
        { __data: { age: 5 } },
        { __data: { age: 2 } },
        { __data: { age: 8 } },
      ];
      assert.strictEqual(prop.compute(records), 8);
    });

    test('empty array returns null', function(assert) {
      assert.strictEqual(max('pets', 'age').compute([]), null);
    });

    test('null/undefined returns null', function(assert) {
      assert.strictEqual(max('pets', 'age').compute(null), null);
    });
  });

  module('compute — fallback to direct property access', function() {
    test('falls back to record[field] when __data is missing', function(assert) {
      const prop = sum('pets', 'age');
      const records = [{ age: 3 }, { age: 7 }];
      assert.strictEqual(prop.compute(records), 10);
    });
  });
});
