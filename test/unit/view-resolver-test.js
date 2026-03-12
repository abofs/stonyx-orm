import QUnit from 'qunit';
import sinon from 'sinon';
import Orm, { store, Serializer } from '@stonyx/orm';
import View from '../../src/view.js';
import ViewResolver from '../../src/view-resolver.js';
import { count, avg, sum, min, max } from '../../src/aggregates.js';
import { attr, belongsTo } from '@stonyx/orm';

const { module, test } = QUnit;

class OwnerStatsView extends View {
  static source = 'owner';

  animalCount = count('pets');
  averageAge = avg('pets', 'age');
  owner = belongsTo('owner');
}

class ResolveMapView extends View {
  static source = 'owner';

  static resolve = {
    gender: 'gender',
    score: (record) => (record.__data?.age || 0) * 10,
    nestedVal: 'details.nested',
  };

  animalCount = count('pets');
  gender = attr('string');
  score = attr('number');
  nestedVal = attr('passthrough');
}

module('[Unit] ViewResolver', function(hooks) {
  let originalInstance;
  let originalInitialized;

  hooks.beforeEach(function() {
    originalInstance = Orm.instance;
    originalInitialized = Orm.initialized;
    Orm.initialized = true;

    const fakeInstance = {
      getRecordClasses(modelName) {
        if (modelName === 'owner-stats') {
          return { modelClass: OwnerStatsView, serializerClass: Serializer };
        }
        if (modelName === 'resolve-map-view') {
          return { modelClass: ResolveMapView, serializerClass: Serializer };
        }
        return { modelClass: null, serializerClass: Serializer };
      },
      views: { OwnerStatsView, ResolveMapView },
      models: {},
      transforms: {
        number: (v) => parseInt(v),
        float: (v) => parseFloat(v),
        passthrough: (v) => v,
        string: (v) => String(v),
      },
      isView(modelName) {
        return modelName === 'owner-stats' || modelName === 'resolve-map-view';
      }
    };

    Orm.instance = fakeInstance;

    // Set up stores
    store.set('owner-stats', new Map());
    store.set('resolve-map-view', new Map());
    store.set('owner', new Map());
  });

  hooks.afterEach(function() {
    Orm.instance = originalInstance;
    Orm.initialized = originalInitialized;
    store.data.delete('owner-stats');
    store.data.delete('resolve-map-view');
    store.data.delete('owner');
    sinon.restore();
  });

  test('resolves aggregate fields from source records relationships', async function(assert) {
    // Set up source owner records with pets relationships
    const ownerStore = store.get('owner');
    ownerStore.set(1, {
      id: 1,
      __data: { id: 1, gender: 'male', age: 30 },
      __relationships: {
        pets: [
          { id: 1, __data: { age: 3 } },
          { id: 2, __data: { age: 5 } },
        ]
      }
    });
    ownerStore.set(2, {
      id: 2,
      __data: { id: 2, gender: 'female', age: 25 },
      __relationships: {
        pets: [
          { id: 3, __data: { age: 7 } },
        ]
      }
    });

    const resolver = new ViewResolver('owner-stats');
    const results = await resolver.resolveAll();

    assert.strictEqual(results.length, 2, 'creates one view record per source record');
    assert.strictEqual(results[0].id, 1, 'first record id matches source');
    assert.strictEqual(results[0].__data.animalCount, 2, 'count aggregate computed');
    assert.strictEqual(results[0].__data.averageAge, 4, 'avg aggregate computed');
    assert.strictEqual(results[1].__data.animalCount, 1, 'second record count');
    assert.strictEqual(results[1].__data.averageAge, 7, 'second record avg');
  });

  test('handles empty source model', async function(assert) {
    const resolver = new ViewResolver('owner-stats');
    const results = await resolver.resolveAll();

    assert.deepEqual(results, [], 'returns empty array');
  });

  test('handles source records with no relationships', async function(assert) {
    const ownerStore = store.get('owner');
    ownerStore.set(1, {
      id: 1,
      __data: { id: 1 },
      __relationships: {}
    });

    const resolver = new ViewResolver('owner-stats');
    const results = await resolver.resolveAll();

    assert.strictEqual(results.length, 1);
    assert.strictEqual(results[0].__data.animalCount, 0, 'count of empty relationship is 0');
    assert.strictEqual(results[0].__data.averageAge, 0, 'avg of empty relationship is 0');
  });

  test('resolves string path entries from resolve map', async function(assert) {
    const ownerStore = store.get('owner');
    ownerStore.set(1, {
      id: 1,
      __data: { id: 1, gender: 'male', age: 30 },
      __relationships: { pets: [] }
    });

    const resolver = new ViewResolver('resolve-map-view');
    const results = await resolver.resolveAll();

    assert.strictEqual(results[0].__data.gender, 'male', 'string path resolve works');
  });

  test('resolves function entries from resolve map', async function(assert) {
    const ownerStore = store.get('owner');
    ownerStore.set(1, {
      id: 1,
      __data: { id: 1, gender: 'male', age: 30 },
      __relationships: { pets: [] }
    });

    const resolver = new ViewResolver('resolve-map-view');
    const results = await resolver.resolveAll();

    assert.strictEqual(results[0].__data.score, 300, 'function resolve computes from source record');
  });

  test('aggregate fields and resolve entries coexist on the same view', async function(assert) {
    const ownerStore = store.get('owner');
    ownerStore.set(1, {
      id: 1,
      __data: { id: 1, gender: 'male', age: 30 },
      __relationships: {
        pets: [{ id: 1, __data: { age: 5 } }]
      }
    });

    const resolver = new ViewResolver('resolve-map-view');
    const results = await resolver.resolveAll();

    assert.strictEqual(results[0].__data.animalCount, 1, 'aggregate field works');
    assert.strictEqual(results[0].__data.gender, 'male', 'resolve string path works');
    assert.strictEqual(results[0].__data.score, 300, 'resolve function works');
  });

  test('handles nested string paths in resolve map', async function(assert) {
    const ownerStore = store.get('owner');
    ownerStore.set(1, {
      id: 1,
      __data: { id: 1, gender: 'male', age: 30, details: { nested: 'deep-value' } },
      __relationships: { pets: [] }
    });

    const resolver = new ViewResolver('resolve-map-view');
    const results = await resolver.resolveAll();

    assert.strictEqual(results[0].__data.nestedVal, 'deep-value', 'nested path resolved');
  });

  test('each resolved record gets id from source record', async function(assert) {
    const ownerStore = store.get('owner');
    ownerStore.set(42, {
      id: 42,
      __data: { id: 42 },
      __relationships: { pets: [] }
    });

    const resolver = new ViewResolver('owner-stats');
    const results = await resolver.resolveAll();

    assert.strictEqual(results[0].id, 42, 'view record id matches source record id');
  });

  test('resolveOne returns single record by id', async function(assert) {
    const ownerStore = store.get('owner');
    ownerStore.set(1, { id: 1, __data: { id: 1 }, __relationships: { pets: [] } });
    ownerStore.set(2, { id: 2, __data: { id: 2 }, __relationships: { pets: [] } });

    const resolver = new ViewResolver('owner-stats');
    const result = await resolver.resolveOne(2);

    assert.ok(result, 'found record');
    assert.strictEqual(result.id, 2, 'correct record returned');
  });

  test('resolveOne returns undefined for nonexistent id', async function(assert) {
    const ownerStore = store.get('owner');
    ownerStore.set(1, { id: 1, __data: { id: 1 }, __relationships: { pets: [] } });

    const resolver = new ViewResolver('owner-stats');
    const result = await resolver.resolveOne(999);

    assert.strictEqual(result, undefined, 'returns undefined');
  });

  test('resolve function receives full source record', async function(assert) {
    let receivedRecord = null;

    class InspectView extends View {
      static source = 'owner';
      static resolve = {
        inspected: (record) => {
          receivedRecord = record;
          return 'ok';
        },
      };
    }

    Orm.instance.getRecordClasses = (name) => {
      if (name === 'inspect-view') return { modelClass: InspectView, serializerClass: Serializer };
      return { modelClass: null, serializerClass: Serializer };
    };
    Orm.instance.isView = (name) => name === 'inspect-view';
    store.set('inspect-view', new Map());

    const ownerStore = store.get('owner');
    const sourceRecord = {
      id: 1,
      __data: { id: 1, gender: 'male' },
      __relationships: { pets: [{ id: 10, __data: { age: 2 } }] }
    };
    ownerStore.set(1, sourceRecord);

    const resolver = new ViewResolver('inspect-view');
    await resolver.resolveAll();

    assert.strictEqual(receivedRecord, sourceRecord, 'resolve function receives the full source record');

    store.data.delete('inspect-view');
  });
});
