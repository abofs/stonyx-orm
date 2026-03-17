import QUnit from 'qunit';
import sinon from 'sinon';
import Orm, { createRecord, updateRecord, store, Serializer } from '@stonyx/orm';
import View from '../../src/view.js';

const { module, test } = QUnit;

module('[Unit] View read-only enforcement', function(hooks) {
  let originalInstance;
  let originalInitialized;

  hooks.beforeEach(function() {
    originalInstance = Orm.instance;
    originalInitialized = Orm.initialized;

    // Set up a minimal Orm instance with a view registered
    Orm.initialized = true;

    const fakeInstance = {
      getRecordClasses(modelName) {
        if (modelName === 'owner-stats') {
          return { modelClass: OwnerStatsView, serializerClass: Serializer };
        }
        return { modelClass: null, serializerClass: Serializer };
      },
      views: { OwnerStatsView },
      models: {},
      transforms: {
        number: (v) => parseInt(v),
        passthrough: (v) => v,
        string: (v) => String(v),
      },
      isView(modelName) {
        return modelName === 'owner-stats';
      }
    };

    Orm.instance = fakeInstance;

    store.set('owner-stats', new Map());
  });

  hooks.afterEach(function() {
    Orm.instance = originalInstance;
    Orm.initialized = originalInitialized;
    store.data.delete('owner-stats');
    sinon.restore();
  });

  test('createRecord throws for views without isDbRecord', function(assert) {
    assert.throws(
      () => createRecord('owner-stats', { id: 1 }),
      /Cannot create records for read-only view 'owner-stats'/,
      'throws descriptive error'
    );
  });

  test('createRecord succeeds for views with isDbRecord: true', function(assert) {
    const record = createRecord('owner-stats', { id: 1 }, { isDbRecord: true });
    assert.ok(record, 'record is created');
    assert.strictEqual(record.id, 1, 'record has correct id');
  });

  test('updateRecord throws for view records', function(assert) {
    const record = createRecord('owner-stats', { id: 1 }, { isDbRecord: true });

    assert.throws(
      () => updateRecord(record, { id: 1 }),
      /Cannot update records for read-only view 'owner-stats'/,
      'throws descriptive error'
    );
  });

  test('store.remove throws for views', function(assert) {
    const record = createRecord('owner-stats', { id: 1 }, { isDbRecord: true });

    assert.throws(
      () => store.remove('owner-stats', 1),
      /Cannot remove records from read-only view 'owner-stats'/,
      'throws descriptive error'
    );
  });
});

class OwnerStatsView extends View {
  static source = 'owner';
}
