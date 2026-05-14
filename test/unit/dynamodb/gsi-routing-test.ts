// @ts-nocheck
import QUnit from 'qunit';
import sinon from 'sinon';
import DynamoDBDB from '../../../src/dynamodb/dynamodb-db.js';

const { module, test } = QUnit;

function makeCommandStub(name) {
  function Cmd(params) { this.params = params; }
  Cmd.displayName = name;
  return Cmd;
}

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
  return {
    createDocumentClient: sinon.stub().resolves({ send: sinon.stub().resolves({}) }),
    destroyDocumentClient: sinon.stub().returns(null),
    loadDocClientCommands: sinon.stub().resolves(makeDocClientCommands()),
    loadTableCommands: sinon.stub().resolves({}),
    buildPutItem: sinon.stub().returns({ TableName: 'test', Item: {} }),
    buildGetItem: sinon.stub().returns({ TableName: 'test', Key: {} }),
    buildUpdateItem: sinon.stub().returns({ TableName: 'test', Key: {}, UpdateExpression: 'SET', ExpressionAttributeNames: {}, ExpressionAttributeValues: {}, ReturnValues: 'NONE' }),
    buildDeleteItem: sinon.stub().returns({ TableName: 'test', Key: {} }),
    buildScan: sinon.stub().returns({ TableName: 'test' }),
    buildQuery: sinon.stub().returns({ TableName: 'test', IndexName: 'idx', KeyConditionExpression: '', ExpressionAttributeNames: {}, ExpressionAttributeValues: {} }),
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
      orm: { dynamodb: { region: 'us-east-1' } }
    },
    log: { db: sinon.stub(), warn: sinon.stub() },
    _importOrm: sinon.stub().resolves({
      default: {
        instance: {
          getRecordClasses(_name) { return { modelClass: { memory: true } }; },
          isView() { return false; }
        }
      }
    }),
    ...overrides,
  };
}

function resetInstance() {
  DynamoDBDB.instance = undefined;
}

function buildDb(deps) {
  const db = new DynamoDBDB(deps);
  const mockClient = { send: sinon.stub().resolves({ Items: [], LastEvaluatedKey: undefined }) };
  db.client = mockClient;
  return { db, mockClient };
}

module('[Unit] DynamoDBDB GSI Registry — _buildGsiRegistry', function(hooks) {
  hooks.beforeEach(resetInstance);
  hooks.afterEach(() => { resetInstance(); sinon.restore(); });

  test('no GSIs for models with no FK columns', function(assert) {
    const deps = createMockDeps({
      introspectModels: sinon.stub().returns({
        'user': { table: 'users', columns: { name: 'S' }, foreignKeys: {}, idType: 'string' }
      }),
      getPluralName: sinon.stub().returns('users'),
    });

    const { db } = buildDb(deps);
    db['_buildGsiRegistry']();  // re-invoke explicitly after init bypassed

    // Access private registry via bracket notation
    const registry = db['_gsiRegistry'];
    assert.ok(registry.has('user'), 'user is in registry');
    assert.strictEqual(registry.get('user').size, 0, 'no GSIs for user (no FKs)');
  });

  test('FK column creates a GSI entry', function(assert) {
    const deps = createMockDeps({
      introspectModels: sinon.stub().returns({
        'comment': {
          table: 'comments',
          columns: { body: 'S' },
          foreignKeys: { post_id: { references: 'posts', column: 'id' } },
          idType: 'string',
        }
      }),
      getPluralName: sinon.stub().callsFake(name => `${name}s`),
    });

    const { db } = buildDb(deps);
    db['_buildGsiRegistry']();

    const registry = db['_gsiRegistry'];
    const commentGsis = registry.get('comment');
    assert.ok(commentGsis.has('post_id'), 'post_id gets a GSI entry');
    assert.strictEqual(commentGsis.get('post_id'), 'comments-post_id-index', 'GSI named correctly');
  });

  test('multiple FK columns produce multiple GSI entries', function(assert) {
    const deps = createMockDeps({
      introspectModels: sinon.stub().returns({
        'order': {
          table: 'orders',
          columns: { amount: 'N' },
          foreignKeys: {
            user_id: { references: 'users', column: 'id' },
            product_id: { references: 'products', column: 'id' },
          },
          idType: 'string',
        }
      }),
      getPluralName: sinon.stub().callsFake(name => `${name}s`),
    });

    const { db } = buildDb(deps);
    db['_buildGsiRegistry']();

    const registry = db['_gsiRegistry'];
    const orderGsis = registry.get('order');
    assert.strictEqual(orderGsis.size, 2, '2 GSIs for 2 FK columns');
    assert.ok(orderGsis.has('user_id'), 'user_id GSI present');
    assert.ok(orderGsis.has('product_id'), 'product_id GSI present');
  });
});

module('[Unit] DynamoDBDB GSI Routing — findAll with conditions', function(hooks) {
  hooks.beforeEach(resetInstance);
  hooks.afterEach(() => { resetInstance(); sinon.restore(); });

  test('routes to Query when condition matches GSI key (FK column)', async function(assert) {
    const deps = createMockDeps({
      introspectModels: sinon.stub().returns({
        'comment': {
          table: 'comments',
          columns: { body: 'S' },
          foreignKeys: { post_id: { references: 'posts', column: 'id' } },
          idType: 'string',
        }
      }),
      getPluralName: sinon.stub().callsFake(name => `${name}s`),
    });

    const { db, mockClient } = buildDb(deps);
    // Rebuild GSI registry with FK knowledge
    db['_buildGsiRegistry']();
    mockClient.send.resolves({ Items: [{ id: 'c1', body: 'Hello', post_id: 'p1' }], LastEvaluatedKey: undefined });

    const records = await db.findAll('comment', { post_id: 'p1' });

    assert.ok(deps.buildQuery.calledOnce, 'buildQuery used (GSI route)');
    assert.ok(deps.buildScan.notCalled, 'buildScan NOT used');
    assert.ok(deps.log.warn.notCalled, 'no warning logged for indexed query');
    assert.strictEqual(records.length, 1, 'one record returned');
  });

  test('falls back to Scan+FilterExpression for non-indexed condition', async function(assert) {
    const deps = createMockDeps({
      introspectModels: sinon.stub().returns({
        'comment': {
          table: 'comments',
          columns: { body: 'S', status: 'S' },
          foreignKeys: {},
          idType: 'string',
        }
      }),
      getPluralName: sinon.stub().callsFake(name => `${name}s`),
    });

    const { db, mockClient } = buildDb(deps);
    db['_buildGsiRegistry']();
    mockClient.send.resolves({ Items: [], LastEvaluatedKey: undefined });

    await db.findAll('comment', { status: 'active' });

    assert.ok(deps.buildScan.calledOnce, 'buildScan used for non-indexed condition');
    assert.ok(deps.buildQuery.notCalled, 'buildQuery NOT used');
    assert.ok(deps.log.warn.calledOnce, 'warning logged for unindexed scan');
    assert.ok(deps.log.warn.firstCall.args[0].includes('no GSI for conditions'), 'warning mentions GSI');
  });

  test('GSI query result is further filtered by remaining conditions', async function(assert) {
    const deps = createMockDeps({
      introspectModels: sinon.stub().returns({
        'comment': {
          table: 'comments',
          columns: { body: 'S', status: 'S' },
          foreignKeys: { post_id: { references: 'posts', column: 'id' } },
          idType: 'string',
        }
      }),
      getPluralName: sinon.stub().callsFake(name => `${name}s`),
    });

    const { db, mockClient } = buildDb(deps);
    db['_buildGsiRegistry']();

    // Two items from GSI; one passes the remaining filter, one doesn't
    mockClient.send.resolves({
      Items: [
        { id: 'c1', body: 'Hello', post_id: 'p1', status: 'active' },
        { id: 'c2', body: 'World', post_id: 'p1', status: 'deleted' },
      ],
      LastEvaluatedKey: undefined,
    });

    const records = await db.findAll('comment', { post_id: 'p1', status: 'active' });

    assert.ok(deps.buildQuery.calledOnce, 'Query used for GSI key');
    assert.strictEqual(records.length, 1, 'only 1 record matches remaining conditions');
    assert.strictEqual(records[0].id, 'c1', 'correct record returned');
  });
});

module('[Unit] DynamoDBDB GSI provisioning — _buildGsiDefinitions', function(hooks) {
  hooks.beforeEach(resetInstance);
  hooks.afterEach(() => { resetInstance(); sinon.restore(); });

  test('returns empty array for model with no FKs', function(assert) {
    const deps = createMockDeps({
      getPluralName: sinon.stub().returns('users'),
    });
    const { db } = buildDb(deps);

    const schema = { table: 'users', columns: {}, foreignKeys: {}, idType: 'string', relationships: { belongsTo: {}, hasMany: {} }, memory: true };
    const gsis = db['_buildGsiDefinitions']('user', schema);

    assert.deepEqual(gsis, [], 'no GSIs for model without FKs');
  });

  test('returns one GSI definition per FK column', function(assert) {
    const deps = createMockDeps({
      getPluralName: sinon.stub().callsFake(name => `${name}s`),
    });
    const { db } = buildDb(deps);

    const schema = {
      table: 'comments',
      columns: {},
      foreignKeys: {
        post_id: { references: 'posts', column: 'id' },
        user_id: { references: 'users', column: 'id' },
      },
      idType: 'string',
      relationships: { belongsTo: {}, hasMany: {} },
      memory: true,
    };

    const gsis = db['_buildGsiDefinitions']('comment', schema);

    assert.strictEqual(gsis.length, 2, '2 GSI definitions');

    const names = gsis.map(g => g.IndexName);
    assert.ok(names.includes('comments-post_id-index'), 'post_id GSI named correctly');
    assert.ok(names.includes('comments-user_id-index'), 'user_id GSI named correctly');

    // Each GSI should be ALL projection
    for (const gsi of gsis) {
      assert.strictEqual(gsi.Projection.ProjectionType, 'ALL', 'ALL projection');
      assert.strictEqual(gsi.KeySchema[0].KeyType, 'HASH', 'HASH key type');
    }
  });

  test('_buildAttributeDefinitions includes id and FK columns', function(assert) {
    const deps = createMockDeps({
      getDynamoKeyType: sinon.stub().callsFake(type => type === 'string' ? 'S' : 'N'),
    });
    const { db } = buildDb(deps);

    const schema = {
      table: 'comments',
      columns: {},
      foreignKeys: { post_id: { references: 'posts', column: 'id' } },
      idType: 'string',
      relationships: { belongsTo: {}, hasMany: {} },
      memory: true,
    };

    const attrDefs = db['_buildAttributeDefinitions'](schema);

    assert.strictEqual(attrDefs.length, 2, 'id + post_id');
    const idDef = attrDefs.find(d => d.AttributeName === 'id');
    const fkDef = attrDefs.find(d => d.AttributeName === 'post_id');
    assert.ok(idDef, 'id attribute definition present');
    assert.ok(fkDef, 'post_id attribute definition present');
    assert.strictEqual(idDef.AttributeType, 'S', 'id is S for string idType');
    assert.strictEqual(fkDef.AttributeType, 'S', 'FK is S by default');
  });

  test('_buildAttributeDefinitions deduplicates repeated attributes', function(assert) {
    const deps = createMockDeps({
      getDynamoKeyType: sinon.stub().returns('S'),
    });
    const { db } = buildDb(deps);

    // Simulate model where id also appears as FK (edge case)
    const schema = {
      table: 'weird',
      columns: {},
      foreignKeys: { id: { references: 'other', column: 'id' } },  // same as PK
      idType: 'string',
      relationships: { belongsTo: {}, hasMany: {} },
      memory: true,
    };

    const attrDefs = db['_buildAttributeDefinitions'](schema);

    const idCount = attrDefs.filter(d => d.AttributeName === 'id').length;
    assert.strictEqual(idCount, 1, 'id not duplicated');
  });
});
