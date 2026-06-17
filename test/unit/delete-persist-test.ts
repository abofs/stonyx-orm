// @ts-nocheck
import QUnit from 'qunit';
import sinon from 'sinon';
import Orm, { createRecord, store } from '@stonyx/orm';
import OrmRequest from '../../src/orm-request.js';

const { module, test } = QUnit;

module('[Unit] DELETE persist — awaited in request path (#157)', function(hooks) {
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

  test('sqlDb.persist is awaited for delete before response returns', async function(assert) {
    let persistResolved = false;
    const persistStub = sinon.stub().callsFake(() => {
      return new Promise((resolve) => {
        // Simulate async SQL work — the handler must wait for this
        setTimeout(() => {
          persistResolved = true;
          resolve();
        }, 10);
      });
    });

    Orm.initialized = true;
    Orm.instance.sqlDb = { persist: persistStub };

    // Pre-populate a record in the store
    createRecord('owner', { id: 'del-1', gender: 'male', age: 30 }, { serialize: false, _skipAutoPersist: true });

    const ormRequest = new OrmRequest({ model: 'owner', access: () => true });
    const deleteHandler = ormRequest.handlers.delete['/:id'];

    const request = {
      protocol: 'http',
      method: 'DELETE',
      params: { id: 'del-1' },
      body: undefined,
      query: {},
      get: () => 'localhost',
    };

    const response = await deleteHandler(request, {});

    // Key assertion: persist must have completed BEFORE the handler returned
    assert.true(persistResolved, 'sqlDb.persist resolved before DELETE response returned');
    assert.strictEqual(response, 204, 'handler returns 204');
    assert.ok(persistStub.calledOnce, 'sqlDb.persist was called exactly once (no double-persist)');
    assert.strictEqual(persistStub.firstCall.args[0], 'delete', 'persist called with delete operation');
  });

  test('context.recordId is set when persist is called for delete', async function(assert) {
    let capturedContext = null;
    const persistStub = sinon.stub().callsFake((_op, _model, context) => {
      capturedContext = { recordId: context.recordId, oldState: context.oldState };
      return Promise.resolve();
    });

    Orm.initialized = true;
    Orm.instance.sqlDb = { persist: persistStub };

    createRecord('owner', { id: 'del-2', gender: 'female', age: 25 }, { serialize: false, _skipAutoPersist: true });

    const ormRequest = new OrmRequest({ model: 'owner', access: () => true });
    const deleteHandler = ormRequest.handlers.delete['/:id'];

    const request = {
      protocol: 'http',
      method: 'DELETE',
      params: { id: 'del-2' },
      body: undefined,
      query: {},
      get: () => 'localhost',
    };

    await deleteHandler(request, {});

    assert.ok(capturedContext, 'context was captured');
    assert.strictEqual(capturedContext.recordId, 'del-2', 'context.recordId is set correctly');
    assert.ok(capturedContext.oldState, 'context.oldState is captured before delete');
  });

  test('persist errors propagate (not silently caught) in request path', async function(assert) {
    const persistError = new Error('SQL connection lost');
    const persistStub = sinon.stub().rejects(persistError);

    Orm.initialized = true;
    Orm.instance.sqlDb = { persist: persistStub };

    createRecord('owner', { id: 'del-3', gender: 'male', age: 40 }, { serialize: false, _skipAutoPersist: true });

    const ormRequest = new OrmRequest({ model: 'owner', access: () => true });
    const deleteHandler = ormRequest.handlers.delete['/:id'];

    const request = {
      protocol: 'http',
      method: 'DELETE',
      params: { id: 'del-3' },
      body: undefined,
      query: {},
      get: () => 'localhost',
    };

    try {
      await deleteHandler(request, {});
      assert.ok(false, 'should have thrown');
    } catch (err) {
      assert.strictEqual(err, persistError, 'persist error propagates to caller');
    }
  });

  test('store.remove without _skipAutoPersist still fires auto-persist', function(assert) {
    const persistStub = sinon.stub().resolves();

    Orm.initialized = true;
    Orm.instance.sqlDb = { persist: persistStub };

    createRecord('owner', { id: 'del-4', gender: 'male', age: 50 }, { serialize: false, _skipAutoPersist: true });

    // Call remove without _skipAutoPersist (simulates hook or programmatic usage)
    store.remove('owner', 'del-4');

    assert.ok(persistStub.calledOnce, 'auto-persist fires for non-request-path remove');
    assert.strictEqual(persistStub.firstCall.args[0], 'delete', 'auto-persist uses delete operation');
  });

  test('store.remove with _skipAutoPersist suppresses auto-persist', function(assert) {
    const persistStub = sinon.stub().resolves();

    Orm.initialized = true;
    Orm.instance.sqlDb = { persist: persistStub };

    createRecord('owner', { id: 'del-5', gender: 'female', age: 35 }, { serialize: false, _skipAutoPersist: true });

    // Call remove with _skipAutoPersist (simulates request-path usage)
    store.remove('owner', 'del-5', { _skipAutoPersist: true });

    assert.notOk(persistStub.called, 'auto-persist is suppressed when _skipAutoPersist is set');
  });

  test('no double-persist — delete persists exactly once via request path', async function(assert) {
    const persistStub = sinon.stub().resolves();

    Orm.initialized = true;
    Orm.instance.sqlDb = { persist: persistStub };

    createRecord('owner', { id: 'del-6', gender: 'male', age: 60 }, { serialize: false, _skipAutoPersist: true });

    const ormRequest = new OrmRequest({ model: 'owner', access: () => true });
    const deleteHandler = ormRequest.handlers.delete['/:id'];

    const request = {
      protocol: 'http',
      method: 'DELETE',
      params: { id: 'del-6' },
      body: undefined,
      query: {},
      get: () => 'localhost',
    };

    await deleteHandler(request, {});

    // Must be exactly one persist call — not zero (fire-and-forget removed) and not two (no double-persist)
    assert.strictEqual(persistStub.callCount, 1, 'persist called exactly once');
    assert.strictEqual(persistStub.firstCall.args[0], 'delete', 'the single persist is a delete');
    assert.strictEqual(persistStub.firstCall.args[1], 'owner', 'persist targets the correct model');
  });
});
