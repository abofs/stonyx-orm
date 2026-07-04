// @ts-nocheck
import QUnit from 'qunit';
import { createRecord, store, relationships } from '@stonyx/orm';

const { module, test } = QUnit;

module('[Unit] Record | toJSON/format with cleaned records (#170)', function(hooks) {
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

  module('toJSON with cleaned records', function() {
    test('toJSON does not throw when hasMany array contains a cleaned record', function(assert) {
      const owner = createRecord('owner', { id: 'owner-clean-1', gender: 'male', age: 30 }, { serialize: false });
      const animal = createRecord('animal', { id: 1, type: 'dog', age: 3, size: 'large', owner: 'owner-clean-1' }, { serialize: false });

      // Verify pet is wired before cleaning
      assert.strictEqual(owner.pets.length, 1, 'pet is wired before clean');

      // Simulate a cleaned record (all properties deleted)
      animal.clean();

      // Should not throw
      const json = owner.toJSON();
      assert.ok(json, 'toJSON returns without throwing');
    });

    test('toJSON output excludes the cleaned record from relationship data array', function(assert) {
      const owner = createRecord('owner', { id: 'owner-clean-2', gender: 'female', age: 25 }, { serialize: false });
      createRecord('animal', { id: 2, type: 'cat', age: 2, size: 'small', owner: 'owner-clean-2' }, { serialize: false });
      const animal2 = createRecord('animal', { id: 3, type: 'dog', age: 4, size: 'medium', owner: 'owner-clean-2' }, { serialize: false });

      // Clean only one of the two animals
      animal2.clean();

      const json = owner.toJSON();
      const petsData = json.relationships.pets.data;

      assert.ok(Array.isArray(petsData), 'pets data is still an array');
      assert.strictEqual(petsData.length, 1, 'cleaned record excluded from array');
      assert.strictEqual(petsData[0].id, 2, 'remaining record has correct id');
    });

    test('toJSON does not throw when belongsTo slot contains a cleaned record', function(assert) {
      const owner = createRecord('owner', { id: 'owner-clean-3', gender: 'male', age: 40 }, { serialize: false });
      const animal = createRecord('animal', { id: 4, type: 'dog', age: 5, size: 'large', owner: 'owner-clean-3' }, { serialize: false });

      // Verify belongsTo is wired
      assert.strictEqual(animal.owner, owner, 'owner is wired before clean');

      // Clean the owner record
      owner.clean();

      // Should not throw
      const json = animal.toJSON();
      assert.ok(json, 'toJSON returns without throwing');
    });

    test('toJSON output shows null for cleaned belongsTo relationship data', function(assert) {
      const owner = createRecord('owner', { id: 'owner-clean-4', gender: 'female', age: 35 }, { serialize: false });
      const animal = createRecord('animal', { id: 5, type: 'cat', age: 1, size: 'small', owner: 'owner-clean-4' }, { serialize: false });

      // Clean the owner
      owner.clean();

      const json = animal.toJSON();
      assert.strictEqual(json.relationships.owner.data, null, 'cleaned belongsTo shows null');
    });
  });

  module('format with cleaned records', function() {
    test('format does not throw when hasMany array contains a cleaned record', function(assert) {
      const owner = createRecord('owner', { id: 'owner-clean-5', gender: 'male', age: 30 }, { serialize: false });
      const animal = createRecord('animal', { id: 6, type: 'dog', age: 3, size: 'large', owner: 'owner-clean-5' }, { serialize: false });

      // Verify pet is wired before cleaning
      assert.strictEqual(owner.pets.length, 1, 'pet is wired before clean');

      // Simulate a cleaned record
      animal.clean();

      // Should not throw
      const formatted = owner.format();
      assert.ok(formatted, 'format returns without throwing');
    });

    test('format output excludes cleaned record from serialized array', function(assert) {
      const owner = createRecord('owner', { id: 'owner-clean-6', gender: 'female', age: 25 }, { serialize: false });
      createRecord('animal', { id: 7, type: 'cat', age: 2, size: 'small', owner: 'owner-clean-6' }, { serialize: false });
      const animal2 = createRecord('animal', { id: 8, type: 'dog', age: 4, size: 'medium', owner: 'owner-clean-6' }, { serialize: false });

      // Clean only one
      animal2.clean();

      const formatted = owner.format();
      assert.ok(Array.isArray(formatted.pets), 'pets is still an array');
      assert.strictEqual(formatted.pets.length, 1, 'cleaned record excluded');
      assert.strictEqual(formatted.pets[0].id, 7, 'remaining record has correct id');
    });

    test('format does not throw when belongsTo slot contains a cleaned record', function(assert) {
      const owner = createRecord('owner', { id: 'owner-clean-7', gender: 'male', age: 40 }, { serialize: false });
      const animal = createRecord('animal', { id: 9, type: 'dog', age: 5, size: 'large', owner: 'owner-clean-7' }, { serialize: false });

      // Verify belongsTo is wired
      assert.strictEqual(animal.owner, owner, 'owner is wired before clean');

      // Clean the owner
      owner.clean();

      // Should not throw
      const formatted = animal.format();
      assert.ok(formatted, 'format returns without throwing');
    });

    test('format output shows null for cleaned belongsTo slot', function(assert) {
      const owner = createRecord('owner', { id: 'owner-clean-8', gender: 'female', age: 35 }, { serialize: false });
      const animal = createRecord('animal', { id: 10, type: 'cat', age: 1, size: 'small', owner: 'owner-clean-8' }, { serialize: false });

      // Clean the owner
      owner.clean();

      const formatted = animal.format();
      assert.strictEqual(formatted.owner, null, 'cleaned belongsTo shows null in format output');
    });
  });
});
