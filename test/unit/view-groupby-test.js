import QUnit from 'qunit';
import sinon from 'sinon';
import Orm, { store, Serializer } from '@stonyx/orm';
import View from '../../src/view.js';
import ViewResolver from '../../src/view-resolver.js';
import { count, avg, sum, min, max } from '../../src/aggregates.js';
import { attr } from '@stonyx/orm';

const { module, test } = QUnit;

class AnimalCountBySizeView extends View {
  static source = 'animal';
  static groupBy = 'size';

  id = attr('string');
  animalCount = count();
  averageAge = avg('age');
}

class SumMinMaxView extends View {
  static source = 'animal';
  static groupBy = 'size';

  id = attr('string');
  totalAge = sum('age');
  youngestAge = min('age');
  oldestAge = max('age');
}

class GroupByResolveView extends View {
  static source = 'animal';
  static groupBy = 'size';

  static resolve = {
    label: 'size',
    totalAge: (groupRecords) => {
      return groupRecords.reduce((sum, r) => sum + (r.__data?.age || 0), 0);
    },
  };

  id = attr('string');
  label = attr('string');
  totalAge = attr('number');
}

class GroupByRelAggView extends View {
  static source = 'animal';
  static groupBy = 'size';

  id = attr('string');
  traitCount = count('traits');
}

module('[Unit] ViewResolver — groupBy', function(hooks) {
  let originalInstance;
  let originalInitialized;

  hooks.beforeEach(function() {
    originalInstance = Orm.instance;
    originalInitialized = Orm.initialized;
    Orm.initialized = true;

    const viewClasses = {
      'animal-count-by-size': AnimalCountBySizeView,
      'sum-min-max-view': SumMinMaxView,
      'group-by-resolve-view': GroupByResolveView,
      'group-by-rel-agg-view': GroupByRelAggView,
    };

    Orm.instance = {
      getRecordClasses(modelName) {
        if (viewClasses[modelName]) {
          return { modelClass: viewClasses[modelName], serializerClass: Serializer };
        }
        return { modelClass: null, serializerClass: Serializer };
      },
      views: {
        AnimalCountBySizeView,
        SumMinMaxView,
        GroupByResolveView,
        GroupByRelAggView,
      },
      models: {},
      transforms: {
        number: (v) => parseInt(v),
        float: (v) => parseFloat(v),
        passthrough: (v) => v,
        string: (v) => String(v),
      },
      isView(modelName) {
        return !!viewClasses[modelName];
      }
    };

    for (const name of Object.keys(viewClasses)) {
      store.set(name, new Map());
    }
    store.set('animal', new Map());
  });

  hooks.afterEach(function() {
    Orm.instance = originalInstance;
    Orm.initialized = originalInitialized;
    store.data.delete('animal-count-by-size');
    store.data.delete('sum-min-max-view');
    store.data.delete('group-by-resolve-view');
    store.data.delete('group-by-rel-agg-view');
    store.data.delete('animal');
    sinon.restore();
  });

  function addAnimal(id, size, age, traits) {
    const animalStore = store.get('animal');
    const record = {
      id,
      __data: { id, size, age },
      __relationships: {},
    };
    if (traits) {
      record.__relationships.traits = traits;
    }
    animalStore.set(id, record);
  }

  test('groups source records by field value', async function(assert) {
    addAnimal(1, 'small', 2);
    addAnimal(2, 'small', 4);
    addAnimal(3, 'large', 8);

    const resolver = new ViewResolver('animal-count-by-size');
    const results = await resolver.resolveAll();

    assert.strictEqual(results.length, 2, 'one view record per unique size');
    const ids = results.map(r => r.id).sort();
    assert.deepEqual(ids, ['large', 'small'], 'group keys become record ids');
  });

  test('count() returns number of records in each group', async function(assert) {
    addAnimal(1, 'small', 2);
    addAnimal(2, 'small', 4);
    addAnimal(3, 'large', 8);

    const resolver = new ViewResolver('animal-count-by-size');
    const results = await resolver.resolveAll();

    const small = results.find(r => r.id === 'small');
    const large = results.find(r => r.id === 'large');

    assert.strictEqual(small.__data.animalCount, 2, 'small group has 2 animals');
    assert.strictEqual(large.__data.animalCount, 1, 'large group has 1 animal');
  });

  test('avg() averages field values within each group', async function(assert) {
    addAnimal(1, 'small', 2);
    addAnimal(2, 'small', 4);
    addAnimal(3, 'large', 8);

    const resolver = new ViewResolver('animal-count-by-size');
    const results = await resolver.resolveAll();

    const small = results.find(r => r.id === 'small');
    const large = results.find(r => r.id === 'large');

    assert.strictEqual(small.__data.averageAge, 3, 'small avg age is 3');
    assert.strictEqual(large.__data.averageAge, 8, 'large avg age is 8');
  });

  test('sum() sums field values within each group', async function(assert) {
    addAnimal(1, 'small', 2);
    addAnimal(2, 'small', 4);
    addAnimal(3, 'large', 8);

    const resolver = new ViewResolver('sum-min-max-view');
    const results = await resolver.resolveAll();

    const small = results.find(r => r.id === 'small');
    const large = results.find(r => r.id === 'large');

    assert.strictEqual(small.__data.totalAge, 6, 'small sum age is 6');
    assert.strictEqual(large.__data.totalAge, 8, 'large sum age is 8');
  });

  test('min() returns minimum within each group', async function(assert) {
    addAnimal(1, 'small', 2);
    addAnimal(2, 'small', 4);
    addAnimal(3, 'large', 8);

    const resolver = new ViewResolver('sum-min-max-view');
    const results = await resolver.resolveAll();

    const small = results.find(r => r.id === 'small');
    const large = results.find(r => r.id === 'large');

    assert.strictEqual(small.__data.youngestAge, 2, 'small min age is 2');
    assert.strictEqual(large.__data.youngestAge, 8, 'large min age is 8');
  });

  test('max() returns maximum within each group', async function(assert) {
    addAnimal(1, 'small', 2);
    addAnimal(2, 'small', 4);
    addAnimal(3, 'large', 8);

    const resolver = new ViewResolver('sum-min-max-view');
    const results = await resolver.resolveAll();

    const small = results.find(r => r.id === 'small');
    const large = results.find(r => r.id === 'large');

    assert.strictEqual(small.__data.oldestAge, 4, 'small max age is 4');
    assert.strictEqual(large.__data.oldestAge, 8, 'large max age is 8');
  });

  test('group key becomes view record ID', async function(assert) {
    addAnimal(1, 'medium', 5);

    const resolver = new ViewResolver('animal-count-by-size');
    const results = await resolver.resolveAll();

    assert.strictEqual(results.length, 1);
    assert.strictEqual(results[0].id, 'medium', 'id is the group key value');
  });

  test('resolve map functions receive array of group records', async function(assert) {
    addAnimal(1, 'small', 2);
    addAnimal(2, 'small', 4);

    const resolver = new ViewResolver('group-by-resolve-view');
    const results = await resolver.resolveAll();

    const small = results.find(r => r.id === 'small');
    assert.strictEqual(small.__data.totalAge, 6, 'resolve function received group array and summed ages');
  });

  test('resolve map string paths take value from first record in group', async function(assert) {
    addAnimal(1, 'small', 2);
    addAnimal(2, 'small', 4);

    const resolver = new ViewResolver('group-by-resolve-view');
    const results = await resolver.resolveAll();

    const small = results.find(r => r.id === 'small');
    assert.strictEqual(small.__data.label, 'small', 'string path resolved from first record');
  });

  test('empty source returns empty results', async function(assert) {
    const resolver = new ViewResolver('animal-count-by-size');
    const results = await resolver.resolveAll();

    assert.deepEqual(results, [], 'returns empty array');
  });

  test('source records with undefined groupBy field are grouped together', async function(assert) {
    const animalStore = store.get('animal');
    animalStore.set(1, {
      id: 1,
      __data: { id: 1, age: 5 },
      __relationships: {},
    });
    animalStore.set(2, {
      id: 2,
      __data: { id: 2, age: 3 },
      __relationships: {},
    });

    const resolver = new ViewResolver('animal-count-by-size');
    const results = await resolver.resolveAll();

    assert.strictEqual(results.length, 1, 'records with undefined size grouped together');
    assert.strictEqual(results[0].__data.animalCount, 2, 'count is correct');
  });

  test('multiple groups produce multiple view records', async function(assert) {
    addAnimal(1, 'small', 1);
    addAnimal(2, 'medium', 2);
    addAnimal(3, 'large', 3);
    addAnimal(4, 'small', 4);
    addAnimal(5, 'medium', 5);

    const resolver = new ViewResolver('animal-count-by-size');
    const results = await resolver.resolveAll();

    assert.strictEqual(results.length, 3, 'three distinct groups');
    const small = results.find(r => r.id === 'small');
    const medium = results.find(r => r.id === 'medium');
    const large = results.find(r => r.id === 'large');

    assert.strictEqual(small.__data.animalCount, 2);
    assert.strictEqual(medium.__data.animalCount, 2);
    assert.strictEqual(large.__data.animalCount, 1);
  });

  test('relationship aggregates still work in groupBy views', async function(assert) {
    addAnimal(1, 'small', 2, [{ id: 10, __data: {} }, { id: 11, __data: {} }]);
    addAnimal(2, 'small', 4, [{ id: 12, __data: {} }]);
    addAnimal(3, 'large', 8, [{ id: 13, __data: {} }]);

    const resolver = new ViewResolver('group-by-rel-agg-view');
    const results = await resolver.resolveAll();

    const small = results.find(r => r.id === 'small');
    const large = results.find(r => r.id === 'large');

    assert.strictEqual(small.__data.traitCount, 3, 'flattened traits across small group');
    assert.strictEqual(large.__data.traitCount, 1, 'large group traits');
  });

  test('resolveOne returns the correct group', async function(assert) {
    addAnimal(1, 'small', 2);
    addAnimal(2, 'large', 8);

    const resolver = new ViewResolver('animal-count-by-size');
    const result = await resolver.resolveOne('small');

    assert.ok(result, 'found record');
    assert.strictEqual(result.id, 'small', 'correct group returned');
    assert.strictEqual(result.__data.animalCount, 1, 'correct count');
  });
});
