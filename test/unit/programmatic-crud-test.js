import QUnit from 'qunit';
import sinon from 'sinon';
import Orm, { createRecord, updateRecord, store } from '@stonyx/orm';

const { module, test } = QUnit;

module('[Unit] Data-Layer Auto-Persist | createRecord / updateRecord / store.remove', function(hooks) {
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

  module('createRecord auto-persist', function() {
    test('calls sqlDb.persist with create when sqlDb is configured', function(assert) {
      const persistStub = sinon.stub().resolves();
      Orm.initialized = true;
      Orm.instance.sqlDb = { persist: persistStub };

      const record = createRecord('owner', { id: 'test-1', gender: 'female' }, { serialize: false });

      assert.strictEqual(record.id, 'test-1', 'record has correct id');
      assert.ok(persistStub.calledOnce, 'sqlDb.persist was called');
      assert.strictEqual(persistStub.firstCall.args[0], 'create', 'persist called with create operation');
      assert.strictEqual(persistStub.firstCall.args[1], 'owner', 'persist called with model name');
      assert.deepEqual(persistStub.firstCall.args[2].rawData, { id: 'test-1', gender: 'female' }, 'persist context contains rawData');
      assert.strictEqual(persistStub.firstCall.args[3].data.id, 'test-1', 'persist response contains record id');
    });

    test('does NOT call persist when isDbRecord is true', function(assert) {
      const persistStub = sinon.stub().resolves();
      Orm.initialized = true;
      Orm.instance.sqlDb = { persist: persistStub };

      createRecord('owner', { id: 'db-1', gender: 'male' }, { serialize: false, isDbRecord: true });

      assert.ok(persistStub.notCalled, 'sqlDb.persist was NOT called for DB load');
    });

    test('does NOT call persist when _relationshipKey is set', function(assert) {
      const persistStub = sinon.stub().resolves();
      Orm.initialized = true;
      Orm.instance.sqlDb = { persist: persistStub };

      createRecord('owner', { id: 'rel-1', gender: 'female' }, { serialize: false, _relationshipKey: 'owner' });

      assert.ok(persistStub.notCalled, 'sqlDb.persist was NOT called for relationship resolution');
    });

    test('does NOT call persist when _skipAutoPersist is true', function(assert) {
      const persistStub = sinon.stub().resolves();
      Orm.initialized = true;
      Orm.instance.sqlDb = { persist: persistStub };

      createRecord('owner', { id: 'skip-1', gender: 'male' }, { serialize: false, _skipAutoPersist: true });

      assert.ok(persistStub.notCalled, 'sqlDb.persist was NOT called when _skipAutoPersist is true');
    });

    test('does NOT call persist when sqlDb is not configured', function(assert) {
      Orm.initialized = true;
      Orm.instance.sqlDb = undefined;

      const record = createRecord('owner', { id: 'no-sql', gender: 'male' }, { serialize: false });

      assert.strictEqual(record.id, 'no-sql', 'record created in memory');
      assert.ok(store.get('owner').has('no-sql'), 'record exists in store');
    });
  });

  module('updateRecord auto-persist', function() {
    test('calls sqlDb.persist with update and old state', function(assert) {
      const persistStub = sinon.stub().resolves();
      Orm.initialized = true;
      Orm.instance.sqlDb = { persist: persistStub };

      const record = createRecord('owner', { id: 'upd-1', gender: 'female', age: 25 }, { serialize: false, _skipAutoPersist: true });
      persistStub.resetHistory();

      updateRecord(record, { gender: 'male', age: 30 });

      assert.ok(persistStub.calledOnce, 'sqlDb.persist was called');
      assert.strictEqual(persistStub.firstCall.args[0], 'update', 'persist called with update operation');
      assert.strictEqual(persistStub.firstCall.args[1], 'owner', 'persist called with model name');

      const context = persistStub.firstCall.args[2];
      assert.strictEqual(context.oldState.gender, 'female', 'old state captured before update');
      assert.strictEqual(context.oldState.age, 25, 'old age captured');
    });

    test('does NOT call persist when isDbRecord is true', function(assert) {
      const persistStub = sinon.stub().resolves();
      Orm.initialized = true;
      Orm.instance.sqlDb = { persist: persistStub };

      const record = createRecord('owner', { id: 'upd-db-1', gender: 'female' }, { serialize: false, _skipAutoPersist: true });
      persistStub.resetHistory();

      updateRecord(record, { gender: 'male' }, { isDbRecord: true });

      assert.ok(persistStub.notCalled, 'sqlDb.persist was NOT called for DB load update');
    });
  });

  module('store.remove auto-persist', function() {
    test('calls sqlDb.persist with delete when sqlDb is configured', function(assert) {
      const persistStub = sinon.stub().resolves();
      Orm.initialized = true;
      Orm.instance.sqlDb = { persist: persistStub };

      createRecord('owner', { id: 'del-1', gender: 'female' }, { serialize: false, _skipAutoPersist: true });
      persistStub.resetHistory();
      assert.ok(store.get('owner').has('del-1'), 'record exists before remove');

      store.remove('owner', 'del-1');

      assert.ok(persistStub.calledOnce, 'sqlDb.persist was called');
      assert.strictEqual(persistStub.firstCall.args[0], 'delete', 'persist called with delete operation');
      assert.strictEqual(persistStub.firstCall.args[1], 'owner', 'persist called with model name');
      assert.strictEqual(persistStub.firstCall.args[2].recordId, 'del-1', 'persist context contains record id');
      assert.notOk(store.get('owner').has('del-1'), 'record removed from store');
    });

    test('removes from store without SQL when sqlDb is not configured', function(assert) {
      Orm.initialized = true;
      Orm.instance.sqlDb = undefined;

      createRecord('owner', { id: 'del-nosql', gender: 'male' }, { serialize: false });

      store.remove('owner', 'del-nosql');

      assert.notOk(store.get('owner').has('del-nosql'), 'record removed from store');
    });
  });

  module('removed static methods', function() {
    test('Orm.create is not a function', function(assert) {
      assert.strictEqual(typeof Orm.create, 'undefined', 'Orm.create does not exist');
    });

    test('Orm.update is not a function', function(assert) {
      assert.strictEqual(typeof Orm.update, 'undefined', 'Orm.update does not exist');
    });

    test('Orm.remove is not a function', function(assert) {
      assert.strictEqual(typeof Orm.remove, 'undefined', 'Orm.remove does not exist');
    });
  });

  module('error handling', function() {
    test('persist error is caught and logged, not thrown', function(assert) {
      const done = assert.async();
      const error = new Error('SQL connection failed');
      const persistStub = sinon.stub().rejects(error);
      Orm.initialized = true;
      Orm.instance.sqlDb = { persist: persistStub };

      // This should NOT throw — the error is caught internally
      const record = createRecord('owner', { id: 'err-1', gender: 'female' }, { serialize: false });

      assert.strictEqual(record.id, 'err-1', 'record created despite persist failure');
      assert.ok(persistStub.calledOnce, 'persist was attempted');

      // Give the catch handler time to execute
      setTimeout(() => done(), 50);
    });
  });
});
