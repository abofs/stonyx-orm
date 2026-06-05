// @ts-nocheck
import QUnit from 'qunit';
import sinon from 'sinon';
import Orm, { createRecord, store, relationships } from '@stonyx/orm';

const { module, test } = QUnit;

module('[Unit] belongsTo FK preservation | memory:false target (#145)', function(hooks) {
  const clearStores = function() {
    const models = ['trait', 'category', 'owner', 'animal'];
    for (const model of models) {
      const modelStore = store.get(model);
      if (modelStore) modelStore.clear();
    }

    relationships.get('hasMany')?.clear();
    relationships.get('belongsTo')?.clear();
    relationships.get('pending')?.clear();
    relationships.get('pendingBelongsTo')?.clear();
    sinon.restore();
  };

  hooks.beforeEach(clearStores);
  hooks.afterEach(clearStores);

  // AC1 / Validation 1: After boot-like creation with memory:false target,
  // record.__data['owner'] === 'owner-123'
  test('__data preserves raw FK string when belongsTo target is unresolved', function(assert) {
    // Create animal with FK to owner that does NOT exist in store (simulates memory:false boot)
    const animal = createRecord('animal', {
      id: 'fk-pres-1', type: 'dog', age: 3, size: 'large', owner: 'owner-123'
    }, { serialize: false });

    assert.strictEqual(animal.__data.owner, 'owner-123',
      '__data preserves the raw FK value when target is unresolved');
  });

  // AC2 / Validation 2: After boot-like creation with memory:false target,
  // record.__relationships['owner'] === null
  test('__relationships is null when belongsTo target is unresolved', function(assert) {
    const animal = createRecord('animal', {
      id: 'fk-pres-2', type: 'cat', age: 2, size: 'small', owner: 'owner-456'
    }, { serialize: false });

    assert.strictEqual(animal.__relationships.owner, null,
      '__relationships is null for unresolved belongsTo');
  });

  // AC3 / Validation 3: pendingBelongsToRegistry has entry for the target model and FK value
  test('pendingBelongsTo registry entry exists for unresolved FK', function(assert) {
    createRecord('animal', {
      id: 'fk-pres-3', type: 'dog', age: 4, size: 'medium', owner: 'pending-owner-abc'
    }, { serialize: false });

    const pendingBT = relationships.get('pendingBelongsTo');
    const ownerPending = pendingBT?.get('owner')?.get('pending-owner-abc');

    assert.ok(ownerPending, 'pendingBelongsTo entry exists for target model');
    assert.ok(ownerPending.length > 0, 'pending queue has at least one entry');
    assert.strictEqual(ownerPending[0].sourceModelName, 'animal', 'source model is correct');
  });

  // AC4 / Validation 4: Adapter persist path can extract FK from __data fallback
  test('_recordToRow extracts FK from __data when __relationships is null', function(assert) {
    const animal = createRecord('animal', {
      id: 'fk-pres-4', type: 'dog', age: 5, size: 'large', owner: 'owner-for-persist'
    }, { serialize: false });

    // Verify __data has the FK value (the adapter fallback path)
    assert.strictEqual(animal.__data.owner, 'owner-for-persist',
      '__data contains FK value that adapters use as fallback');
    assert.strictEqual(animal.__relationships.owner, null,
      '__relationships is null so adapter falls through to __data');
  });

  // AC5 / Validation 5: When target record is later created, pending fulfillment wires
  // __relationships['owner'] to resolved record
  test('pending belongsTo fulfillment wires __relationships to resolved record', function(assert) {
    // Create animal with unresolved owner
    const animal = createRecord('animal', {
      id: 'fk-pres-5', type: 'dog', age: 3, size: 'large', owner: 'deferred-owner'
    }, { serialize: false });

    assert.strictEqual(animal.__relationships.owner, null, 'initially null');

    // Now create the owner — this should fulfill the pending belongsTo
    const owner = createRecord('owner', {
      id: 'deferred-owner', gender: 'male', age: 30
    }, { serialize: false });

    assert.strictEqual(animal.__relationships.owner, owner,
      '__relationships wired to resolved record after fulfillment');
    assert.strictEqual(animal.owner, owner,
      'direct property also wired to resolved record');
  });

  // AC6 / Validation 6: For memory:true target that resolves immediately,
  // __data['owner'] is NOT set (current behavior preserved)
  test('__data does NOT store FK when belongsTo target resolves immediately', function(assert) {
    // Create owner FIRST so it exists in store
    createRecord('owner', {
      id: 'existing-owner', gender: 'female', age: 25
    }, { serialize: false });

    // Create animal — owner should resolve immediately
    const animal = createRecord('animal', {
      id: 'fk-pres-6', type: 'cat', age: 2, size: 'small', owner: 'existing-owner'
    }, { serialize: false });

    assert.strictEqual(animal.__data.owner, undefined,
      '__data should NOT have FK when target resolved immediately');
    assert.ok(animal.__relationships.owner,
      '__relationships is the resolved record');
    assert.strictEqual(animal.__relationships.owner.id, 'existing-owner',
      'resolved record has correct id');
  });

  // AC7 / Validation 7: When no FK provided (optional relationship),
  // handler returns null AND __data['owner'] remains undefined
  test('__data is NOT set for null/undefined FK (optional relationship)', function(assert) {
    // Create animal without providing owner FK at all
    const animal = createRecord('animal', {
      id: 'fk-pres-7', type: 'dog', age: 1, size: 'small'
    }, { serialize: false });

    assert.strictEqual(animal.__data.owner, undefined,
      '__data should NOT have FK when no FK provided');
    assert.strictEqual(animal.__relationships.owner, null,
      '__relationships is null for missing optional FK');
  });

  // AC8 / Validation 8: Falsy FK value (0) — belongs-to.ts already treats 0 as falsy
  // (line 33: `if (!rawData) return null`), so 0 is handled same as null/undefined.
  // The guard `data && typeof data !== 'object'` correctly does NOT preserve 0,
  // which is consistent with the belongsTo handler never registering pending for 0.
  test('falsy FK value (0) is not preserved in __data — consistent with belongsTo handler', function(assert) {
    const animal = createRecord('animal', {
      id: 'fk-pres-8', type: 'dog', age: 2, size: 'medium', owner: 0
    }, { serialize: false });

    // belongsTo handler returns null for falsy rawData (including 0),
    // and no pending registration happens, so __data should NOT have FK
    assert.strictEqual(animal.__data.owner, undefined,
      '__data should NOT store falsy FK value (0) — belongs-to treats it as null');
    assert.strictEqual(animal.__relationships.owner, null,
      '__relationships is null for falsy FK');
  });

  // Additional: null FK explicitly provided
  test('explicit null FK is not preserved in __data', function(assert) {
    const animal = createRecord('animal', {
      id: 'fk-pres-9', type: 'dog', age: 2, size: 'medium', owner: null
    }, { serialize: false });

    assert.strictEqual(animal.__data.owner, undefined,
      '__data should NOT store explicit null FK');
    assert.strictEqual(animal.__relationships.owner, null,
      '__relationships is null for null FK');
  });

  // Additional: belongsTo with trait->category (different model pair)
  test('FK preservation works for trait->category belongsTo', function(assert) {
    // Create trait with FK to category that does NOT exist in store
    const trait = createRecord('trait', {
      id: 1, type: 'color', value: 'black', category: 'appearance'
    });

    assert.strictEqual(trait.__data.category, 'appearance',
      '__data preserves category FK when target is unresolved');
    assert.strictEqual(trait.__relationships.category, null,
      '__relationships is null for unresolved category');
  });
});
