// @ts-nocheck
import QUnit from 'qunit';
import sinon from 'sinon';
import DynamoDBDB from '../../../src/dynamodb/dynamodb-db.js';

const { module, test } = QUnit;

/** Command stub factory — returns a class whose instances can be passed to send(). */
function makeCommandStub(name) {
  function Cmd(params) { this.params = params; }
  Cmd.displayName = name;
  return Cmd;
}

/** Build a stub loadDocClientCommands dep that resolves to no-op command stubs. */
function makeDocClientCommands() {
  return {
    PutCommand: makeCommandStub('PutCommand'),
    GetCommand: makeCommandStub('GetCommand'),
    UpdateCommand: makeCommandStub('UpdateCommand'),
    DeleteCommand: makeCommandStub('DeleteCommand'),
    ScanCommand: makeCommandStub('ScanCommand'),
    QueryCommand: makeCommandStub('QueryCommand'),
  };
}

function createMockDeps(overrides = {}) {
  const docCommands = makeDocClientCommands();

  return {
    createDocumentClient: sinon.stub().resolves({ send: sinon.stub().resolves({}) }),
    destroyDocumentClient: sinon.stub().returns(null),
    loadDocClientCommands: sinon.stub().resolves(docCommands),
    loadTableCommands: sinon.stub().resolves({
      DynamoDBClient: function() { this.send = sinon.stub().resolves({ Table: { TableStatus: 'ACTIVE', GlobalSecondaryIndexes: [] } }); },
      DescribeTableCommand: makeCommandStub('DescribeTableCommand'),
      CreateTableCommand: makeCommandStub('CreateTableCommand'),
      UpdateTableCommand: makeCommandStub('UpdateTableCommand'),
    }),
    buildPutItem: sinon.stub().returns({ TableName: 'test', Item: {} }),
    buildGetItem: sinon.stub().returns({ TableName: 'test', Key: {} }),
    buildUpdateItem: sinon.stub().returns({ TableName: 'test', Key: {}, UpdateExpression: 'SET #x = :x', ExpressionAttributeNames: {}, ExpressionAttributeValues: {}, ReturnValues: 'NONE' }),
    buildDeleteItem: sinon.stub().returns({ TableName: 'test', Key: {} }),
    buildScan: sinon.stub().returns({ TableName: 'test' }),
    buildQuery: sinon.stub().returns({ TableName: 'test', IndexName: 'idx', KeyConditionExpression: '#id = :id', ExpressionAttributeNames: {}, ExpressionAttributeValues: {} }),
    introspectModels: sinon.stub().returns({}),
    getTopologicalOrder: sinon.stub().returns([]),
    getDynamoKeyType: sinon.stub().returns('S'),
    createRecord: sinon.stub().callsFake((name, data) => ({
      id: data.id,
      __model: { __name: name },
      __data: { ...data },
      __relationships: {},
    })),
    store: { get: sinon.stub(), _memoryResolver: null },
    getPluralName: sinon.stub().callsFake(name => `${name}s`),
    config: {
      rootPath: '/app',
      orm: {
        dynamodb: { region: 'us-east-1' }
      }
    },
    log: {
      db: sinon.stub(),
      warn: sinon.stub(),
    },
    _importOrm: sinon.stub().resolves({
      default: {
        instance: {
          getRecordClasses(_name) {
            return { modelClass: { memory: true } };
          },
          isView() { return false; }
        }
      }
    }),
    ...overrides,
  };
}

// Reset singleton between tests
function resetInstance() {
  DynamoDBDB.instance = undefined;
}

// Build a DynamoDBDB with a pre-wired mock client
function buildDb(deps) {
  const db = new DynamoDBDB(deps);
  const mockClient = {
    send: sinon.stub().resolves({ Items: [], LastEvaluatedKey: undefined }),
  };
  db.client = mockClient;
  return { db, mockClient };
}

module('[Unit] DynamoDBDB — constructor + singleton', function(hooks) {
  hooks.beforeEach(resetInstance);
  hooks.afterEach(() => { resetInstance(); sinon.restore(); });

  test('creates singleton on first call', function(assert) {
    const deps = createMockDeps();
    const db1 = new DynamoDBDB(deps);
    const db2 = new DynamoDBDB(deps);
    assert.strictEqual(db1, db2, 'same instance returned on second call');
  });

  test('throws when dynamodb config missing', function(assert) {
    const deps = createMockDeps({ config: { rootPath: '/app', orm: {} } });
    assert.throws(
      () => new DynamoDBDB(deps),
      /DynamoDB configuration/,
      'error thrown when dynamodb not configured'
    );
  });
});

module('[Unit] DynamoDBDB.init', function(hooks) {
  hooks.beforeEach(resetInstance);
  hooks.afterEach(() => { resetInstance(); sinon.restore(); });

  test('calls createDocumentClient with config', async function(assert) {
    const client = { send: sinon.stub().resolves({ Items: [] }) };
    const deps = createMockDeps({
      createDocumentClient: sinon.stub().resolves(client),
    });

    const db = new DynamoDBDB(deps);
    await db.init();

    assert.ok(deps.createDocumentClient.calledOnce, 'createDocumentClient called');
    assert.deepEqual(deps.createDocumentClient.firstCall.args[0], { region: 'us-east-1' }, 'config passed');
    assert.strictEqual(db.client, client, 'client set on instance');
  });

  test('calls loadMemoryRecords after client creation', async function(assert) {
    const client = { send: sinon.stub().resolves({ Items: [] }) };
    const deps = createMockDeps({
      createDocumentClient: sinon.stub().resolves(client),
    });

    const db = new DynamoDBDB(deps);
    const loadSpy = sinon.spy(db, 'loadMemoryRecords');
    await db.init();

    assert.ok(loadSpy.calledOnce, 'loadMemoryRecords called during init');
  });
});

module('[Unit] DynamoDBDB.shutdown', function(hooks) {
  hooks.beforeEach(resetInstance);
  hooks.afterEach(() => { resetInstance(); sinon.restore(); });

  test('nullifies the client', async function(assert) {
    const deps = createMockDeps({
      destroyDocumentClient: sinon.stub().returns(null),
    });
    const { db } = buildDb(deps);

    await db.shutdown();

    assert.strictEqual(db.client, null, 'client set to null after shutdown');
    assert.ok(deps.destroyDocumentClient.calledOnce, 'destroyDocumentClient called');
  });
});

module('[Unit] DynamoDBDB.findRecord', function(hooks) {
  hooks.beforeEach(resetInstance);
  hooks.afterEach(() => { resetInstance(); sinon.restore(); });

  test('returns a record when GetItem returns an item', async function(assert) {
    const deps = createMockDeps({
      introspectModels: sinon.stub().returns({
        'session': { table: 'sessions', columns: { token: 'S' }, foreignKeys: {}, idType: 'string' }
      }),
      getPluralName: sinon.stub().returns('sessions'),
    });

    const { db, mockClient } = buildDb(deps);
    mockClient.send.resolves({ Item: { id: 'abc', token: 'tok123' } });

    const record = await db.findRecord('session', 'abc');

    assert.ok(deps.buildGetItem.calledOnce, 'buildGetItem called');
    assert.ok(deps.createRecord.calledOnce, 'createRecord called');
    assert.strictEqual(record.id, 'abc', 'record has correct id');
  });

  test('returns undefined when no item found', async function(assert) {
    const deps = createMockDeps({
      introspectModels: sinon.stub().returns({
        'session': { table: 'sessions', columns: {}, foreignKeys: {}, idType: 'string' }
      }),
      getPluralName: sinon.stub().returns('sessions'),
    });

    const { db, mockClient } = buildDb(deps);
    mockClient.send.resolves({ Item: undefined });

    const record = await db.findRecord('session', 'missing');

    assert.strictEqual(record, undefined, 'undefined returned for missing item');
    assert.ok(deps.createRecord.notCalled, 'createRecord not called');
  });

  test('returns undefined for unknown model', async function(assert) {
    const deps = createMockDeps({ introspectModels: sinon.stub().returns({}) });
    const { db } = buildDb(deps);

    const record = await db.findRecord('nonexistent', '1');
    assert.strictEqual(record, undefined);
    assert.ok(deps.buildGetItem.notCalled, 'no DynamoDB call made');
  });

  test('returns undefined on ResourceNotFoundException', async function(assert) {
    const deps = createMockDeps({
      introspectModels: sinon.stub().returns({
        'session': { table: 'sessions', columns: {}, foreignKeys: {}, idType: 'string' }
      }),
      getPluralName: sinon.stub().returns('sessions'),
    });

    const { db, mockClient } = buildDb(deps);
    const err = Object.assign(new Error('No such table'), { name: 'ResourceNotFoundException' });
    mockClient.send.rejects(err);

    const record = await db.findRecord('session', '1');
    assert.strictEqual(record, undefined, 'gracefully returns undefined');
  });

  test('FK columns are remapped to relationship keys', async function(assert) {
    const deps = createMockDeps({
      introspectModels: sinon.stub().returns({
        'comment': {
          table: 'comments',
          columns: { body: 'S' },
          foreignKeys: { post_id: { references: 'posts', column: 'id' } },
          idType: 'string',
        }
      }),
      getPluralName: sinon.stub().returns('comments'),
    });

    const { db, mockClient } = buildDb(deps);
    mockClient.send.resolves({ Item: { id: 'c1', body: 'Hello', post_id: 'p1' } });

    await db.findRecord('comment', 'c1');

    const passedData = deps.createRecord.firstCall.args[1];
    assert.strictEqual(passedData.post, 'p1', 'FK column remapped to relationship key');
    assert.strictEqual(passedData.post_id, undefined, 'original FK column removed');
  });
});

module('[Unit] DynamoDBDB.findAll', function(hooks) {
  hooks.beforeEach(resetInstance);
  hooks.afterEach(() => { resetInstance(); sinon.restore(); });

  test('returns all items via Scan when no conditions', async function(assert) {
    const deps = createMockDeps({
      introspectModels: sinon.stub().returns({
        'alert': { table: 'alerts', columns: { msg: 'S' }, foreignKeys: {}, idType: 'string' }
      }),
      getPluralName: sinon.stub().returns('alerts'),
    });

    const { db, mockClient } = buildDb(deps);
    mockClient.send.resolves({
      Items: [{ id: '1', msg: 'A' }, { id: '2', msg: 'B' }],
      LastEvaluatedKey: undefined,
    });

    const records = await db.findAll('alert');

    assert.strictEqual(records.length, 2, 'returns 2 records');
    assert.ok(deps.buildScan.calledOnce, 'buildScan used');
    assert.ok(deps.createRecord.calledTwice, 'createRecord called for each item');
  });

  test('paginates through multiple pages of Scan results', async function(assert) {
    const deps = createMockDeps({
      introspectModels: sinon.stub().returns({
        'alert': { table: 'alerts', columns: {}, foreignKeys: {}, idType: 'string' }
      }),
      getPluralName: sinon.stub().returns('alerts'),
    });

    const { db, mockClient } = buildDb(deps);
    mockClient.send
      .onFirstCall().resolves({ Items: [{ id: '1' }], LastEvaluatedKey: { id: '1' } })
      .onSecondCall().resolves({ Items: [{ id: '2' }], LastEvaluatedKey: undefined });

    const records = await db.findAll('alert');

    assert.strictEqual(records.length, 2, 'both pages combined');
    assert.strictEqual(mockClient.send.callCount, 2, '2 DynamoDB calls for 2 pages');
  });

  test('returns empty array for unknown model', async function(assert) {
    const deps = createMockDeps({ introspectModels: sinon.stub().returns({}) });
    const { db } = buildDb(deps);

    const records = await db.findAll('nonexistent');
    assert.deepEqual(records, [], 'empty array returned');
  });

  test('returns empty array on ResourceNotFoundException', async function(assert) {
    const deps = createMockDeps({
      introspectModels: sinon.stub().returns({
        'alert': { table: 'alerts', columns: {}, foreignKeys: {}, idType: 'string' }
      }),
      getPluralName: sinon.stub().returns('alerts'),
    });
    const { db, mockClient } = buildDb(deps);
    const err = Object.assign(new Error('No table'), { name: 'ResourceNotFoundException' });
    mockClient.send.rejects(err);

    const records = await db.findAll('alert');
    assert.deepEqual(records, [], 'empty array on missing table');
  });

  test('conditions without GSI match use Scan+FilterExpression and log warning', async function(assert) {
    const deps = createMockDeps({
      introspectModels: sinon.stub().returns({
        'alert': { table: 'alerts', columns: { status: 'S' }, foreignKeys: {}, idType: 'string' }
      }),
      getPluralName: sinon.stub().returns('alerts'),
    });

    const { db, mockClient } = buildDb(deps);
    mockClient.send.resolves({ Items: [{ id: '1', status: 'active' }], LastEvaluatedKey: undefined });

    const records = await db.findAll('alert', { status: 'active' });

    assert.ok(deps.log.warn.calledOnce, 'warning logged for unindexed scan');
    assert.ok(deps.buildScan.calledOnce, 'buildScan called (not buildQuery)');
    assert.strictEqual(records.length, 1);
  });
});

module('[Unit] DynamoDBDB.loadMemoryRecords', function(hooks) {
  hooks.beforeEach(resetInstance);
  hooks.afterEach(() => { resetInstance(); sinon.restore(); });

  test('skips models with memory: false', async function(assert) {
    const deps = createMockDeps({
      introspectModels: sinon.stub().returns({
        'session': { table: 'sessions', columns: {}, foreignKeys: {}, idType: 'string' },
        'alert': { table: 'alerts', columns: {}, foreignKeys: {}, idType: 'string' },
      }),
      getTopologicalOrder: sinon.stub().returns(['session', 'alert']),
      _importOrm: sinon.stub().resolves({
        default: {
          instance: {
            getRecordClasses(name) {
              // session=true (memory), alert=false (on-demand)
              return { modelClass: { memory: name === 'session' } };
            }
          }
        }
      }),
      getPluralName: sinon.stub().callsFake(name => `${name}s`),
    });

    const { db, mockClient } = buildDb(deps);
    mockClient.send.resolves({ Items: [{ id: 's1' }], LastEvaluatedKey: undefined });

    await db.loadMemoryRecords();

    // buildScan should only be called once (for 'session'), not for 'alert'
    assert.strictEqual(deps.buildScan.callCount, 1, 'Scan only called for memory:true model');
    assert.ok(deps.log.db.calledWith(`Skipping memory load for 'alert' (memory: false)`), 'skip logged');
  });

  test('handles ResourceNotFoundException gracefully (table not yet created)', async function(assert) {
    const deps = createMockDeps({
      introspectModels: sinon.stub().returns({
        'session': { table: 'sessions', columns: {}, foreignKeys: {}, idType: 'string' },
      }),
      getTopologicalOrder: sinon.stub().returns(['session']),
      getPluralName: sinon.stub().returns('sessions'),
    });

    const { db, mockClient } = buildDb(deps);
    const err = Object.assign(new Error('No table'), { name: 'ResourceNotFoundException' });
    mockClient.send.rejects(err);

    await db.loadMemoryRecords(); // should not throw

    assert.ok(deps.log.db.called, 'skip message logged');
    assert.ok(deps.createRecord.notCalled, 'createRecord not called');
  });
});

module('[Unit] DynamoDBDB._evictIfNotMemory', function(hooks) {
  hooks.beforeEach(resetInstance);
  hooks.afterEach(() => { resetInstance(); sinon.restore(); });

  test('evicts record from store when memory resolver returns false', function(assert) {
    const modelStore = new Map();
    modelStore.set('abc', { id: 'abc' });

    const deps = createMockDeps({
      store: {
        get: sinon.stub().returns(modelStore),
        _memoryResolver: name => name !== 'alert',
      },
    });

    const { db } = buildDb(deps);
    db._evictIfNotMemory('alert', { id: 'abc' });

    assert.notOk(modelStore.has('abc'), 'record evicted from store');
  });

  test('does not evict when memory resolver returns true', function(assert) {
    const modelStore = new Map();
    modelStore.set('s1', { id: 's1' });

    const deps = createMockDeps({
      store: {
        get: sinon.stub().returns(modelStore),
        _memoryResolver: () => true,
      },
    });

    const { db } = buildDb(deps);
    db._evictIfNotMemory('session', { id: 's1' });

    assert.ok(modelStore.has('s1'), 'record stays in store');
  });

  test('does nothing when no memory resolver is set', function(assert) {
    const modelStore = new Map();
    modelStore.set(1, { id: 1 });

    const deps = createMockDeps({
      store: {
        get: sinon.stub().returns(modelStore),
        _memoryResolver: null,
      },
    });

    const { db } = buildDb(deps);
    db._evictIfNotMemory('alert', { id: 1 });

    assert.ok(modelStore.has(1), 'record untouched without resolver');
  });
});
