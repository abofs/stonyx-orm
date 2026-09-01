// @ts-nocheck
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
      // Without an explicit id, it falls through to store-based assignment
      const rawData = { gender: 'female' };
      const record = createRecord('owner', rawData, { serialize: false });

      // WAS `assert.ok(record.id > 0)`. That expressed the intent only by
      // accident: it is true of a NUMERIC-LOOKING id and false of every other
      // string, so it was really pinning the SHAPE of the assigned value rather
      // than the absence of a pending negative. abofs/stonyx-orm#203 changed
      // that shape deliberately -- a server-assigned string id must not be
      // numeric-looking, because `coerceId` resolves such an id to a NUMBER on
      // every record-level route while the model files it under the STRING key,
      // so `GET /owners/1` answers 404 for a record that was just created
      // (measured). The two assertions below state what this test is named for.
      assert.notOk(rawData.__pendingSqlId, 'string-ID model is not flagged __pendingSqlId');
      assert.notOk(typeof record.id === 'number' && record.id < 0, 'and it did not get a negative pending ID');
    });
  });

  module('error handling — onPersistError callback', function(hooks) {
    let originalLogError;

    hooks.beforeEach(function() {
      originalLogError = log.error;
    });

    hooks.afterEach(function() {
      // Reset the persist error handler after each test
      if (Orm.instance) {
        Orm.instance.onPersistError(null);
      }
      // Restore log.error in case a test stubbed it
      log.error = originalLogError;
    });

    test('createRecord with SQL persist failure invokes registered onPersistError callback', function(assert) {
      const done = assert.async();
      const error = new Error('SQL connection failed');
      const persistStub = sinon.stub().rejects(error);
      Orm.initialized = true;
      Orm.instance.sqlDb = { persist: persistStub };

      const handlerStub = sinon.stub();
      Orm.instance.onPersistError(handlerStub);

      const record = createRecord('owner', { id: 'err-cb-1', gender: 'female' }, { serialize: false });

      assert.strictEqual(record.id, 'err-cb-1', 'record created despite persist failure');

      setTimeout(() => {
        assert.ok(handlerStub.calledOnce, 'onPersistError handler was called');
        const detail = handlerStub.firstCall.args[0];
        assert.strictEqual(detail.operation, 'create', 'detail.operation is create');
        assert.strictEqual(detail.modelName, 'owner', 'detail.modelName is owner');
        assert.strictEqual(detail.recordId, 'err-cb-1', 'detail.recordId is err-cb-1');
        assert.ok(detail.error instanceof Error, 'detail.error is an Error');
        assert.strictEqual(detail.error.message, 'SQL connection failed', 'detail.error has correct message');
        done();
      }, 50);
    });

    test('updateRecord with SQL persist failure invokes registered onPersistError callback', function(assert) {
      const done = assert.async();
      const error = new Error('update constraint violation');
      const persistStub = sinon.stub().rejects(error);

      Orm.initialized = true;
      Orm.instance.sqlDb = { persist: persistStub };

      const record = createRecord('owner', { id: 'err-cb-2', gender: 'female' }, { serialize: false, _skipAutoPersist: true });

      const handlerStub = sinon.stub();
      Orm.instance.onPersistError(handlerStub);

      updateRecord(record, { gender: 'male' });

      setTimeout(() => {
        assert.ok(handlerStub.calledOnce, 'onPersistError handler was called');
        const detail = handlerStub.firstCall.args[0];
        assert.strictEqual(detail.operation, 'update', 'detail.operation is update');
        assert.strictEqual(detail.modelName, 'owner', 'detail.modelName is owner');
        assert.strictEqual(detail.recordId, 'err-cb-2', 'detail.recordId is err-cb-2');
        assert.ok(detail.error instanceof Error, 'detail.error is an Error');
        assert.strictEqual(detail.error.message, 'update constraint violation', 'detail.error has correct message');
        done();
      }, 50);
    });

    test('store.remove with SQL persist failure invokes registered onPersistError callback', function(assert) {
      const done = assert.async();
      const error = new Error('delete FK constraint');
      const persistStub = sinon.stub().rejects(error);

      Orm.initialized = true;
      Orm.instance.sqlDb = { persist: persistStub };

      createRecord('owner', { id: 'err-cb-3', gender: 'male' }, { serialize: false, _skipAutoPersist: true });

      const handlerStub = sinon.stub();
      Orm.instance.onPersistError(handlerStub);

      store.remove('owner', 'err-cb-3');

      setTimeout(() => {
        assert.ok(handlerStub.calledOnce, 'onPersistError handler was called');
        const detail = handlerStub.firstCall.args[0];
        assert.strictEqual(detail.operation, 'delete', 'detail.operation is delete');
        assert.strictEqual(detail.modelName, 'owner', 'detail.modelName is owner');
        assert.strictEqual(detail.recordId, 'err-cb-3', 'detail.recordId is err-cb-3');
        assert.ok(detail.error instanceof Error, 'detail.error is an Error');
        assert.strictEqual(detail.error.message, 'delete FK constraint', 'detail.error has correct message');
        done();
      }, 50);
    });

    test('when no onPersistError handler is registered, persist errors fall back to log.error', function(assert) {
      const done = assert.async();
      const error = new Error('column "match_id" violates not-null constraint');
      const persistStub = sinon.stub().rejects(error);
      Orm.initialized = true;
      Orm.instance.sqlDb = { persist: persistStub };

      const logStub = sinon.stub();
      log.error = logStub;

      createRecord('owner', { id: 'err-fallback-1', gender: 'female' }, { serialize: false });

      setTimeout(() => {
        assert.ok(logStub.calledOnce, 'log.error was called as fallback');
        const logMessage = logStub.firstCall?.args[0] || '';
        assert.ok(logMessage.includes('column "match_id" violates not-null constraint'), 'log message includes the actual SQL error');
        assert.ok(logMessage.includes('owner:err-fallback-1'), 'log message includes model and record id');
        done();
      }, 50);
    });

    test('createRecord still returns the record synchronously regardless of persist outcome', function(assert) {
      const error = new Error('SQL failure');
      const persistStub = sinon.stub().rejects(error);
      Orm.initialized = true;
      Orm.instance.sqlDb = { persist: persistStub };

      const handlerStub = sinon.stub();
      Orm.instance.onPersistError(handlerStub);

      const record = createRecord('owner', { id: 'sync-1', gender: 'female' }, { serialize: false });

      // Verify synchronous return — record is available immediately, not a Promise
      assert.strictEqual(record.id, 'sync-1', 'record returned synchronously with correct id');
      assert.notOk(record instanceof Promise, 'return value is NOT a Promise');
      assert.ok(store.get('owner').has('sync-1'), 'record is in the store immediately');
    });

    test('updateRecord still returns void synchronously regardless of persist outcome', function(assert) {
      const error = new Error('SQL failure');
      const persistStub = sinon.stub().rejects(error);
      Orm.initialized = true;
      Orm.instance.sqlDb = { persist: persistStub };

      const record = createRecord('owner', { id: 'sync-2', gender: 'female' }, { serialize: false, _skipAutoPersist: true });

      const handlerStub = sinon.stub();
      Orm.instance.onPersistError(handlerStub);

      const result = updateRecord(record, { gender: 'male' });

      // Verify synchronous return — void, not a Promise
      assert.strictEqual(result, undefined, 'updateRecord returns void (undefined)');
    });

    test('_skipAutoPersist callers are unaffected — no persist attempt, no callback invocation', function(assert) {
      const done = assert.async();
      const persistStub = sinon.stub().rejects(new Error('should not be called'));
      Orm.initialized = true;
      Orm.instance.sqlDb = { persist: persistStub };

      const handlerStub = sinon.stub();
      Orm.instance.onPersistError(handlerStub);

      createRecord('owner', { id: 'skip-err-1', gender: 'female' }, { serialize: false, _skipAutoPersist: true });

      setTimeout(() => {
        assert.ok(persistStub.notCalled, 'sqlDb.persist was NOT called');
        assert.ok(handlerStub.notCalled, 'onPersistError handler was NOT called');
        done();
      }, 50);
    });

    test('isDbRecord callers are unaffected — no persist attempt, no callback invocation', function(assert) {
      const done = assert.async();
      const persistStub = sinon.stub().rejects(new Error('should not be called'));
      Orm.initialized = true;
      Orm.instance.sqlDb = { persist: persistStub };

      const handlerStub = sinon.stub();
      Orm.instance.onPersistError(handlerStub);

      createRecord('owner', { id: 'db-err-1', gender: 'male' }, { serialize: false, isDbRecord: true });

      setTimeout(() => {
        assert.ok(persistStub.notCalled, 'sqlDb.persist was NOT called');
        assert.ok(handlerStub.notCalled, 'onPersistError handler was NOT called');
        done();
      }, 50);
    });
  });
});
