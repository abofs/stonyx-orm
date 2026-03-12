import QUnit from 'qunit';
import sinon from 'sinon';
import Orm, { store } from '@stonyx/orm';
import { setupIntegrationTests } from 'stonyx/test-helpers';

const { module, test } = QUnit;

module('[Unit] View discovery', function(hooks) {
  setupIntegrationTests(hooks);

  test('views are discovered from paths.view directory', function(assert) {
    assert.ok(Orm.instance.views.OwnerAnimalCountView, 'view class is loaded');
  });

  test('view is registered in store as a Map', function(assert) {
    const viewStore = store.get('owner-animal-count');
    assert.ok(viewStore instanceof Map, 'store entry exists as Map');
  });

  test('getRecordClasses resolves view class', function(assert) {
    const { modelClass } = Orm.instance.getRecordClasses('owner-animal-count');
    assert.ok(modelClass, 'view class resolved');
    assert.strictEqual(modelClass.name, 'OwnerAnimalCountView', 'correct class returned');
  });

  test('getRecordClasses still resolves model class (no regression)', function(assert) {
    const { modelClass } = Orm.instance.getRecordClasses('owner');
    assert.ok(modelClass, 'model class resolved');
    assert.strictEqual(modelClass.name, 'OwnerModel', 'correct model class returned');
  });

  test('isView returns true for views', function(assert) {
    assert.ok(Orm.instance.isView('owner-animal-count'), 'view detected');
  });

  test('isView returns false for models', function(assert) {
    assert.notOk(Orm.instance.isView('owner'), 'model not detected as view');
  });

  test('isView returns false for nonexistent names', function(assert) {
    assert.notOk(Orm.instance.isView('nonexistent'), 'nonexistent not detected as view');
  });

  test('store.findAll uses view resolver in non-MySQL mode', async function(assert) {
    const { createRecord } = await import('@stonyx/orm');

    // Use serialize:false to bypass the OwnerSerializer map (which maps id→name, gender→sex)
    const owner = createRecord('owner', { id: 'view-test-1', gender: 'female', age: 30 }, { serialize: false });
    assert.strictEqual(owner.id, 'view-test-1', 'owner created with correct id');

    // Create animals linked to this owner
    createRecord('animal', { id: 100, type: 0, age: 3, size: 'small', owner: 'view-test-1' }, { serialize: false });
    createRecord('animal', { id: 101, type: 1, age: 5, size: 'large', owner: 'view-test-1' }, { serialize: false });

    const results = await store.findAll('owner-animal-count');
    const viewRecord = results.find(r => r.id === 'view-test-1');

    assert.ok(viewRecord, 'view resolver returns record for our owner');
    assert.strictEqual(viewRecord.__data.animalCount, 2, 'aggregate computed correctly');
  });

  test('store.find uses view resolver for single record', async function(assert) {
    const result = await store.find('owner-animal-count', 'view-test-1');
    assert.ok(result, 'store.find returns single record for view');
    assert.strictEqual(result.id, 'view-test-1', 'correct id');
  });
});
