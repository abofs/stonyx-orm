import QUnit from 'qunit';
import { getComputedProperties } from '../../../src/serializer.js';

const { module, test } = QUnit;

module('[Unit] Utils | getComputedProperties', function() {
  test('returns empty array for class with no getters', function(assert) {
    class EmptyClass {
      method() {}
    }
    const instance = new EmptyClass();
    assert.deepEqual(getComputedProperties(instance), []);
  });

  test('returns all getter properties with their functions', function(assert) {
    class MyClass {
      get a() { return 1; }
      get b() { return 2; }
      method() { return 3; }
    }
    const instance = new MyClass();
    const result = getComputedProperties(instance);
    assert.strictEqual(result.length, 2);
    const keys = result.map(([key]) => key);
    assert.ok(keys.includes('a') && keys.includes('b'));
    assert.strictEqual(typeof result[0][1], 'function');
    assert.strictEqual(typeof result[1][1], 'function');
  });

  test('does not include constructor', function(assert) {
    class MyClass {
      get value() { return 42; }
    }
    const instance = new MyClass();
    const result = getComputedProperties(instance);
    const keys = result.map(([key]) => key);
    assert.notOk(keys.includes('constructor'));
  });

  test('does not handles inherited getters', function(assert) {
    class Parent {
      get parentValue() { return 'parent'; }
    }
    class Child extends Parent {
      get childValue() { return 'child'; }
    }
    const instance = new Child();
    const result = getComputedProperties(instance);
    const keys = result.map(([key]) => key);
    assert.notOk(keys.includes('parentValue') && keys.includes('childValue'));
  });

  test('returns empty array for non-class object', function(assert) {
    const obj = { a: 1, get b() { return 2; } };
    assert.deepEqual(getComputedProperties(obj), []);
  });
});
