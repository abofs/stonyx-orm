// @ts-nocheck
import QUnit from 'qunit';
import sinon from 'sinon';
import Orm, { createRecord, store } from '@stonyx/orm';
import OrmRequest from '../../src/orm-request.js';

const { module, test } = QUnit;

module('[Unit] PATCH persist — context.record availability (#160)', function(hooks) {
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

  test('context.record is defined when sqlDb.persist is called for update', async function(assert) {
    let capturedContext = null;
    const persistStub = sinon.stub().callsFake((_op, _model, context) => {
      // Capture the context at the exact moment persist is called
      capturedContext = { record: context.record, oldState: context.oldState };
      return Promise.resolve();
    });

    Orm.initialized = true;
    Orm.instance.sqlDb = { persist: persistStub };

    // Pre-populate a record in the store
    createRecord('owner', { id: 'patch-1', gender: 'female', age: 25 }, { serialize: false, _skipAutoPersist: true });

    const ormRequest = new OrmRequest({ model: 'owner', access: () => true });
    const patchHandler = ormRequest.handlers.patch['/:id'];

    // Simulate a PATCH request
    const request = {
      protocol: 'http',
      method: 'PATCH',
      params: { id: 'patch-1' },
      body: { data: { type: 'owners', id: 'patch-1', attributes: { gender: 'male' } } },
      query: {},
      get: () => 'localhost',
    };

    await patchHandler(request, {});

    assert.ok(persistStub.calledOnce, 'sqlDb.persist was called');
    assert.strictEqual(persistStub.firstCall.args[0], 'update', 'persist called with update operation');
    assert.ok(capturedContext.record, 'context.record is defined at persist time');
    assert.strictEqual(capturedContext.record.id, 'patch-1', 'context.record has the correct id');
    assert.strictEqual(capturedContext.record.gender, 'male', 'context.record reflects the updated value');
  });

  test('context.oldState is captured before the update', async function(assert) {
    let capturedOldState = null;
    const persistStub = sinon.stub().callsFake((_op, _model, context) => {
      capturedOldState = context.oldState;
      return Promise.resolve();
    });

    Orm.initialized = true;
    Orm.instance.sqlDb = { persist: persistStub };

    createRecord('owner', { id: 'patch-2', gender: 'female', age: 30 }, { serialize: false, _skipAutoPersist: true });

    const ormRequest = new OrmRequest({ model: 'owner', access: () => true });
    const patchHandler = ormRequest.handlers.patch['/:id'];

    const request = {
      protocol: 'http',
      method: 'PATCH',
      params: { id: 'patch-2' },
      body: { data: { type: 'owners', id: 'patch-2', attributes: { age: 35 } } },
      query: {},
      get: () => 'localhost',
    };

    await patchHandler(request, {});

    assert.ok(capturedOldState, 'oldState was captured');
    assert.strictEqual(capturedOldState.gender, 'female', 'oldState has original gender');
    assert.strictEqual(capturedOldState.age, 30, 'oldState has original age');
  });

  test('create operation still persists correctly (no regression)', async function(assert) {
    let capturedOp = null;
    const persistStub = sinon.stub().callsFake((op) => {
      capturedOp = op;
      return Promise.resolve();
    });

    Orm.initialized = true;
    Orm.instance.sqlDb = { persist: persistStub };

    const ormRequest = new OrmRequest({ model: 'owner', access: () => true });
    const postHandler = ormRequest.handlers.post['/'];

    const request = {
      protocol: 'http',
      method: 'POST',
      params: {},
      body: { data: { type: 'owners', attributes: { id: 'create-1', gender: 'male', age: 40 } } },
      query: {},
      get: () => 'localhost',
    };

    await postHandler(request, {});

    assert.ok(persistStub.calledOnce, 'sqlDb.persist was called for create');
    assert.strictEqual(capturedOp, 'create', 'persist called with create operation');
  });
});
