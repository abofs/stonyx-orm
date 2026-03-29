import QUnit from 'qunit';
import sinon from 'sinon';
import Store from '../../src/store.js';

const { module, test } = QUnit;

function createStore() {
  Store.instance = null;
  const store = new Store();

  const userStore = new Map();
  userStore.set(1, { id: 1, name: 'Alice', __data: { id: 1, name: 'Alice' } });
  userStore.set(2, { id: 2, name: 'Bob', __data: { id: 2, name: 'Bob' } });
  store.data.set('user', userStore);

  store.data.set('alert', new Map());

  return store;
}

module('[Unit] Store.find', function(hooks) {
  hooks.afterEach(function() {
    Store.instance = null;
    sinon.restore();
  });

  test('find returns from memory for memory:true models', async function(assert) {
    const store = createStore();
    store._memoryResolver = () => true;

    const record = await store.find('user', 1);
    assert.strictEqual(record.name, 'Alice', 'returns record from memory');
  });

  test('find queries MySQL for memory:false models', async function(assert) {
    const store = createStore();
    store._memoryResolver = (name) => name !== 'alert';

    const mockRecord = { id: 42, message: 'test' };
    store._sqlDb = {
      findRecord: sinon.stub().resolves(mockRecord)
    };

    const record = await store.find('alert', 42);

    assert.ok(store._sqlDb.findRecord.calledOnce, 'findRecord called on sqlDb');
    assert.deepEqual(store._sqlDb.findRecord.firstCall.args, ['alert', 42], 'called with correct args');
    assert.strictEqual(record, mockRecord, 'returns MySQL result');
  });

  test('find falls back to memory when no MySQL configured', async function(assert) {
    const store = createStore();
    store._memoryResolver = () => false;
    store._sqlDb = null;

    const record = await store.find('user', 1);
    assert.strictEqual(record.name, 'Alice', 'falls back to in-memory store');
  });

  test('find defaults to memory:false when no resolver set (queries MySQL)', async function(assert) {
    const store = createStore();
    store._memoryResolver = null;

    const mockRecord = { id: 1, name: 'Alice' };
    store._sqlDb = {
      findRecord: sinon.stub().resolves(mockRecord)
    };

    const record = await store.find('user', 1);
    assert.ok(store._sqlDb.findRecord.calledOnce, 'queries MySQL when no resolver');
    assert.strictEqual(record, mockRecord, 'returns MySQL result');
  });
});

module('[Unit] Store.findAll', function(hooks) {
  hooks.afterEach(function() {
    Store.instance = null;
    sinon.restore();
  });

  test('findAll returns all records from memory for memory:true models', async function(assert) {
    const store = createStore();
    store._memoryResolver = () => true;

    const records = await store.findAll('user');
    assert.strictEqual(records.length, 2, 'returns all in-memory records');
    assert.strictEqual(records[0].name, 'Alice', 'first record correct');
    assert.strictEqual(records[1].name, 'Bob', 'second record correct');
  });

  test('findAll queries MySQL for memory:false models', async function(assert) {
    const store = createStore();
    store._memoryResolver = (name) => name !== 'alert';

    const mockRecords = [{ id: 1 }, { id: 2 }];
    store._sqlDb = {
      findAll: sinon.stub().resolves(mockRecords)
    };

    const records = await store.findAll('alert');

    assert.ok(store._sqlDb.findAll.calledOnce, 'findAll called on sqlDb');
    assert.deepEqual(store._sqlDb.findAll.firstCall.args, ['alert', undefined], 'called with model name');
    assert.strictEqual(records, mockRecords, 'returns MySQL results');
  });

  test('findAll with conditions queries MySQL even for memory:true models', async function(assert) {
    const store = createStore();
    store._memoryResolver = () => true;

    const mockRecords = [{ id: 1, status: 'active' }];
    store._sqlDb = {
      findAll: sinon.stub().resolves(mockRecords)
    };

    const records = await store.findAll('user', { status: 'active' });

    assert.ok(store._sqlDb.findAll.calledOnce, 'queries MySQL when conditions provided');
    assert.strictEqual(records, mockRecords, 'returns filtered MySQL results');
  });

  test('findAll returns empty array for empty model store', async function(assert) {
    const store = createStore();
    store._memoryResolver = () => true;

    const records = await store.findAll('alert');
    assert.deepEqual(records, [], 'returns empty array');
  });

  test('findAll returns empty array for nonexistent model', async function(assert) {
    const store = createStore();
    store._memoryResolver = () => true;

    const records = await store.findAll('nonexistent');
    assert.deepEqual(records, [], 'returns empty array');
  });
});

module('[Unit] Store.query', function(hooks) {
  hooks.afterEach(function() {
    Store.instance = null;
    sinon.restore();
  });

  test('query always hits MySQL when available', async function(assert) {
    const store = createStore();
    store._memoryResolver = () => true;

    const mockRecords = [{ id: 1 }];
    store._sqlDb = {
      findAll: sinon.stub().resolves(mockRecords)
    };

    const records = await store.query('user', { name: 'Alice' });

    assert.ok(store._sqlDb.findAll.calledOnce, 'always hits MySQL');
    assert.deepEqual(store._sqlDb.findAll.firstCall.args, ['user', { name: 'Alice' }], 'passes conditions');
    assert.strictEqual(records, mockRecords, 'returns MySQL results');
  });

  test('query falls back to in-memory filtering when no MySQL', async function(assert) {
    const store = createStore();
    store._sqlDb = null;

    const records = await store.query('user', { name: 'Alice' });

    assert.strictEqual(records.length, 1, 'filters in-memory records');
    assert.strictEqual(records[0].name, 'Alice', 'returns matching record');
  });

  test('query returns all records when no conditions and no MySQL', async function(assert) {
    const store = createStore();
    store._sqlDb = null;

    const records = await store.query('user');

    assert.strictEqual(records.length, 2, 'returns all records');
  });

  test('query returns empty array for no matches in memory fallback', async function(assert) {
    const store = createStore();
    store._sqlDb = null;

    const records = await store.query('user', { name: 'Charlie' });

    assert.deepEqual(records, [], 'returns empty array');
  });
});

module('[Unit] Store._isMemoryModel', function(hooks) {
  hooks.afterEach(function() {
    Store.instance = null;
    sinon.restore();
  });

  test('returns true when resolver says memory:true', function(assert) {
    const store = createStore();
    store._memoryResolver = () => true;

    assert.ok(store._isMemoryModel('user'), 'memory:true model recognized');
  });

  test('returns false when resolver says memory:false', function(assert) {
    const store = createStore();
    store._memoryResolver = () => false;

    assert.notOk(store._isMemoryModel('alert'), 'memory:false model recognized');
  });

  test('defaults to false when no resolver set', function(assert) {
    const store = createStore();
    store._memoryResolver = null;

    assert.notOk(store._isMemoryModel('anything'), 'defaults to memory:false');
  });
});
