import QUnit from 'qunit';
import transforms from '../../../src/transforms.js';

const { round } = transforms;
const { module, test } = QUnit;

module('[Unit] Transforms | round', function() {
  test('rounds float string "3.14" to 3', function(assert) {
    assert.strictEqual(round('3.14'), 3);
  });

  test('rounds float string "2.718" to 3', function(assert) {
    assert.strictEqual(round('2.718'), 3);
  });

  test('rounds negative float string "-1.5" to -1', function(assert) {
    assert.strictEqual(round('-1.5'), -1);
  });

  test('rounds integer string "7" to 7', function(assert) {
    assert.strictEqual(round('7'), 7);
  });

  test('rounds number 4.6 to 5', function(assert) {
    assert.strictEqual(round(4.6), 5);
  });

  test('returns NaN for non-numeric string "abc" (failing case)', function(assert) {
    assert.ok(isNaN(round('abc')), 'Expected NaN for non-numeric string');
  });

  test('returns 0 for null input (failing case)', function(assert) {
    assert.strictEqual(round(null), 0);
  });

  test('returns NaN for undefined input (failing case)', function(assert) {
    assert.ok(isNaN(round(undefined)), 'Expected NaN for undefined');
  });
});
