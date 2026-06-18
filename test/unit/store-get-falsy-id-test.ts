// @ts-nocheck
import QUnit from 'qunit';
import Store from '../../src/store.js';

const { module, test } = QUnit;

function createStore() {
  Store.instance = null;
  const store = new Store();

  const widgetStore = new Map();
  widgetStore.set(1, { id: 1, name: 'Widget A', __data: { id: 1 }, toJSON() { return { id: 1 }; } });
  widgetStore.set(0, { id: 0, name: 'Widget Zero', __data: { id: 0 }, toJSON() { return { id: 0 }; } });
  store.data.set('widget', widgetStore);

  return store;
}

module('[Unit] Store.get — falsy ID handling (#167)', function(hooks) {
  hooks.afterEach(function() {
    Store.instance = null;
  });

  test('get(key) with no id returns the model Map', function(assert) {
    const store = createStore();
    const result = store.get('widget');
    assert.ok(result instanceof Map, 'returns the Map when called with 1 arg');
  });

  test('get(key, validId) returns the record', function(assert) {
    const store = createStore();
    const result = store.get('widget', 1);
    assert.strictEqual(result.name, 'Widget A', 'returns record for id=1');
  });

  test('get(key, 0) returns the record at id=0, not the Map', function(assert) {
    const store = createStore();
    const result = store.get('widget', 0);
    assert.strictEqual(result.name, 'Widget Zero', 'returns record for id=0');
    assert.ok(!(result instanceof Map), 'does NOT return the Map');
  });

  test('get(key, missingId) returns undefined, not the Map', function(assert) {
    const store = createStore();
    const result = store.get('widget', 999);
    assert.strictEqual(result, undefined, 'returns undefined for missing id');
  });

  test('get(key, emptyString) returns undefined for missing record, not the Map', function(assert) {
    const store = createStore();
    const result = store.get('widget', '');
    // Empty string is a valid (if unusual) key — should look up in the Map, not return the Map itself
    assert.strictEqual(result, undefined, 'returns undefined for empty-string id when no record exists');
    assert.ok(!(result instanceof Map), 'does NOT return the Map');
  });
});
