// @ts-nocheck
import QUnit from 'qunit';
import { createRecord, store, relationships } from '@stonyx/orm';

const { module, test } = QUnit;

module('[Unit] hasMany | async resolution across frames', function(hooks) {
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

  test('child created in separate async frame with FK appears in parent hasMany getter', async function(assert) {
    // Create parent owner with no pets initially
    const owner = createRecord('owner', { id: 'owner-1', gender: 'male', age: 30 }, { serialize: false });

    assert.deepEqual(owner.pets, [], 'initially empty hasMany');

    // Simulate separate async frame
    await new Promise(resolve => setTimeout(resolve, 0));

    // Create child animal with FK pointing to parent (numeric id — animal model uses default attr('number'))
    const animal = createRecord('animal', { id: 1, type: 'dog', age: 3, size: 'large', owner: 'owner-1' }, { serialize: false });

    // The parent's hasMany getter should now include the child
    assert.strictEqual(owner.pets.length, 1, 'hasMany getter returns 1 child after async creation');
    assert.strictEqual(owner.pets[0], animal, 'hasMany getter contains the created child record');
  });

  test('parent.format() includes late-arriving child in hasMany key', async function(assert) {
    const owner = createRecord('owner', { id: 'owner-2', gender: 'female', age: 25 }, { serialize: false });

    await new Promise(resolve => setTimeout(resolve, 0));

    const animal = createRecord('animal', { id: 2, type: 'cat', age: 2, size: 'small', owner: 'owner-2' }, { serialize: false });

    const formatted = owner.format();
    assert.ok(Array.isArray(formatted.pets), 'format() pets key is an array');
    assert.strictEqual(formatted.pets.length, 1, 'format() includes 1 child');
    assert.strictEqual(formatted.pets[0].id, 2, 'format() child has correct id');
  });

  test('parent.toJSON() includes late-arriving child in hasMany key', async function(assert) {
    const owner = createRecord('owner', { id: 'owner-3', gender: 'male', age: 40 }, { serialize: false });

    await new Promise(resolve => setTimeout(resolve, 0));

    const animal = createRecord('animal', { id: 3, type: 'dog', age: 5, size: 'medium', owner: 'owner-3' }, { serialize: false });

    const json = owner.toJSON();
    assert.ok(json.relationships, 'toJSON has relationships');
    const petsRel = json.relationships.pets;
    assert.ok(petsRel, 'toJSON has pets relationship');
    assert.ok(Array.isArray(petsRel.data), 'pets relationship data is an array');
    assert.strictEqual(petsRel.data.length, 1, 'toJSON pets has 1 child');
    assert.strictEqual(petsRel.data[0].id, 3, 'toJSON child has correct id');
  });

  test('same-frame hasMany resolution still works (regression guard)', function(assert) {
    // Create owner with pet IDs in rawData — standard same-frame path
    const owner = createRecord('owner', { id: 'owner-4', gender: 'female', age: 35, pets: [{ id: 4, type: 'dog', age: 1, size: 'small' }] }, { serialize: false });

    assert.strictEqual(owner.pets.length, 1, 'same-frame hasMany has 1 child');
    assert.strictEqual(owner.pets[0].id, 4, 'same-frame child has correct id');
  });

  test('existing belongsTo inverse wiring still populates parent hasMany (regression guard)', function(assert) {
    // Create owner first
    const owner = createRecord('owner', { id: 'owner-5', gender: 'male', age: 50 }, { serialize: false });

    // Create animal with belongsTo owner — belongsTo handler wires into hasMany
    const animal = createRecord('animal', { id: 5, type: 'cat', age: 3, size: 'medium', owner: 'owner-5' }, { serialize: false });

    // The belongsTo inverse wiring path should populate owner.pets
    assert.strictEqual(owner.pets.length, 1, 'belongsTo inverse wiring populates hasMany');
    assert.strictEqual(owner.pets[0], animal, 'hasMany contains the child from belongsTo wiring');
  });
});
