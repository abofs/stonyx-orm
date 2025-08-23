import QUnit from 'qunit';
import transforms from '../../../src/transforms.js';

const { date } = transforms;
const { module, test } = QUnit;

module('[Unit] Transforms | date', function() {
  test('converts ISO string to Date', function(assert) {
    const result = date('2020-01-01T00:00:00Z');
    assert.ok(result instanceof Date, 'Result should be a Date');
    assert.strictEqual(result.toISOString(), '2020-01-01T00:00:00.000Z');
  });

  test('converts timestamp number to Date', function(assert) {
    const result = date(1609459200000);
    assert.ok(result instanceof Date, 'Result should be a Date');
    assert.strictEqual(result.toISOString(), '2021-01-01T00:00:00.000Z');
  });

  test('returns null for null input', function(assert) {
    assert.strictEqual(date(null), null);
  });

  test('returns null for undefined input', function(assert) {
    assert.strictEqual(date(undefined), null);
  });

  test('produces Invalid Date for nonsense string (failing case)', function(assert) {
    const result = date('not-a-date');
    assert.ok(isNaN(result.getTime()), 'Expected Invalid Date');
  });

  test('produces Invalid Date for object input (failing case)', function(assert) {
    const result = date({});
    assert.ok(isNaN(result.getTime()), 'Expected Invalid Date');
  });
});
