import QUnit from 'qunit';
import transforms from '../../../src/transforms.js';

const { string } = transforms;
const { module, test } = QUnit;

module('[Unit] Transforms | passthrough', function() {
  test('converts number 123 to "123"', function(assert) {
    assert.strictEqual(string(123), '123');
  });

  test('converts boolean true to "true"', function(assert) {
    assert.strictEqual(string(true), 'true');
  });

  test('converts null to "null"', function(assert) {
    assert.strictEqual(string(null), 'null');
  });

  test('converts undefined to "undefined"', function(assert) {
    assert.strictEqual(string(undefined), 'undefined');
  });

  test('converts object {} to "[object Object]" (failing case)', function(assert) {
    assert.strictEqual(string({}), '[object Object]');
  });

  test('converts array [1,2] to "1,2" (failing case)', function(assert) {
    assert.strictEqual(string([1,2]), '1,2');
  });

  test('converts Date to string representation (failing case)', function(assert) {
    const d = new Date('2020-01-01T00:00:00Z');
    assert.strictEqual(string(d), d.toString(), 'Expected stringified date');
  });
});
