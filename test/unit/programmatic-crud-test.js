import QUnit from 'qunit';
import sinon from 'sinon';
import Orm, { createRecord, store } from '@stonyx/orm';

const { module, test } = QUnit;

module('[Unit] Programmatic CRUD | Orm.create / Orm.update / Orm.remove', function(hooks) {
  let originalSqlDb;
  let originalInitialized;

  hooks.beforeEach(function() {
    originalSqlDb = Orm.instance?.sqlDb;
    originalInitialized = Orm.initialized;
  });

  hooks.afterEach(function() {
    if (Orm.instance) Orm.instance.sqlDb = originalSqlDb;
    Orm.initialized = originalInitialized;
    store.get('owner')?.clear();
    sinon.restore();
  });

  module('Orm.create', function() {
    test('creates record in memory and calls sqlDb.persist', async function(assert) {
      const persistStub = sinon.stub().resolves();
      Orm.initialized = true;
      Orm.instance.sqlDb = { persist: persistStub };

      const record = await Orm.create('owner', { id: 'test-1', gender: 'female' });

      assert.strictEqual(record.id, 'test-1', 'record has correct id');
      assert.ok(persistStub.calledOnce, 'sqlDb.persist was called');
      assert.strictEqual(persistStub.firstCall.args[0], 'create', 'persist called with create operation');
      assert.strictEqual(persistStub.firstCall.args[1], 'owner', 'persist called with model name');
      assert.strictEqual(persistStub.firstCall.args[3].data.id, 'test-1', 'persist response contains record id');
    });

    test('creates record without SQL when sqlDb is not configured', async function(assert) {
      Orm.initialized = true;
      Orm.instance.sqlDb = undefined;

      const record = await Orm.create('owner', { id: 'no-sql', gender: 'male' });

      assert.strictEqual(record.id, 'no-sql', 'record created in memory');
      assert.ok(store.get('owner').has('no-sql'), 'record exists in store');
    });

    test('throws when ORM is not initialized', async function(assert) {
      Orm.initialized = false;

      await assert.rejects(
        Orm.create('owner', { id: 'fail', gender: 'fail' }),
        /ORM is not ready/,
        'throws ORM not ready error'
      );
    });
  });

  module('Orm.update', function() {
    test('updates record and calls sqlDb.persist with old state', async function(assert) {
      const persistStub = sinon.stub().resolves();
      Orm.initialized = true;
      Orm.instance.sqlDb = { persist: persistStub };

      createRecord('owner', { id: 'upd-1', gender: 'female', age: 25 }, { serialize: false });

      const record = await Orm.update('owner', 'upd-1', { gender: 'male', age: 30 });

      assert.strictEqual(record.gender, 'male', 'record gender was updated');
      assert.strictEqual(record.age, 30, 'record age was updated');
      assert.ok(persistStub.calledOnce, 'sqlDb.persist was called');
      assert.strictEqual(persistStub.firstCall.args[0], 'update', 'persist called with update operation');
      assert.strictEqual(persistStub.firstCall.args[1], 'owner', 'persist called with model name');

      const context = persistStub.firstCall.args[2];
      assert.strictEqual(context.oldState.gender, 'female', 'old state captured before update');
      assert.strictEqual(context.oldState.age, 25, 'old age captured');
    });

    test('throws when record does not exist', async function(assert) {
      Orm.initialized = true;
      Orm.instance.sqlDb = undefined;

      await assert.rejects(
        Orm.update('owner', 'nonexistent', { gender: 'fail' }),
        /not found/,
        'throws record not found error'
      );
    });

    test('throws when ORM is not initialized', async function(assert) {
      Orm.initialized = false;

      await assert.rejects(
        Orm.update('owner', 'fail', { gender: 'fail' }),
        /ORM is not ready/,
        'throws ORM not ready error'
      );
    });
  });

  module('Orm.remove', function() {
    test('calls sqlDb.persist with delete operation then removes from store', async function(assert) {
      const persistStub = sinon.stub().resolves();
      Orm.initialized = true;
      Orm.instance.sqlDb = { persist: persistStub };

      createRecord('owner', { id: 'del-1', gender: 'female' }, { serialize: false });
      assert.ok(store.get('owner').has('del-1'), 'record exists before remove');

      await Orm.remove('owner', 'del-1');

      assert.ok(persistStub.calledOnce, 'sqlDb.persist was called');
      assert.strictEqual(persistStub.firstCall.args[0], 'delete', 'persist called with delete operation');
      assert.strictEqual(persistStub.firstCall.args[2].recordId, 'del-1', 'persist context contains record id');
      assert.notOk(store.get('owner').has('del-1'), 'record removed from store');
    });

    test('removes from store without SQL when sqlDb is not configured', async function(assert) {
      Orm.initialized = true;
      Orm.instance.sqlDb = undefined;

      createRecord('owner', { id: 'del-nosql', gender: 'male' }, { serialize: false });

      await Orm.remove('owner', 'del-nosql');

      assert.notOk(store.get('owner').has('del-nosql'), 'record removed from store');
    });

    test('throws when ORM is not initialized', async function(assert) {
      Orm.initialized = false;

      await assert.rejects(
        Orm.remove('owner', 'fail'),
        /ORM is not ready/,
        'throws ORM not ready error'
      );
    });
  });
});
