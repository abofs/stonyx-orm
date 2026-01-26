import QUnit from 'qunit';
import transforms from '../../../src/transforms.js';

const { floor } = transforms;
const { module, test } = QUnit;

module('[Unit] Transforms | floor', function() {
  test('rounds float string "3.14" down to 3', function(assert) {
    assert.strictEqual(floor('3.14'), 3);
  });

  test('rounds negative float string "-1.5" down to -2', function(assert) {
    assert.strictEqual(floor('-1.5'), -2);
  });

  test('rounds integer string "7" down to 7', function(assert) {
    assert.strictEqual(floor('7'), 7);
  });

  test('rounds number 2.718 down to 2', function(assert) {
    assert.strictEqual(floor(2.718), 2);
  });

  test('returns NaN for non-numeric string "abc" (failing case)', function(assert) {
    assert.ok(isNaN(floor('abc')), 'Expected NaN for non-numeric string');
  });

  test('returns 0 for null input (failing case)', function(assert) {
    assert.strictEqual(floor(null), 0);
  });

  test('returns NaN for undefined input (failing case)', function(assert) {
    assert.ok(isNaN(floor(undefined)), 'Expected NaN for undefined');
  });
});
