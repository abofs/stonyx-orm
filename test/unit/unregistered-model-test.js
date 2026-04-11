import QUnit from 'qunit';
import { createRecord, store, relationships } from '@stonyx/orm';

const { module, test } = QUnit;

module('[Unit] Unregistered model guards', function(hooks) {
  hooks.afterEach(function() {
    // Restore any deleted store entries
    for (const model of ['trait', 'category', 'owner', 'animal']) {
      if (!store.get(model)) store.set(model, new Map());
      else store.get(model).clear();
    }

    relationships.get('hasMany')?.clear();
    relationships.get('belongsTo')?.clear();
    relationships.get('pending')?.clear();
    relationships.get('pendingBelongsTo')?.clear();
  });

  test('createRecord throws a descriptive error for an unregistered model', function(assert) {
    assert.throws(
      () => createRecord('nonexistent-model', { id: 1 }),
      /Model store for 'nonexistent-model' is not registered/,
      'throws a clear error instead of TypeError'
    );
  });

  test('belongsTo with unregistered target model queues as pending instead of crashing', function(assert) {
    // Remove the category store to simulate an unregistered model
    const categoryStore = store.get('category');
    store.data.delete('category');

    try {
      // trait model has belongsTo('category') — with category store deleted, this should not throw
      const trait = createRecord('trait', { id: 1, type: 'color', value: 'black', category: 'appearance' });

      assert.equal(trait.category, null, 'belongsTo returns null when target model is unregistered');

      const pendingBelongsTo = relationships.get('pendingBelongsTo');
      const pendingForCategory = pendingBelongsTo.get('category');

      assert.ok(pendingForCategory, 'pending belongsTo queue created for unregistered model');
      assert.ok(pendingForCategory.get('appearance'), 'pending entry registered for the target ID');
    } finally {
      // Restore
      store.set('category', categoryStore);
    }
  });

  test('hasMany with unregistered target model queues as pending instead of crashing', function(assert) {
    // Remove the phone-number store to simulate an unregistered model
    const phoneStore = store.get('phone-number');
    store.data.delete('phone-number');

    try {
      // owner model has hasMany('phone-number') — with phone-number store deleted,
      // string ID references should queue as pending, not throw a TypeError
      const owner = createRecord('owner', { name: 'TestOwner', phoneNumbers: ['pn-1', 'pn-2'] });

      assert.deepEqual(owner.phoneNumbers, [], 'hasMany returns empty array when target model is unregistered');

      const pendingRelationships = relationships.get('pending');
      const pendingForPhone = pendingRelationships.get('phone-number');

      assert.ok(pendingForPhone, 'pending queue created for unregistered model');
    } finally {
      // Restore
      store.set('phone-number', phoneStore);
    }
  });
});
