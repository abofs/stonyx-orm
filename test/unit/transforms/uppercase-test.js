import QUnit from 'qunit';
import transforms from '../../../src/transforms.js';

const { uppercase } = transforms;
const { module, test } = QUnit;

module('[Unit] Transforms | uppercase', function() {
  test('converts lowercase string to uppercase', function(assert) {
    assert.strictEqual(uppercase('hello'), 'HELLO');
  });

  test('keeps uppercase string unchanged', function(assert) {
    assert.strictEqual(uppercase('WORLD'), 'WORLD');
  });

  test('converts mixed case string to uppercase', function(assert) {
    assert.strictEqual(uppercase('HeLLo WoRld'), 'HELLO WORLD');
  });

  test('returns empty string unchanged', function(assert) {
    assert.strictEqual(uppercase(''), '');
  });

  test('returns undefined when input is null', function(assert) {
    assert.strictEqual(uppercase(null), undefined);
  });

  test('returns undefined when input is undefined', function(assert) {
    assert.strictEqual(uppercase(undefined), undefined);
  });

  test('throws error when input is number (failing case)', function(assert) {
    assert.throws(() => uppercase(123), /toUpperCase is not a function/, 'Expected number to fail');
  });

  test('throws error when input is object (failing case)', function(assert) {
    assert.throws(() => uppercase({}), /toUpperCase is not a function/, 'Expected object to fail');
  });
});
