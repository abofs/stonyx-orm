import QUnit from 'qunit';
import transforms from '../../../src/transforms.js';

const { boolean } = transforms;
const { module, test } = QUnit;

module('[Unit] Transforms | boolean', function() {
  test('converts truthy string "true" to true', function(assert) {
    assert.strictEqual(boolean('true'), true);
  });

  test('converts case-insensitive string "TRUE" to true', function(assert) {
    assert.strictEqual(boolean('TRUE'), true);
  });

  test('converts string "false" to false', function(assert) {
    assert.strictEqual(boolean('false'), false);
  });

  test('converts non-empty string (not "true") to false', function(assert) {
    assert.strictEqual(boolean('yes'), false);
  });

  test('converts number 1 to true', function(assert) {
    assert.strictEqual(boolean(1), true);
  });

  test('converts number 0 to false', function(assert) {
    assert.strictEqual(boolean(0), false);
  });

  test('converts null to false', function(assert) {
    assert.strictEqual(boolean(null), false);
  });

  test('converts undefined to false', function(assert) {
    assert.strictEqual(boolean(undefined), false);
  });

  test('converts object {} to true (failing edge case)', function(assert) {
    assert.strictEqual(boolean({}), true, 'Expected true because objects are truthy');
  });

  test('converts empty string "" to false (failing edge case)', function(assert) {
    assert.strictEqual(boolean(''), false, 'Expected false because empty string is falsy');
  });
});
