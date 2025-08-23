import QUnit from 'qunit';
import transforms from '../../../src/transforms.js';

const { number } = transforms;
const { module, test } = QUnit;

module('[Unit] Transforms | number', function() {
  test('converts integer string "42" to 42', function(assert) {
    assert.strictEqual(number('42'), 42);
  });

  test('converts float string "3.14" to 3 (truncated)', function(assert) {
    assert.strictEqual(number('3.14'), 3);
  });

  test('converts negative number string "-7" to -7', function(assert) {
    assert.strictEqual(number('-7'), -7);
  });

  test('converts number 123 to 123', function(assert) {
    assert.strictEqual(number(123), 123);
  });

  test('converts hex string "0x10" to 16 (failing case)', function(assert) {
    assert.strictEqual(number('0x10'), 16, 'Expected parseInt to handle hex');
  });

  test('converts non-numeric string "abc" to NaN (failing case)', function(assert) {
    assert.ok(isNaN(number('abc')), 'Expected NaN for non-numeric string');
  });

  test('converts empty string "" to NaN (failing case)', function(assert) {
    assert.ok(isNaN(number('')), 'Expected NaN for empty string');
  });

  test('converts null to NaN (failing case)', function(assert) {
    assert.ok(isNaN(number(null)), 'Expected NaN for null input');
  });

  test('converts undefined to NaN (failing case)', function(assert) {
    assert.ok(isNaN(number(undefined)), 'Expected NaN for undefined input');
  });
});
