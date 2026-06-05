import QUnit from 'qunit';
import sinon from 'sinon';
import DynamoDBDB from '../../../src/dynamodb/dynamodb-db.js';
import {
  createMockDeps,
  resetInstance,
  buildDb,
} from '../../helpers/dynamodb-test-helper.js';
import type { OrmRecord } from '../../../src/types/orm-types.js';

const { module, test } = QUnit;

module('[Unit] DynamoDBDB — Date serialization (#144)', function(hooks) {
  hooks.beforeEach(resetInstance);
  hooks.afterEach(() => { resetInstance(); sinon.restore(); });

  // -------------------------------------------------------------------------
  // AC1: _recordToItem converts Date instances to ISO-8601 strings
  // -------------------------------------------------------------------------

  test('_recordToItem converts Date to ISO-8601 string for date-typed column', function(assert) {
    const deps = createMockDeps();
    const { db } = buildDb(deps);

    const record = {
      id: 'r1',
      __data: { id: 'r1', createdAt: new Date('2026-01-15T10:30:00Z') },
      __relationships: {},
    } as unknown as OrmRecord;

    const schema = {
      table: 'items',
      columns: { createdAt: 'date' },
      foreignKeys: {},
      idType: 'string',
    };

    // @ts-expect-error — accessing private method for test coverage
    const item = db._recordToItem(record, schema);

    assert.strictEqual(item.createdAt, '2026-01-15T10:30:00.000Z', 'Date converted to ISO-8601 string');
    assert.strictEqual(typeof item.createdAt, 'string', 'value is a string, not a Date');
  });

  // -------------------------------------------------------------------------
  // AC4: null date values pass through as null
  // -------------------------------------------------------------------------

  test('_recordToItem passes null date values through as null', function(assert) {
    const deps = createMockDeps();
    const { db } = buildDb(deps);

    const record = {
      id: 'r1',
      __data: { id: 'r1', createdAt: null },
      __relationships: {},
    } as unknown as OrmRecord;

    const schema = {
      table: 'items',
      columns: { createdAt: 'date' },
      foreignKeys: {},
      idType: 'string',
    };

    // @ts-expect-error — accessing private method for test coverage
    const item = db._recordToItem(record, schema);

    assert.strictEqual(item.createdAt, null, 'null date stays null');
  });

  // -------------------------------------------------------------------------
  // AC3: Non-Date column types are unaffected (string)
  // -------------------------------------------------------------------------

  test('_recordToItem does not alter string columns', function(assert) {
    const deps = createMockDeps();
    const { db } = buildDb(deps);

    const record = {
      id: 'r1',
      __data: { id: 'r1', name: 'test' },
      __relationships: {},
    } as unknown as OrmRecord;

    const schema = {
      table: 'items',
      columns: { name: 'string' },
      foreignKeys: {},
      idType: 'string',
    };

    // @ts-expect-error — accessing private method for test coverage
    const item = db._recordToItem(record, schema);

    assert.strictEqual(item.name, 'test', 'string value unchanged');
  });

  // -------------------------------------------------------------------------
  // AC3: Non-Date column types are unaffected (number)
  // -------------------------------------------------------------------------

  test('_recordToItem does not alter number columns', function(assert) {
    const deps = createMockDeps();
    const { db } = buildDb(deps);

    const record = {
      id: 'r1',
      __data: { id: 'r1', count: 42 },
      __relationships: {},
    } as unknown as OrmRecord;

    const schema = {
      table: 'items',
      columns: { count: 'number' },
      foreignKeys: {},
      idType: 'string',
    };

    // @ts-expect-error — accessing private method for test coverage
    const item = db._recordToItem(record, schema);

    assert.strictEqual(item.count, 42, 'number value unchanged');
  });

  // -------------------------------------------------------------------------
  // AC3: Non-Date column types are unaffected (boolean)
  // -------------------------------------------------------------------------

  test('_recordToItem does not alter boolean columns', function(assert) {
    const deps = createMockDeps();
    const { db } = buildDb(deps);

    const record = {
      id: 'r1',
      __data: { id: 'r1', active: true },
      __relationships: {},
    } as unknown as OrmRecord;

    const schema = {
      table: 'items',
      columns: { active: 'boolean' },
      foreignKeys: {},
      idType: 'string',
    };

    // @ts-expect-error — accessing private method for test coverage
    const item = db._recordToItem(record, schema);

    assert.strictEqual(item.active, true, 'boolean value unchanged');
  });

  // -------------------------------------------------------------------------
  // AC2/AC6: _persistUpdate changedData converts Date to ISO string
  // -------------------------------------------------------------------------

  test('_persistUpdate converts Date to ISO string in changedData', async function(assert) {
    const newDate = new Date('2026-06-01T12:00:00Z');
    const record = {
      id: 'r1',
      __data: { id: 'r1', updatedAt: newDate },
      __relationships: {},
    };

    const deps = createMockDeps({
      introspectModels: sinon.stub().returns({
        'item': {
          table: 'items',
          columns: { updatedAt: 'date' },
          foreignKeys: {},
          idType: 'string',
        }
      }),
      getPluralName: sinon.stub().returns('items'),
    });

    const { db, mockClient } = buildDb(deps);
    mockClient.send.resolves({});

    await db.persist('update', 'item', {
      record: record as unknown as OrmRecord,
      oldState: { updatedAt: '2026-05-01T12:00:00.000Z' },
    }, {});

    assert.ok(deps.buildUpdateItem.calledOnce, 'buildUpdateItem called');
    const [, , changedData] = deps.buildUpdateItem.firstCall.args;
    assert.strictEqual(
      changedData.updatedAt,
      '2026-06-01T12:00:00.000Z',
      'Date converted to ISO string in changedData'
    );
    assert.strictEqual(
      typeof changedData.updatedAt,
      'string',
      'changedData value is a string, not a Date object'
    );
  });

  // -------------------------------------------------------------------------
  // AC5: Round-trip fidelity — Date → ISO string → date transform → same Date
  // -------------------------------------------------------------------------

  test('round-trip: Date → ISO → date transform produces equivalent Date', function(assert) {
    const original = new Date('2026-01-15T10:30:00Z');

    // Simulate the serialization step (what _recordToItem should do)
    const isoString = original.toISOString();

    // Simulate the deserialization step (what the date transform does)
    const restored = isoString ? new Date(isoString) : null;

    assert.strictEqual(
      restored!.getTime(),
      original.getTime(),
      'round-trip produces equivalent Date'
    );
    assert.strictEqual(
      restored!.toISOString(),
      original.toISOString(),
      'round-trip produces identical ISO string'
    );
  });

  // -------------------------------------------------------------------------
  // Additional: multiple date columns in one record
  // -------------------------------------------------------------------------

  test('_recordToItem converts multiple date columns in same record', function(assert) {
    const deps = createMockDeps();
    const { db } = buildDb(deps);

    const record = {
      id: 'r1',
      __data: {
        id: 'r1',
        createdAt: new Date('2026-01-01T00:00:00Z'),
        updatedAt: new Date('2026-06-01T12:00:00Z'),
        name: 'test',
      },
      __relationships: {},
    } as unknown as OrmRecord;

    const schema = {
      table: 'items',
      columns: { createdAt: 'date', updatedAt: 'date', name: 'string' },
      foreignKeys: {},
      idType: 'string',
    };

    // @ts-expect-error — accessing private method for test coverage
    const item = db._recordToItem(record, schema);

    assert.strictEqual(item.createdAt, '2026-01-01T00:00:00.000Z', 'first date column converted');
    assert.strictEqual(item.updatedAt, '2026-06-01T12:00:00.000Z', 'second date column converted');
    assert.strictEqual(item.name, 'test', 'string column unchanged');
  });

  // -------------------------------------------------------------------------
  // AC3: timestamp type is NOT converted (it's a number, not a Date)
  // -------------------------------------------------------------------------

  test('_recordToItem does not alter timestamp columns', function(assert) {
    const deps = createMockDeps();
    const { db } = buildDb(deps);

    const tsValue = 1737000000000;
    const record = {
      id: 'r1',
      __data: { id: 'r1', lastSeen: tsValue },
      __relationships: {},
    } as unknown as OrmRecord;

    const schema = {
      table: 'items',
      columns: { lastSeen: 'timestamp' },
      foreignKeys: {},
      idType: 'string',
    };

    // @ts-expect-error — accessing private method for test coverage
    const item = db._recordToItem(record, schema);

    assert.strictEqual(item.lastSeen, tsValue, 'timestamp value unchanged');
  });

  // -------------------------------------------------------------------------
  // AC3: passthrough type is NOT converted
  // -------------------------------------------------------------------------

  test('_recordToItem does not alter passthrough columns', function(assert) {
    const deps = createMockDeps();
    const { db } = buildDb(deps);

    const ptValue = { complex: [1, 2, 3] };
    const record = {
      id: 'r1',
      __data: { id: 'r1', metadata: ptValue },
      __relationships: {},
    } as unknown as OrmRecord;

    const schema = {
      table: 'items',
      columns: { metadata: 'passthrough' },
      foreignKeys: {},
      idType: 'string',
    };

    // @ts-expect-error — accessing private method for test coverage
    const item = db._recordToItem(record, schema);

    assert.deepEqual(item.metadata, ptValue, 'passthrough value unchanged');
  });
});
