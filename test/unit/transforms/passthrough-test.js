import QUnit from 'qunit';
import transforms from '../../../src/transforms.js';

const { number } = transforms;
const { module, test } = QUnit;

module('[Unit] Transforms | passthrough', function() {
  test('returns string unchanged', function(assert) {
    assert.strictEqual(transforms.passthrough('hello'), 'hello');
  });

  test('returns number unchanged', function(assert) {
    assert.strictEqual(transforms.passthrough(123), 123);
  });

  test('returns boolean unchanged', function(assert) {
    assert.strictEqual(transforms.passthrough(true), true);
  });

  test('returns object reference unchanged', function(assert) {
    const obj = { a: 1 };
    assert.strictEqual(transforms.passthrough(obj), obj);
  });

  test('returns array reference unchanged', function(assert) {
    const arr = [1, 2, 3];
    assert.strictEqual(transforms.passthrough(arr), arr);
  });

  test('returns null unchanged', function(assert) {
    assert.strictEqual(transforms.passthrough(null), null);
  });

  test('returns undefined unchanged', function(assert) {
    assert.strictEqual(transforms.passthrough(undefined), undefined);
  });

  test('fails deep equality check for objects (failing case)', function(assert) {
    const obj = { a: 1 };
    assert.deepEqual(transforms.passthrough(obj), { a: 1 }, 'Expected deep equal to pass, but strict equal is more accurate');
  });
});
