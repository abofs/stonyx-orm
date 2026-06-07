import QUnit from 'qunit';
import sinon from 'sinon';
import DynamoDBDB from '../../../src/dynamodb/dynamodb-db.js';
import {
  createMockDeps,
  resetInstance,
  buildDb,
  makeCommandStub,
} from '../../helpers/dynamodb-test-helper.js';

const { module, test } = QUnit;

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
    const deps = createMockDeps({
      config: { rootPath: '/app', orm: {} } as typeof deps.config,
    });
    assert.throws(
      () => new DynamoDBDB(deps),
      /DynamoDB configuration/,
      'error thrown when dynamodb not configured'
    );
  });

  test('uses this.constructor for singleton key (subclass-safe)', function(assert) {
    const deps = createMockDeps();
    const db = new DynamoDBDB(deps);
    // Singleton should be stored on DynamoDBDB, not on a parent class static
    assert.strictEqual(DynamoDBDB.instance, db, 'instance stored on DynamoDBDB');
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

module('[Unit] DynamoDBDB.persist — create', function(hooks) {
  hooks.beforeEach(resetInstance);
  hooks.afterEach(() => { resetInstance(); sinon.restore(); });

  test('calls PutItem with attribute_not_exists(id) condition', async function(assert) {
    const recordId = 'r1';
    const record = { id: recordId, __data: { id: recordId, name: 'Alice' }, __relationships: {} };

    const deps = createMockDeps({
      introspectModels: sinon.stub().returns({
        'user': { table: 'users', columns: { name: 'S' }, foreignKeys: {}, idType: 'string' }
      }),
      getPluralName: sinon.stub().returns('users'),
      store: {
        get: sinon.stub().returns(record),
        _memoryResolver: null,
      } as unknown as typeof deps.store,
    });

    const { db, mockClient } = buildDb(deps);
    mockClient.send.resolves({});

    await db.persist('create', 'user', { rawData: {} }, { data: { id: recordId } });

    assert.ok(deps.buildPutItem.calledOnce, 'buildPutItem called');
    const putArgs = deps.buildPutItem.firstCall.args;
    assert.strictEqual(putArgs[0], 'users', 'correct table name');
    assert.strictEqual(putArgs[2], 'attribute_not_exists(id)', 'condition expression set');
    assert.ok(mockClient.send.calledOnce, 'send called once (PutCommand)');
  });

  test('generates numeric ID for numeric-ID model with __pendingSqlId', async function(assert) {
    const recordId = 99;
    const record = {
      id: recordId,
      __data: { id: recordId, name: 'Bob', __pendingSqlId: true },
      __relationships: {},
    };

    const deps = createMockDeps({
      introspectModels: sinon.stub().returns({
        'user': { table: 'users', columns: { name: 'S' }, foreignKeys: {}, idType: 'number' }
      }),
      getPluralName: sinon.stub().returns('users'),
      getDynamoKeyType: sinon.stub().returns('N'),
      store: {
        get: sinon.stub().returns(record),
        _memoryResolver: null,
      } as unknown as typeof deps.store,
    });

    // Store needs .get(modelName) -> Map for the re-key step
    const modelStoreMap = new Map<unknown, unknown>();
    modelStoreMap.set(recordId, record);
    (deps.store as unknown as { get: sinon.SinonStub }).get
      .withArgs('user', recordId).returns(record)
      .withArgs('user').returns(modelStoreMap);

    const response = { data: { id: recordId } };
    const { db, mockClient } = buildDb(deps);
    mockClient.send.resolves({});

    await db.persist('create', 'user', { rawData: { __pendingSqlId: true } }, response);

    assert.ok(deps.buildPutItem.calledOnce, 'buildPutItem called');
    const item = deps.buildPutItem.firstCall.args[1];
    assert.strictEqual(typeof item.id, 'number', 'id replaced with numeric value');
    assert.ok(item.id > 0, 'numeric id is positive');
    assert.strictEqual(typeof response.data.id, 'number', 'response.data.id updated to numeric');
  });

  test('generates ULID for string-ID model with __pendingSqlId', async function(assert) {
    const recordId = 'temp-abc';
    const record = {
      id: recordId,
      __data: { id: recordId, name: 'Alice', __pendingSqlId: true },
      __relationships: {},
    };

    const deps = createMockDeps({
      introspectModels: sinon.stub().returns({
        'user': { table: 'users', columns: { name: 'S' }, foreignKeys: {}, idType: 'string' }
      }),
      getPluralName: sinon.stub().returns('users'),
      getDynamoKeyType: sinon.stub().returns('S'),
      store: {
        get: sinon.stub().returns(record),
        _memoryResolver: null,
      } as unknown as typeof deps.store,
    });

    const modelStoreMap = new Map<unknown, unknown>();
    modelStoreMap.set(recordId, record);
    (deps.store as unknown as { get: sinon.SinonStub }).get
      .withArgs('user', recordId).returns(record)
      .withArgs('user').returns(modelStoreMap);

    const response = { data: { id: recordId } };
    const { db, mockClient } = buildDb(deps);
    mockClient.send.resolves({});

    await db.persist('create', 'user', { rawData: { __pendingSqlId: true } }, response);

    assert.ok(deps.buildPutItem.calledOnce, 'buildPutItem called');
    const item = deps.buildPutItem.firstCall.args[1];
    assert.strictEqual(typeof item.id, 'string', 'id is a string');
    assert.strictEqual(item.id.length, 26, 'ULID is 26-char Crockford base32 string');
    assert.strictEqual(typeof response.data.id, 'string', 'response.data.id updated to ULID string');
  });

  test('numeric IDs are positive and unique across multiple calls', async function(assert) {
    const ids: number[] = [];

    for (let i = 0; i < 5; i++) {
      const recordId = i + 100;
      const record = {
        id: recordId,
        __data: { id: recordId, name: `User${i}`, __pendingSqlId: true },
        __relationships: {},
      };

      const deps = createMockDeps({
        introspectModels: sinon.stub().returns({
          'user': { table: 'users', columns: { name: 'S' }, foreignKeys: {}, idType: 'number' }
        }),
        getPluralName: sinon.stub().returns('users'),
        getDynamoKeyType: sinon.stub().returns('N'),
        store: {
          get: sinon.stub().returns(record),
          _memoryResolver: null,
        } as unknown as typeof deps.store,
      });

      const modelStoreMap = new Map<unknown, unknown>();
      modelStoreMap.set(recordId, record);
      (deps.store as unknown as { get: sinon.SinonStub }).get
        .withArgs('user', recordId).returns(record)
        .withArgs('user').returns(modelStoreMap);

      const response = { data: { id: recordId } };
      const { db, mockClient } = buildDb(deps);
      mockClient.send.resolves({});

      await db.persist('create', 'user', { rawData: { __pendingSqlId: true } }, response);

      const item = deps.buildPutItem.firstCall.args[1];
      ids.push(item.id as number);
      resetInstance();
    }

    // All IDs should be positive numbers
    for (const id of ids) {
      assert.ok(id > 0, `id ${id} is positive`);
      assert.strictEqual(typeof id, 'number', `id ${id} is type number`);
    }

    // All IDs should be unique
    const uniqueIds = new Set(ids);
    assert.strictEqual(uniqueIds.size, ids.length, 'all generated IDs are unique');
  });
});

module('[Unit] DynamoDBDB.persist — update', function(hooks) {
  hooks.beforeEach(resetInstance);
  hooks.afterEach(() => { resetInstance(); sinon.restore(); });

  test('calls UpdateItem with SET expression from diff', async function(assert) {
    const record = {
      id: 'r1',
      __data: { id: 'r1', name: 'Alice Updated' },
      __relationships: {},
    };

    const deps = createMockDeps({
      introspectModels: sinon.stub().returns({
        'user': { table: 'users', columns: { name: 'S' }, foreignKeys: {}, idType: 'string' }
      }),
      getPluralName: sinon.stub().returns('users'),
    });

    const { db, mockClient } = buildDb(deps);
    mockClient.send.resolves({});

    await db.persist('update', 'user', {
      record: record as unknown as import('../../../src/types/orm-types.js').OrmRecord,
      oldState: { name: 'Alice' },
    }, {});

    assert.ok(deps.buildUpdateItem.calledOnce, 'buildUpdateItem called');
    const [tableName, key, changedData] = deps.buildUpdateItem.firstCall.args;
    assert.strictEqual(tableName, 'users', 'correct table');
    assert.deepEqual(key, { id: 'r1' }, 'correct key');
    assert.deepEqual(changedData, { name: 'Alice Updated' }, 'diff contains only changed columns');
    assert.ok(mockClient.send.calledOnce, 'UpdateCommand sent');
  });

  test('skips UpdateItem when no columns changed', async function(assert) {
    const record = {
      id: 'r1',
      __data: { id: 'r1', name: 'Alice' },
      __relationships: {},
    };

    const deps = createMockDeps({
      introspectModels: sinon.stub().returns({
        'user': { table: 'users', columns: { name: 'S' }, foreignKeys: {}, idType: 'string' }
      }),
      getPluralName: sinon.stub().returns('users'),
    });

    const { db, mockClient } = buildDb(deps);

    await db.persist('update', 'user', {
      record: record as unknown as import('../../../src/types/orm-types.js').OrmRecord,
      oldState: { name: 'Alice' },  // same — no diff
    }, {});

    assert.ok(mockClient.send.notCalled, 'no DynamoDB call when nothing changed');
  });
});

module('[Unit] DynamoDBDB.persist — delete', function(hooks) {
  hooks.beforeEach(resetInstance);
  hooks.afterEach(() => { resetInstance(); sinon.restore(); });

  test('calls DeleteItem with correct key', async function(assert) {
    const deps = createMockDeps({
      introspectModels: sinon.stub().returns({
        'user': { table: 'users', columns: {}, foreignKeys: {}, idType: 'string' }
      }),
      getPluralName: sinon.stub().returns('users'),
    });

    const { db, mockClient } = buildDb(deps);
    mockClient.send.resolves({});

    await db.persist('delete', 'user', { recordId: 'r1' }, {});

    assert.ok(deps.buildDeleteItem.calledOnce, 'buildDeleteItem called');
    const [tableName, key] = deps.buildDeleteItem.firstCall.args;
    assert.strictEqual(tableName, 'users', 'correct table');
    assert.deepEqual(key, { id: 'r1' }, 'correct key');
    assert.ok(mockClient.send.calledOnce, 'DeleteCommand sent');
  });

  test('skips DeleteItem when recordId is null', async function(assert) {
    const deps = createMockDeps({
      introspectModels: sinon.stub().returns({
        'user': { table: 'users', columns: {}, foreignKeys: {}, idType: 'string' }
      }),
    });
    const { db, mockClient } = buildDb(deps);

    await db.persist('delete', 'user', { recordId: null }, {});

    assert.ok(mockClient.send.notCalled, 'no DynamoDB call when recordId is null');
  });
});

module('[Unit] DynamoDBDB.startup', function(hooks) {
  hooks.beforeEach(resetInstance);
  hooks.afterEach(() => { resetInstance(); sinon.restore(); });

  test('calls DescribeTable and skips CreateTable when table already ACTIVE', async function(assert) {
    const rawClientSend = sinon.stub().resolves({
      Table: { TableStatus: 'ACTIVE', GlobalSecondaryIndexes: [] }
    });

    const DescribeTableCommand = makeCommandStub('DescribeTableCommand');
    const CreateTableCommand = makeCommandStub('CreateTableCommand');
    const UpdateTableCommand = makeCommandStub('UpdateTableCommand');

    const deps = createMockDeps({
      introspectModels: sinon.stub().returns({
        'user': { table: 'users', columns: { name: 'S' }, foreignKeys: {}, idType: 'string' }
      }),
      getPluralName: sinon.stub().returns('users'),
      loadTableCommands: sinon.stub().resolves({
        DynamoDBClient: function(this: { send: sinon.SinonStub }) { this.send = rawClientSend; },
        DescribeTableCommand,
        CreateTableCommand,
        UpdateTableCommand,
      }),
    });

    const { db } = buildDb(deps);
    await db.startup();

    assert.ok(rawClientSend.calledOnce, 'DescribeTable called once');
    const sentCmd = rawClientSend.firstCall.args[0];
    assert.ok(sentCmd instanceof DescribeTableCommand, 'DescribeTableCommand sent');
    assert.ok(!rawClientSend.args.some((a: unknown[]) => a[0] instanceof CreateTableCommand), 'CreateTable NOT called');
  });

  test('calls CreateTable when DescribeTable throws ResourceNotFoundException', async function(assert) {
    const DescribeTableCommand = makeCommandStub('DescribeTableCommand');
    const CreateTableCommand = makeCommandStub('CreateTableCommand');
    const UpdateTableCommand = makeCommandStub('UpdateTableCommand');

    const rawClientSend = sinon.stub();
    // Call 0: DescribeTable → ResourceNotFoundException (table missing)
    // Call 1: CreateTable → resolves
    // Call 2: _waitForTableActive polls DescribeTable → ACTIVE
    rawClientSend.onCall(0).rejects(Object.assign(new Error('No such table'), { name: 'ResourceNotFoundException' }));
    rawClientSend.onCall(1).resolves({});  // CreateTable
    rawClientSend.onCall(2).resolves({ Table: { TableStatus: 'ACTIVE' } });  // poll

    const deps = createMockDeps({
      introspectModels: sinon.stub().returns({
        'user': { table: 'users', columns: { name: 'S' }, foreignKeys: {}, idType: 'string' }
      }),
      getPluralName: sinon.stub().returns('users'),
      loadTableCommands: sinon.stub().resolves({
        DynamoDBClient: function(this: { send: sinon.SinonStub }) { this.send = rawClientSend; },
        DescribeTableCommand,
        CreateTableCommand,
        UpdateTableCommand,
      }),
    });

    const { db } = buildDb(deps);
    await db.startup();

    // 1st call = DescribeTable (throws), 2nd call = CreateTable, 3rd call = DescribeTable (ACTIVE poll)
    assert.ok(rawClientSend.callCount >= 2, 'at least 2 calls made');
    assert.ok(rawClientSend.args[1][0] instanceof CreateTableCommand, 'CreateTableCommand sent on 2nd call');
  });

  test('calls UpdateTable for missing GSIs on existing table', async function(assert) {
    const DescribeTableCommand = makeCommandStub('DescribeTableCommand');
    const CreateTableCommand = makeCommandStub('CreateTableCommand');
    const UpdateTableCommand = makeCommandStub('UpdateTableCommand');

    const rawClientSend = sinon.stub();
    // DescribeTable: table exists but no GSIs
    rawClientSend.onFirstCall().resolves({ Table: { TableStatus: 'ACTIVE', GlobalSecondaryIndexes: [] } });
    // Poll after UpdateTable
    rawClientSend.onSecondCall().resolves({ Table: { TableStatus: 'ACTIVE' } });
    // UpdateTable itself
    rawClientSend.onThirdCall().resolves({});

    // Reorder stubs: UpdateTable is called at index 1, DescribeTable poll at index 2
    rawClientSend.reset();
    rawClientSend.onCall(0).resolves({ Table: { TableStatus: 'ACTIVE', GlobalSecondaryIndexes: [] } });
    rawClientSend.onCall(1).resolves({});  // UpdateTable
    rawClientSend.onCall(2).resolves({ Table: { TableStatus: 'ACTIVE' } });  // poll

    const deps = createMockDeps({
      introspectModels: sinon.stub().returns({
        'comment': {
          table: 'comments',
          columns: { body: 'S' },
          foreignKeys: { post_id: { references: 'posts', column: 'id' } },
          idType: 'string',
        }
      }),
      getPluralName: sinon.stub().callsFake((name: string) => `${name}s`),
      loadTableCommands: sinon.stub().resolves({
        DynamoDBClient: function(this: { send: sinon.SinonStub }) { this.send = rawClientSend; },
        DescribeTableCommand,
        CreateTableCommand,
        UpdateTableCommand,
      }),
    });

    const { db } = buildDb(deps);
    await db.startup();

    assert.ok(rawClientSend.args.some((a: unknown[]) => a[0] instanceof UpdateTableCommand), 'UpdateTableCommand sent for missing GSI');
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
    assert.strictEqual(record!.id, 'abc', 'record has correct id');
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
    assert.strictEqual(passedData['post'], 'p1', 'FK column remapped to relationship key');
    assert.strictEqual(passedData['post_id'], undefined, 'original FK column removed');
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

    assert.ok((deps.log as unknown as { warn: sinon.SinonStub }).warn.calledOnce, 'warning logged for unindexed scan');
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
            getRecordClasses(name: string) {
              return { modelClass: { memory: name === 'session' } };
            }
          }
        }
      }),
      getPluralName: sinon.stub().callsFake((name: string) => `${name}s`),
    });

    const { db, mockClient } = buildDb(deps);
    mockClient.send.resolves({ Items: [{ id: 's1' }], LastEvaluatedKey: undefined });

    await db.loadMemoryRecords();

    assert.strictEqual(deps.buildScan.callCount, 1, 'Scan only called for memory:true model');
    assert.ok(
      (deps.log as unknown as { db: sinon.SinonStub }).db.calledWith(`Skipping memory load for 'alert' (memory: false)`),
      'skip logged'
    );
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

    assert.ok((deps.log as unknown as { db: sinon.SinonStub }).db.called, 'skip message logged');
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
        _memoryResolver: (name: string) => name !== 'alert',
      } as unknown as typeof deps.store,
    });

    const { db } = buildDb(deps);
    // @ts-expect-error — accessing private method for test coverage
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
      } as unknown as typeof deps.store,
    });

    const { db } = buildDb(deps);
    // @ts-expect-error — accessing private method for test coverage
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
      } as unknown as typeof deps.store,
    });

    const { db } = buildDb(deps);
    // @ts-expect-error — accessing private method for test coverage
    db._evictIfNotMemory('alert', { id: 1 });

    assert.ok(modelStore.has(1), 'record untouched without resolver');
  });
});

module('[Unit] DynamoDBDB — table prefix', function(hooks) {
  hooks.beforeEach(resetInstance);
  hooks.afterEach(() => { resetInstance(); sinon.restore(); });

  test('prefixed table name in persist (create)', async function(assert) {
    const recordId = 'r1';
    const record = { id: recordId, __data: { id: recordId, name: 'Alice' }, __relationships: {} };

    const deps = createMockDeps({
      config: {
        rootPath: '/app',
        orm: { dynamodb: { region: 'us-east-1', tablePrefix: 'staging-' } }
      } as typeof deps.config,
      introspectModels: sinon.stub().returns({
        'user': { table: 'users', columns: { name: 'S' }, foreignKeys: {}, idType: 'string' }
      }),
      getPluralName: sinon.stub().returns('users'),
      store: {
        get: sinon.stub().returns(record),
        _memoryResolver: null,
      } as unknown as typeof deps.store,
    });

    const { db, mockClient } = buildDb(deps);
    mockClient.send.resolves({});

    await db.persist('create', 'user', { rawData: {} }, { data: { id: recordId } });

    assert.ok(deps.buildPutItem.calledOnce, 'buildPutItem called');
    assert.strictEqual(deps.buildPutItem.firstCall.args[0], 'staging-users', 'table name prefixed');
  });

  test('prefixed table name in persist (update)', async function(assert) {
    const record = {
      id: 'r1',
      __data: { id: 'r1', name: 'Alice Updated' },
      __relationships: {},
    };

    const deps = createMockDeps({
      config: {
        rootPath: '/app',
        orm: { dynamodb: { region: 'us-east-1', tablePrefix: 'staging-' } }
      } as typeof deps.config,
      introspectModels: sinon.stub().returns({
        'user': { table: 'users', columns: { name: 'S' }, foreignKeys: {}, idType: 'string' }
      }),
      getPluralName: sinon.stub().returns('users'),
    });

    const { db, mockClient } = buildDb(deps);
    mockClient.send.resolves({});

    await db.persist('update', 'user', {
      record: record as unknown as import('../../../src/types/orm-types.js').OrmRecord,
      oldState: { name: 'Alice' },
    }, {});

    assert.ok(deps.buildUpdateItem.calledOnce, 'buildUpdateItem called');
    assert.strictEqual(deps.buildUpdateItem.firstCall.args[0], 'staging-users', 'table name prefixed');
  });

  test('prefixed table name in persist (delete)', async function(assert) {
    const deps = createMockDeps({
      config: {
        rootPath: '/app',
        orm: { dynamodb: { region: 'us-east-1', tablePrefix: 'staging-' } }
      } as typeof deps.config,
      introspectModels: sinon.stub().returns({
        'user': { table: 'users', columns: {}, foreignKeys: {}, idType: 'string' }
      }),
      getPluralName: sinon.stub().returns('users'),
    });

    const { db, mockClient } = buildDb(deps);
    mockClient.send.resolves({});

    await db.persist('delete', 'user', { recordId: 'r1' }, {});

    assert.ok(deps.buildDeleteItem.calledOnce, 'buildDeleteItem called');
    assert.strictEqual(deps.buildDeleteItem.firstCall.args[0], 'staging-users', 'table name prefixed');
  });

  test('prefixed table name in findRecord', async function(assert) {
    const deps = createMockDeps({
      config: {
        rootPath: '/app',
        orm: { dynamodb: { region: 'us-east-1', tablePrefix: 'staging-' } }
      } as typeof deps.config,
      introspectModels: sinon.stub().returns({
        'user': { table: 'users', columns: { name: 'S' }, foreignKeys: {}, idType: 'string' }
      }),
      getPluralName: sinon.stub().returns('users'),
    });

    const { db, mockClient } = buildDb(deps);
    mockClient.send.resolves({ Item: { id: 'r1', name: 'Alice' } });

    await db.findRecord('user', 'r1');

    assert.ok(deps.buildGetItem.calledOnce, 'buildGetItem called');
    assert.strictEqual(deps.buildGetItem.firstCall.args[0], 'staging-users', 'table name prefixed');
  });

  test('prefixed table name in findAll (scan)', async function(assert) {
    const deps = createMockDeps({
      config: {
        rootPath: '/app',
        orm: { dynamodb: { region: 'us-east-1', tablePrefix: 'staging-' } }
      } as typeof deps.config,
      introspectModels: sinon.stub().returns({
        'user': { table: 'users', columns: { name: 'S' }, foreignKeys: {}, idType: 'string' }
      }),
      getPluralName: sinon.stub().returns('users'),
    });

    const { db, mockClient } = buildDb(deps);
    mockClient.send.resolves({ Items: [{ id: '1', name: 'A' }], LastEvaluatedKey: undefined });

    await db.findAll('user');

    assert.ok(deps.buildScan.calledOnce, 'buildScan called');
    assert.strictEqual(deps.buildScan.firstCall.args[0], 'staging-users', 'table name prefixed');
  });

  test('prefixed table name in findAll (query via GSI)', async function(assert) {
    const deps = createMockDeps({
      config: {
        rootPath: '/app',
        orm: { dynamodb: { region: 'us-east-1', tablePrefix: 'staging-' } }
      } as typeof deps.config,
      introspectModels: sinon.stub().returns({
        'comment': {
          table: 'comments',
          columns: { body: 'S' },
          foreignKeys: { post_id: { references: 'posts', column: 'id' } },
          idType: 'string',
        }
      }),
      getPluralName: sinon.stub().callsFake((name: string) => `${name}s`),
    });

    const { db, mockClient } = buildDb(deps);
    // Re-init to build GSI registry with the prefixed table name
    await db.init();

    // Replace the client with our mock after init
    db.client = mockClient;
    mockClient.send.resolves({ Items: [{ id: 'c1', body: 'Hello', post_id: 'p1' }], LastEvaluatedKey: undefined });

    await db.findAll('comment', { post_id: 'p1' });

    assert.ok(deps.buildQuery.calledOnce, 'buildQuery called');
    assert.strictEqual(deps.buildQuery.firstCall.args[0], 'staging-comments', 'table name prefixed');
    assert.strictEqual(deps.buildQuery.firstCall.args[1], 'staging-comments-post_id-index', 'GSI name prefixed');
  });

  test('prefixed table name in loadMemoryRecords', async function(assert) {
    const deps = createMockDeps({
      config: {
        rootPath: '/app',
        orm: { dynamodb: { region: 'us-east-1', tablePrefix: 'staging-' } }
      } as typeof deps.config,
      introspectModels: sinon.stub().returns({
        'user': { table: 'users', columns: { name: 'S' }, foreignKeys: {}, idType: 'string' }
      }),
      getTopologicalOrder: sinon.stub().returns(['user']),
      getPluralName: sinon.stub().returns('users'),
    });

    const { db, mockClient } = buildDb(deps);
    mockClient.send.resolves({ Items: [{ id: 'u1', name: 'Alice' }], LastEvaluatedKey: undefined });

    await db.loadMemoryRecords();

    assert.ok(deps.buildScan.calledOnce, 'buildScan called');
    assert.strictEqual(deps.buildScan.firstCall.args[0], 'staging-users', 'table name prefixed');
  });

  test('no prefix when tablePrefix omitted', async function(assert) {
    const deps = createMockDeps({
      introspectModels: sinon.stub().returns({
        'user': { table: 'users', columns: { name: 'S' }, foreignKeys: {}, idType: 'string' }
      }),
      getPluralName: sinon.stub().returns('users'),
    });

    const { db, mockClient } = buildDb(deps);
    mockClient.send.resolves({ Item: { id: 'r1', name: 'Alice' } });

    await db.findRecord('user', 'r1');

    assert.ok(deps.buildGetItem.calledOnce, 'buildGetItem called');
    assert.strictEqual(deps.buildGetItem.firstCall.args[0], 'users', 'table name without prefix');
  });

  test('prefixed table name in startup', async function(assert) {
    const rawClientSend = sinon.stub();
    // Call 0: DescribeTable → ResourceNotFoundException (table missing)
    // Call 1: CreateTable → resolves
    // Call 2: _waitForTableActive polls DescribeTable → ACTIVE
    rawClientSend.onCall(0).rejects(Object.assign(new Error('No such table'), { name: 'ResourceNotFoundException' }));
    rawClientSend.onCall(1).resolves({});
    rawClientSend.onCall(2).resolves({ Table: { TableStatus: 'ACTIVE' } });

    const DescribeTableCommand = makeCommandStub('DescribeTableCommand');
    const CreateTableCommand = makeCommandStub('CreateTableCommand');
    const UpdateTableCommand = makeCommandStub('UpdateTableCommand');

    const deps = createMockDeps({
      config: {
        rootPath: '/app',
        orm: { dynamodb: { region: 'us-east-1', tablePrefix: 'staging-' } }
      } as typeof deps.config,
      introspectModels: sinon.stub().returns({
        'user': { table: 'users', columns: { name: 'S' }, foreignKeys: {}, idType: 'string' }
      }),
      getPluralName: sinon.stub().returns('users'),
      loadTableCommands: sinon.stub().resolves({
        DynamoDBClient: function(this: { send: sinon.SinonStub }) { this.send = rawClientSend; },
        DescribeTableCommand,
        CreateTableCommand,
        UpdateTableCommand,
      }),
    });

    const { db } = buildDb(deps);
    await db.startup();

    // DescribeTable (call 0) should receive prefixed table name
    const describeParams = (rawClientSend.firstCall.args[0] as { params: { TableName: string } }).params;
    assert.strictEqual(describeParams.TableName, 'staging-users', 'DescribeTableCommand receives prefixed table name');

    // CreateTable (call 1) should receive prefixed table name
    const createParams = (rawClientSend.secondCall.args[0] as { params: { TableName: string } }).params;
    assert.strictEqual(createParams.TableName, 'staging-users', 'CreateTableCommand receives prefixed table name');
  });

  test('prefixed GSI names in registry', async function(assert) {
    const deps = createMockDeps({
      config: {
        rootPath: '/app',
        orm: { dynamodb: { region: 'us-east-1', tablePrefix: 'staging-' } }
      } as typeof deps.config,
      introspectModels: sinon.stub().returns({
        'comment': {
          table: 'comments',
          columns: { body: 'S' },
          foreignKeys: { post_id: { references: 'posts', column: 'id' } },
          idType: 'string',
        }
      }),
      getPluralName: sinon.stub().callsFake((name: string) => `${name}s`),
    });

    const { db, mockClient } = buildDb(deps);
    // init() triggers _buildGsiRegistry
    await db.init();

    // Replace the client with our mock after init
    db.client = mockClient;
    mockClient.send.resolves({ Items: [{ id: 'c1', body: 'Hi', post_id: 'p1' }], LastEvaluatedKey: undefined });

    await db.findAll('comment', { post_id: 'p1' });

    assert.ok(deps.buildQuery.calledOnce, 'buildQuery called');
    assert.strictEqual(deps.buildQuery.firstCall.args[1], 'staging-comments-post_id-index', 'GSI name includes prefix');
  });
});
