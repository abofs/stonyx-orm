import QUnit from 'qunit';
import transforms from '../../../src/transforms.js';

const { float } = transforms;
const { module, test } = QUnit;

module('[Unit] Transforms | float', function() {
  test('converts integer string "42" to 42', function(assert) {
    assert.strictEqual(float('42'), 42);
  });

  test('converts float string "3.14" to 3.14', function(assert) {
    assert.strictEqual(float('3.14'), 3.14);
  });

  test('converts number 2.718 to 2.718', function(assert) {
    assert.strictEqual(float(2.718), 2.718);
  });

  test('converts negative number string "-1.5" to -1.5', function(assert) {
    assert.strictEqual(float('-1.5'), -1.5);
  });

  test('converts empty string "" to NaN (failing case)', function(assert) {
    assert.ok(isNaN(float('')), 'Expected NaN for empty string');
  });

  test('converts non-numeric string "abc" to NaN (failing case)', function(assert) {
    assert.ok(isNaN(float('abc')), 'Expected NaN for non-numeric string');
  });

  test('converts null to NaN (failing case)', function(assert) {
    assert.ok(isNaN(float(null)), 'Expected NaN for null input');
  });

  test('converts undefined to NaN (failing case)', function(assert) {
    assert.ok(isNaN(float(undefined)), 'Expected NaN for undefined input');
  });
});
