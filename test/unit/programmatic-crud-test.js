import QUnit from 'qunit';
import sinon from 'sinon';
import Orm, { createRecord, updateRecord, store } from '@stonyx/orm';
import log from 'stonyx/log';

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
    store.get('animal')?.clear();
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

  module('pending ID assignment for auto-increment models', function() {
    test('assigns a unique negative integer when model has numeric ID and sqlDb is configured', function(assert) {
      const persistStub = sinon.stub().resolves();
      Orm.initialized = true;
      Orm.instance.sqlDb = { persist: persistStub };

      // animal model does NOT define id = attr('string'), so it's a numeric-ID model
      const record = createRecord('animal', { type: 'dog', age: 3, size: 'large' }, { serialize: false });

      assert.ok(typeof record.id === 'number', 'record.id is a number');
      assert.ok(record.id < 0, 'record.id is negative (pending)');
      assert.notOk(isNaN(record.id), 'record.id is NOT NaN');
    });

    test('assigns distinct negative IDs for multiple records', function(assert) {
      const persistStub = sinon.stub().resolves();
      Orm.initialized = true;
      Orm.instance.sqlDb = { persist: persistStub };

      const record1 = createRecord('animal', { type: 'dog', age: 3, size: 'large' }, { serialize: false });
      const record2 = createRecord('animal', { type: 'cat', age: 2, size: 'small' }, { serialize: false });

      assert.notStrictEqual(record1.id, record2.id, 'each record gets a unique pending ID');
      assert.ok(record1.id < 0 && record2.id < 0, 'both IDs are negative');
      assert.ok(store.get('animal').has(record1.id), 'first record in store under its own key');
      assert.ok(store.get('animal').has(record2.id), 'second record in store under its own key');
    });

    test('persist context includes rawData with __pendingSqlId flag', function(assert) {
      const persistStub = sinon.stub().resolves();
      Orm.initialized = true;
      Orm.instance.sqlDb = { persist: persistStub };

      createRecord('animal', { type: 'dog', age: 3, size: 'large' }, { serialize: false });

      assert.ok(persistStub.calledOnce, 'sqlDb.persist was called');
      const context = persistStub.firstCall.args[2];
      assert.strictEqual(context.rawData.__pendingSqlId, true, 'rawData.__pendingSqlId is true');
      assert.ok(context.rawData.id < 0, 'rawData.id is the negative pending integer');
    });

    test('string-ID models do NOT get pending IDs', function(assert) {
      const persistStub = sinon.stub().resolves();
      Orm.initialized = true;
      Orm.instance.sqlDb = { persist: persistStub };

      // owner has id = attr('string'), so it should NOT get a pending ID
      // Without an explicit id, it falls through to store-based increment
      const record = createRecord('owner', { gender: 'female' }, { serialize: false });

      assert.ok(record.id > 0, 'string-ID model gets a positive store-based ID');
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

    test('persist error message includes actual error content', function(assert) {
      const done = assert.async();
      const error = new Error('column "match_id" violates not-null constraint');
      const persistStub = sinon.stub().rejects(error);
      Orm.initialized = true;
      Orm.instance.sqlDb = { persist: persistStub };

      const originalLogError = log.error;
      const logStub = sinon.stub();
      log.error = logStub;

      createRecord('owner', { id: 'err-msg-1', gender: 'female' }, { serialize: false });

      setTimeout(() => {
        assert.ok(logStub.calledOnce, 'log.error was called');
        const logMessage = logStub.firstCall?.args[0] || '';
        assert.ok(logMessage.includes('column "match_id" violates not-null constraint'), 'log message includes the actual SQL error');
        assert.ok(logMessage.includes('owner:err-msg-1'), 'log message includes model and record id');
        log.error = originalLogError;
        done();
      }, 50);
    });
  });
});
