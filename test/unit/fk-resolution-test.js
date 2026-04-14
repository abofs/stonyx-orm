import QUnit from 'qunit';
import sinon from 'sinon';
import Orm, { createRecord, store } from '@stonyx/orm';

const { module, test } = QUnit;

module('[Unit] FK Resolution | belongsTo raw string FK values', function(hooks) {
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

  test('Orm.create passes rawData through context for FK resolution', async function(assert) {
    const persistStub = sinon.stub().resolves();
    Orm.initialized = true;
    Orm.instance.sqlDb = { persist: persistStub };

    await Orm.create('animal', { id: 'fk-test-1', type: 'dog', age: 3, size: 'large', owner: 'unresolved-owner-id' });

    assert.ok(persistStub.calledOnce, 'sqlDb.persist was called');
    assert.strictEqual(persistStub.firstCall.args[0], 'create', 'persist called with create operation');

    const context = persistStub.firstCall.args[2];
    assert.ok(context.rawData, 'context includes rawData');
    assert.strictEqual(context.rawData.owner, 'unresolved-owner-id', 'rawData preserves the raw FK value');
  });

  test('belongsTo with unresolved target sets __relationships to null', function(assert) {
    // Create animal with FK to owner that does NOT exist in store
    const animal = createRecord('animal', { id: 'fk-test-2', type: 'cat', age: 2, size: 'small', owner: 'nonexistent-owner' }, { serialize: false });

    assert.strictEqual(animal.__relationships.owner, null, '__relationships is null for unresolved belongsTo');
  });

  test('belongsTo with resolved target sets __relationships to record object', function(assert) {
    // Create owner first so it exists in store
    createRecord('owner', { id: 'resolved-owner', gender: 'female', age: 25 }, { serialize: false });

    const animal = createRecord('animal', { id: 'fk-test-3', type: 'dog', age: 5, size: 'large', owner: 'resolved-owner' }, { serialize: false });

    const related = animal.__relationships.owner;
    assert.strictEqual(typeof related, 'object', '__relationships is an object for resolved belongsTo');
    assert.notStrictEqual(related, null, '__relationships is not null');
    assert.strictEqual(related?.id, 'resolved-owner', 'related record has correct id');
  });
});
