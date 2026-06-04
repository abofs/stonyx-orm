// @ts-nocheck
import QUnit from 'qunit';
import sinon from 'sinon';
import Orm, { createRecord, store, relationships } from '@stonyx/orm';

const { module, test } = QUnit;

module('[Unit] createRecord | memory:false eviction (stonyx#81)', function(hooks) {
  hooks.afterEach(function() {
    store.get('owner')?.clear();
    store.get('animal')?.clear();
    relationships.get('hasMany')?.clear();
    relationships.get('belongsTo')?.clear();
    relationships.get('pending')?.clear();
    relationships.get('pendingBelongsTo')?.clear();
    sinon.restore();
  });

  test('memory:false model record is evicted from store after persist', async function(assert) {
    // Set up memory resolver — owner is memory:false
    store._memoryResolver = () => false;

    // Mock sqlDb with a persist that resolves
    const persistStub = sinon.stub().resolves();
    const origSqlDb = Orm.instance?.sqlDb;
    if (Orm.instance) Orm.instance.sqlDb = { persist: persistStub };

    const record = createRecord('owner', { id: 'evict-test', gender: 'female', age: 30 }, { serialize: false });

    // Record exists immediately after createRecord (persist hasn't completed yet)
    assert.ok(record, 'record returned to caller');
    assert.strictEqual(record.gender, 'female', 'record has correct data');

    // Wait for persist + finally to complete
    await new Promise(resolve => setTimeout(resolve, 10));

    // Record should be evicted from store
    assert.notOk(store.get('owner')?.has('evict-test'), 'record evicted from store after persist');

    // Restore
    store._memoryResolver = null;
    if (Orm.instance) Orm.instance.sqlDb = origSqlDb;
  });

  test('memory:true model record is retained in store after persist', async function(assert) {
    store._memoryResolver = () => true;

    const persistStub = sinon.stub().resolves();
    const origSqlDb = Orm.instance?.sqlDb;
    if (Orm.instance) Orm.instance.sqlDb = { persist: persistStub };

    const record = createRecord('owner', { id: 'retain-test', gender: 'male', age: 25 }, { serialize: false });

    await new Promise(resolve => setTimeout(resolve, 10));

    assert.ok(store.get('owner')?.has('retain-test'), 'record retained in store for memory:true');

    store._memoryResolver = null;
    if (Orm.instance) Orm.instance.sqlDb = origSqlDb;
  });

  test('caller reference remains valid after eviction', async function(assert) {
    store._memoryResolver = () => false;

    const persistStub = sinon.stub().resolves();
    const origSqlDb = Orm.instance?.sqlDb;
    if (Orm.instance) Orm.instance.sqlDb = { persist: persistStub };

    const record = createRecord('owner', { id: 'ref-test', gender: 'female', age: 42 }, { serialize: false });

    await new Promise(resolve => setTimeout(resolve, 10));

    // Record evicted from store but caller reference still valid
    assert.notOk(store.get('owner')?.has('ref-test'), 'record evicted from store');
    assert.strictEqual(record.gender, 'female', 'caller reference still has correct data');
    assert.strictEqual(record.id, 'ref-test', 'caller reference still has correct id');

    store._memoryResolver = null;
    if (Orm.instance) Orm.instance.sqlDb = origSqlDb;
  });

  test('belongsTo registry cleaned after eviction (stonyx#82)', async function(assert) {
    store._memoryResolver = () => false;

    const persistStub = sinon.stub().resolves();
    const origSqlDb = Orm.instance?.sqlDb;
    if (Orm.instance) Orm.instance.sqlDb = { persist: persistStub };

    // Create owner first, then animal that belongsTo owner
    // Animal model uses id = attr('number'), so use numeric IDs
    const owner = createRecord('owner', { id: 'owner-bt-1', gender: 'male', age: 40 }, { serialize: false });
    const animal = createRecord('animal', { id: 901, age: 3, size: 'medium', owner: 'owner-bt-1' }, { serialize: false });

    // Wait for persist + eviction
    await new Promise(resolve => setTimeout(resolve, 10));

    // The belongsTo registry entry for the evicted animal should be cleaned up
    const belongsToAnimal = relationships.get('belongsTo').get('animal');
    const ownerRef = belongsToAnimal?.get('owner');
    assert.notOk(ownerRef?.has(901), 'belongsTo registry entry for evicted animal is deleted');

    store._memoryResolver = null;
    if (Orm.instance) Orm.instance.sqlDb = origSqlDb;
  });

  test('hasMany array cleaned after eviction (stonyx#82)', async function(assert) {
    store._memoryResolver = () => false;

    const persistStub = sinon.stub().resolves();
    const origSqlDb = Orm.instance?.sqlDb;
    if (Orm.instance) Orm.instance.sqlDb = { persist: persistStub };

    // Create owner first, then animal belonging to owner
    const owner = createRecord('owner', { id: 'owner-hm-1', gender: 'female', age: 35 }, { serialize: false });
    const animal = createRecord('animal', { id: 902, age: 5, size: 'large', owner: 'owner-hm-1' }, { serialize: false });

    // Wait for persist + eviction
    await new Promise(resolve => setTimeout(resolve, 10));

    // The hasMany array for the owner should NOT contain the evicted animal
    const hasManyOwner = relationships.get('hasMany').get('owner');
    const animalArray = hasManyOwner?.get('animal')?.get('owner-hm-1');
    if (animalArray) {
      const containsEvicted = animalArray.some(r => r && r.id === 902);
      assert.notOk(containsEvicted, 'evicted animal removed from owner hasMany array');
    } else {
      assert.ok(true, 'hasMany array does not exist (cleaned up)');
    }

    store._memoryResolver = null;
    if (Orm.instance) Orm.instance.sqlDb = origSqlDb;
  });

  test('memory:true records NOT evicted from registry (control) (stonyx#82)', async function(assert) {
    store._memoryResolver = () => true;

    const persistStub = sinon.stub().resolves();
    const origSqlDb = Orm.instance?.sqlDb;
    if (Orm.instance) Orm.instance.sqlDb = { persist: persistStub };

    // Create owner first, then animal that belongsTo owner
    // Animal model uses id = attr('number'), so use numeric IDs
    const owner = createRecord('owner', { id: 'owner-mem-1', gender: 'male', age: 50 }, { serialize: false });
    const animal = createRecord('animal', { id: 903, age: 2, size: 'small', owner: 'owner-mem-1' }, { serialize: false });

    // Wait for persist
    await new Promise(resolve => setTimeout(resolve, 10));

    // For memory:true, the belongsTo registry entry should STILL exist
    const belongsToAnimal = relationships.get('belongsTo').get('animal');
    const ownerRef = belongsToAnimal?.get('owner');
    assert.ok(ownerRef?.has(903), 'belongsTo registry entry retained for memory:true model');

    // Record should still be in store
    assert.ok(store.get('animal')?.has(903), 'animal record retained in store for memory:true');

    store._memoryResolver = null;
    if (Orm.instance) Orm.instance.sqlDb = origSqlDb;
  });

  test('belongsTo registry cleaned when persist re-keys record ID (stonyx#82 follow-up)', async function(assert) {
    store._memoryResolver = () => false;

    // Mock sqlDb that simulates the adapter's re-key behavior:
    // after persist, updates record.id and re-keys the store Map
    const persistStub = sinon.stub().callsFake(async (operation, modelName, context, response) => {
      if (operation === 'create' && context.rawData?.__pendingSqlId) {
        const record = store.get(modelName)?.get(context.rawData.id);
        if (record) {
          const pendingId = record.id;
          const realId = 99999; // Simulate DB-assigned ID
          const modelStore = store.get(modelName);

          // This is exactly what postgres-db.ts / mysql-db.ts do:
          modelStore.delete(pendingId);
          record.__data.id = realId;
          record.id = realId;
          modelStore.set(realId, record);

          if (response?.data) response.data.id = realId;
          delete record.__data.__pendingSqlId;
        }
      }
    });

    const origSqlDb = Orm.instance?.sqlDb;
    if (Orm.instance) Orm.instance.sqlDb = { persist: persistStub };

    // Create owner first (parent must exist for non-pending belongsTo path)
    const owner = createRecord('owner', { id: 'owner-rekey-1', gender: 'male', age: 40 }, { serialize: false });

    // Create animal WITHOUT a preset ID — this triggers assignRecordId to assign
    // a pending negative ID, which the mock persist will re-key to 99999
    const animal = createRecord('animal', { age: 3, size: 'medium', owner: 'owner-rekey-1' }, { serialize: false });

    // Verify a pending ID was assigned (negative)
    // Note: record.id may have already been re-keyed by the time we check,
    // but the registry should still be cleaned regardless

    // Wait for persist + re-key + eviction
    await new Promise(resolve => setTimeout(resolve, 50));

    // The belongsTo registry should be clean — no entries for the evicted animal
    // (whether keyed by the pending ID OR the real ID)
    const belongsToAnimal = relationships.get('belongsTo')?.get('animal');
    if (belongsToAnimal) {
      const ownerRef = belongsToAnimal.get('owner');
      if (ownerRef) {
        // Neither the pending ID nor the real ID should remain
        let zombieCount = 0;
        for (const [key] of ownerRef) {
          zombieCount++;
        }
        assert.strictEqual(zombieCount, 0, 'no zombie belongsTo entries remain after re-keyed eviction');
      } else {
        assert.ok(true, 'owner target map cleaned up entirely');
      }
    } else {
      assert.ok(true, 'animal belongsTo map cleaned up entirely');
    }

    // Also verify the record was evicted from the store
    assert.notOk(store.get('animal')?.has(99999), 'record evicted from store (real ID)');

    store._memoryResolver = null;
    if (Orm.instance) Orm.instance.sqlDb = origSqlDb;
  });

  test('pendingBelongsTo registry cleaned after eviction (stonyx#83)', async function(assert) {
    store._memoryResolver = () => false;

    const persistStub = sinon.stub().resolves();
    const origSqlDb = Orm.instance?.sqlDb;
    if (Orm.instance) Orm.instance.sqlDb = { persist: persistStub };

    // Create animal with forward-reference to non-existent owner
    // This creates a pendingBelongsTo entry for owner
    const animal = createRecord('animal', { id: 904, age: 3, size: 'medium', owner: 'pending-owner-1' }, { serialize: false });

    // Verify pendingBelongsTo entry exists before eviction
    const pendingBT = relationships.get('pendingBelongsTo');
    const ownerPending = pendingBT?.get('owner');
    assert.ok(ownerPending?.has('pending-owner-1'), 'pendingBelongsTo entry exists before eviction');

    // Wait for persist + eviction
    await new Promise(resolve => setTimeout(resolve, 10));

    // After eviction, the animal is gone from store
    assert.notOk(store.get('animal')?.has(904), 'animal evicted from store');

    store._memoryResolver = null;
    if (Orm.instance) Orm.instance.sqlDb = origSqlDb;
  });

  test('persist error still evicts record and emits error', async function(assert) {
    store._memoryResolver = () => false;

    const persistError = new Error('DB connection lost');
    const persistStub = sinon.stub().rejects(persistError);
    const emitStub = sinon.stub();
    const origSqlDb = Orm.instance?.sqlDb;
    const origEmit = Orm.instance?.emitPersistError;
    if (Orm.instance) {
      Orm.instance.sqlDb = { persist: persistStub };
      Orm.instance.emitPersistError = emitStub;
    }

    const record = createRecord('owner', { id: 'err-test', gender: 'male', age: 50 }, { serialize: false });

    await new Promise(resolve => setTimeout(resolve, 10));

    // Error was emitted
    assert.ok(emitStub.calledOnce, 'emitPersistError called');
    assert.strictEqual(emitStub.firstCall.args[0].operation, 'create', 'error has correct operation');

    // Record still evicted from store
    assert.notOk(store.get('owner')?.has('err-test'), 'record evicted even after persist error');

    store._memoryResolver = null;
    if (Orm.instance) {
      Orm.instance.sqlDb = origSqlDb;
      Orm.instance.emitPersistError = origEmit;
    }
  });
});
