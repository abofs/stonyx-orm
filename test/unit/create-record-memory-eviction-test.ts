// @ts-nocheck
import QUnit from 'qunit';
import sinon from 'sinon';
import Orm, { createRecord, store } from '@stonyx/orm';

const { module, test } = QUnit;

module('[Unit] createRecord | memory:false eviction (stonyx#81)', function(hooks) {
  hooks.afterEach(function() {
    store.get('owner')?.clear();
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
