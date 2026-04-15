import QUnit from 'qunit';
import transforms from '../../../src/transforms.js';

const { trim } = transforms;
const { module, test } = QUnit;

module('[Unit] Transforms | trim', function() {
  test('trims leading and trailing spaces from string', function(assert) {
    assert.strictEqual(trim('  hello  '), 'hello');
  });

  test('trims tabs and newlines', function(assert) {
    assert.strictEqual(trim('\n\t hi \t\n'), 'hi');
  });

  test('returns empty string when input is spaces only', function(assert) {
    assert.strictEqual(trim('   '), '');
  });

  test('returns unchanged string when no whitespace', function(assert) {
    assert.strictEqual(trim('world'), 'world');
  });

  test('returns undefined when input is null', function(assert) {
    assert.strictEqual(trim(null), undefined);
  });

  test('returns undefined when input is undefined', function(assert) {
    assert.strictEqual(trim(undefined), undefined);
  });

  test('throws error when input is number (failing case)', function(assert) {
    assert.throws(() => trim(123), /trim is not a function/, 'Expected number to fail');
  });

  test('throws error when input is object (failing case)', function(assert) {
    assert.throws(() => trim({}), /trim is not a function/, 'Expected object to fail');
  });
});
