// test/helpers/dynamodb-test-helper.ts
import sinon from 'sinon';
import DynamoDBDB from '../../src/dynamodb/dynamodb-db.js';
import type { DynamoDBDeps } from '../../src/dynamodb/dynamodb-db.js';

/** Command stub factory — returns a class whose instances can be passed to send(). */
export function makeCommandStub(name: string) {
  function Cmd(this: { params: unknown }, params: unknown) { this.params = params; }
  Cmd.displayName = name;
  return Cmd as unknown as new (params: unknown) => unknown;
}

/** Build a stub loadDocClientCommands dep that resolves to no-op command stubs. */
export function makeDocClientCommands() {
  return {
    PutCommand: makeCommandStub('PutCommand'),
    GetCommand: makeCommandStub('GetCommand'),
    UpdateCommand: makeCommandStub('UpdateCommand'),
    DeleteCommand: makeCommandStub('DeleteCommand'),
    ScanCommand: makeCommandStub('ScanCommand'),
    QueryCommand: makeCommandStub('QueryCommand'),
  };
}

export function createMockDeps(overrides: Partial<DynamoDBDeps> = {}): DynamoDBDeps {
  const docCommands = makeDocClientCommands();

  return {
    createDocumentClient: sinon.stub().resolves({ send: sinon.stub().resolves({}) }),
    destroyDocumentClient: sinon.stub().returns(null),
    loadDocClientCommands: sinon.stub().resolves(docCommands),
    loadTableCommands: sinon.stub().resolves({
      DynamoDBClient: function(this: { send: sinon.SinonStub }) {
        this.send = sinon.stub().resolves({ Table: { TableStatus: 'ACTIVE', GlobalSecondaryIndexes: [] } });
      },
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
    createRecord: sinon.stub().callsFake((name: string, data: Record<string, unknown>) => ({
      id: data['id'],
      __model: { __name: name },
      __data: { ...data },
      __relationships: {},
    })),
    store: { get: sinon.stub(), _memoryResolver: null } as unknown as DynamoDBDeps['store'],
    getPluralName: sinon.stub().callsFake((name: string) => `${name}s`),
    config: {
      rootPath: '/app',
      orm: {
        dynamodb: { region: 'us-east-1' }
      }
    } as DynamoDBDeps['config'],
    log: {
      db: sinon.stub(),
      warn: sinon.stub(),
      error: sinon.stub(),
    } as unknown as DynamoDBDeps['log'],
    _importOrm: sinon.stub().resolves({
      default: {
        instance: {
          getRecordClasses(_name: string) {
            return { modelClass: { memory: true } };
          },
          isView() { return false; }
        }
      }
    }),
    ...overrides,
  } as DynamoDBDeps;
}

/** Reset the DynamoDBDB singleton between tests. */
export function resetInstance() {
  DynamoDBDB.instance = undefined;
}

/** Build a DynamoDBDB with a pre-wired mock client. */
export function buildDb(deps: DynamoDBDeps) {
  const db = new DynamoDBDB(deps);
  const mockClient = {
    send: sinon.stub().resolves({ Items: [], LastEvaluatedKey: undefined }),
  };
  db.client = mockClient;
  return { db, mockClient };
}
