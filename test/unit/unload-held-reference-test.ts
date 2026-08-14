// @ts-nocheck
import QUnit from 'qunit';
import { createRecord, store, relationships } from '@stonyx/orm';

const { module, test } = QUnit;

module('[Unit] Store | unloadRecord held-reference corruption (#176)', function(hooks) {
  const clearStores = function() {
    const models = ['owner', 'animal', 'trait', 'category', 'phone-number'];
    for (const model of models) {
      const modelStore = store.get(model);
      if (modelStore) modelStore.clear();
    }

    relationships.get('hasMany')?.clear();
    relationships.get('belongsTo')?.clear();
    relationships.get('pending')?.clear();
    relationships.get('pendingBelongsTo')?.clear();
  };

  hooks.beforeEach(clearStores);
  hooks.afterEach(clearStores);

  module('held references survive unloadRecord', function() {
    test('record is removed from store after unloadRecord', function(assert) {
      createRecord('animal', { id: 1, type: 'dog', age: 3, size: 'large' }, { serialize: false });

      store.unloadRecord('animal', 1);

      assert.strictEqual(store.get('animal', 1), undefined, 'store.get returns undefined after unload');
    });

    test('held reference preserves __data after unloadRecord', function(assert) {
      const heldRef = createRecord('animal', { id: 1, type: 'dog', age: 3, size: 'large' }, { serialize: false });

      store.unloadRecord('animal', 1);

      assert.notStrictEqual(heldRef.__data, undefined, '__data is preserved on held reference');
    });

    test('held reference preserves __model after unloadRecord', function(assert) {
      const heldRef = createRecord('animal', { id: 1, type: 'dog', age: 3, size: 'large' }, { serialize: false });

      store.unloadRecord('animal', 1);

      assert.notStrictEqual(heldRef.__model, undefined, '__model is preserved on held reference');
    });

    test('held reference serialize() does not throw after unloadRecord', function(assert) {
      const heldRef = createRecord('animal', { id: 1, type: 'dog', age: 3, size: 'large' }, { serialize: false });

      store.unloadRecord('animal', 1);

      const result = heldRef.serialize();
      assert.ok(result, 'serialize() does not throw after unload');
      assert.strictEqual(typeof result, 'object', 'serialize() returns a valid object');
    });
  });

  module('held child references survive unloadRecord with includeChildren', function() {
    test('held child reference preserves __data after parent unload with includeChildren', function(assert) {
      createRecord('owner', { id: 'owner-176-1', gender: 'male', age: 30 }, { serialize: false });
      const heldChild = createRecord('animal', { id: 1, type: 'dog', age: 3, size: 'large', owner: 'owner-176-1' }, { serialize: false });

      store.unloadRecord('owner', 'owner-176-1', { includeChildren: true });

      assert.notStrictEqual(heldChild.__data, undefined, 'child __data is preserved after parent unload with includeChildren');
    });

    test('held child reference serialize() does not throw after parent unload with includeChildren', function(assert) {
      createRecord('owner', { id: 'owner-176-2', gender: 'female', age: 25 }, { serialize: false });
      const heldChild = createRecord('animal', { id: 2, type: 'cat', age: 2, size: 'small', owner: 'owner-176-2' }, { serialize: false });

      store.unloadRecord('owner', 'owner-176-2', { includeChildren: true });

      const result = heldChild.serialize();
      assert.ok(result, 'child serialize() does not throw after parent unload with includeChildren');
    });
  });
});
