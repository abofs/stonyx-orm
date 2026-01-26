import QUnit from 'qunit';
import transforms from '../../../src/transforms.js';

const { ceil } = transforms;
const { module, test } = QUnit;

module('[Unit] Transforms | ceil', function() {
  test('rounds float string "3.14" up to 4', function(assert) {
    assert.strictEqual(ceil('3.14'), 4);
  });

  test('rounds negative float string "-1.5" up to -1', function(assert) {
    assert.strictEqual(ceil('-1.5'), -1);
  });

  test('rounds integer string "7" up to 7', function(assert) {
    assert.strictEqual(ceil('7'), 7);
  });

  test('rounds number 2.718 up to 3', function(assert) {
    assert.strictEqual(ceil(2.718), 3);
  });

  test('returns NaN for non-numeric string "abc" (failing case)', function(assert) {
    assert.ok(isNaN(ceil('abc')), 'Expected NaN for non-numeric string');
  });

  test('returns NaN for null input (failing case)', function(assert) {
    assert.strictEqual(ceil(null), 0);
  });

  test('returns NaN for undefined input (failing case)', function(assert) {
    assert.ok(isNaN(ceil(undefined)), 'Expected NaN for undefined');
  });
});
