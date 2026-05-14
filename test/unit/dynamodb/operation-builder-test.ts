import QUnit from 'qunit';
import {
  buildPutItem,
  buildGetItem,
  buildUpdateItem,
  buildDeleteItem,
  buildScan,
  buildQuery,
} from '../../../src/dynamodb/operation-builder.js';

const { module, test } = QUnit;

module('[Unit] DynamoDB operation-builder — buildPutItem', function() {
  test('basic put with no condition', function(assert) {
    const params = buildPutItem('users', { id: '1', name: 'Alice' });

    assert.strictEqual(params.TableName, 'users');
    assert.deepEqual(params.Item, { id: '1', name: 'Alice' });
    assert.strictEqual(params.ConditionExpression, undefined, 'no condition when not provided');
  });

  test('put with condition expression', function(assert) {
    const params = buildPutItem('users', { id: '1', name: 'Alice' }, 'attribute_not_exists(id)');

    assert.strictEqual(params.ConditionExpression, 'attribute_not_exists(id)');
  });
});

module('[Unit] DynamoDB operation-builder — buildGetItem', function() {
  test('returns correct params for string key', function(assert) {
    const params = buildGetItem('sessions', { id: 'abc-123' });

    assert.strictEqual(params.TableName, 'sessions');
    assert.deepEqual(params.Key, { id: 'abc-123' });
  });

  test('returns correct params for numeric key', function(assert) {
    const params = buildGetItem('orders', { id: 42 });

    assert.deepEqual(params.Key, { id: 42 });
  });
});

module('[Unit] DynamoDB operation-builder — buildUpdateItem', function() {
  test('builds SET expression for single attribute', function(assert) {
    const params = buildUpdateItem('users', { id: '1' }, { name: 'Bob' });

    assert.strictEqual(params.TableName, 'users');
    assert.deepEqual(params.Key, { id: '1' });
    assert.strictEqual(params.UpdateExpression, 'SET #name = :name');
    assert.deepEqual(params.ExpressionAttributeNames, { '#name': 'name' });
    assert.deepEqual(params.ExpressionAttributeValues, { ':name': 'Bob' });
    assert.strictEqual(params.ReturnValues, 'NONE');
  });

  test('builds SET expression for multiple attributes', function(assert) {
    const params = buildUpdateItem('users', { id: '1' }, { name: 'Bob', age: 30 });

    // Both attributes must appear in the expression
    assert.ok(params.UpdateExpression.includes('#name = :name'), 'name attr present');
    assert.ok(params.UpdateExpression.includes('#age = :age'), 'age attr present');
    assert.ok(params.UpdateExpression.startsWith('SET '), 'starts with SET');
    assert.strictEqual(Object.keys(params.ExpressionAttributeNames).length, 2, '2 name aliases');
    assert.strictEqual(Object.keys(params.ExpressionAttributeValues).length, 2, '2 value aliases');
  });

  test('preserves null values in updates', function(assert) {
    const params = buildUpdateItem('users', { id: '1' }, { deletedAt: null });

    assert.strictEqual(params.ExpressionAttributeValues[':deletedAt'], null, 'null value preserved');
  });
});

module('[Unit] DynamoDB operation-builder — buildDeleteItem', function() {
  test('returns correct params', function(assert) {
    const params = buildDeleteItem('sessions', { id: 'abc' });

    assert.strictEqual(params.TableName, 'sessions');
    assert.deepEqual(params.Key, { id: 'abc' });
  });
});

module('[Unit] DynamoDB operation-builder — buildScan', function() {
  test('scan with no conditions', function(assert) {
    const params = buildScan('alerts');

    assert.strictEqual(params.TableName, 'alerts');
    assert.strictEqual(params.FilterExpression, undefined, 'no filter');
    assert.strictEqual(params.ExclusiveStartKey, undefined, 'no start key');
  });

  test('scan with conditions produces FilterExpression', function(assert) {
    const params = buildScan('alerts', { status: 'active' });

    assert.ok(params.FilterExpression, 'FilterExpression set');
    assert.ok(params.FilterExpression.includes('#status = :status'));
    assert.deepEqual(params.ExpressionAttributeNames, { '#status': 'status' });
    assert.deepEqual(params.ExpressionAttributeValues, { ':status': 'active' });
  });

  test('scan with multiple conditions joins them with AND', function(assert) {
    const params = buildScan('alerts', { status: 'active', type: 'goal' });

    assert.ok(params.FilterExpression.includes(' AND '), 'conditions joined with AND');
    assert.strictEqual(Object.keys(params.ExpressionAttributeNames).length, 2);
  });

  test('scan with exclusiveStartKey for pagination', function(assert) {
    const startKey = { id: 'last-seen-id' };
    const params = buildScan('alerts', undefined, startKey);

    assert.deepEqual(params.ExclusiveStartKey, startKey);
    assert.strictEqual(params.FilterExpression, undefined, 'no filter expression');
  });
});

module('[Unit] DynamoDB operation-builder — buildQuery', function() {
  test('builds query for single GSI key condition', function(assert) {
    const params = buildQuery('sessions', 'user-index', { userId: 'u1' });

    assert.strictEqual(params.TableName, 'sessions');
    assert.strictEqual(params.IndexName, 'user-index');
    assert.ok(params.KeyConditionExpression.includes('#userId = :userId'));
    assert.deepEqual(params.ExpressionAttributeNames, { '#userId': 'userId' });
    assert.deepEqual(params.ExpressionAttributeValues, { ':userId': 'u1' });
    assert.strictEqual(params.ExclusiveStartKey, undefined);
  });

  test('builds query for multiple GSI key conditions joined with AND', function(assert) {
    const params = buildQuery('orders', 'user-status-index', { userId: 'u1', status: 'open' });

    assert.ok(params.KeyConditionExpression.includes(' AND '), 'AND present for composite key');
    assert.strictEqual(Object.keys(params.ExpressionAttributeNames).length, 2);
  });

  test('passes pagination key through', function(assert) {
    const startKey = { id: 'tok123' };
    const params = buildQuery('sessions', 'user-index', { userId: 'u1' }, startKey);

    assert.deepEqual(params.ExclusiveStartKey, startKey);
  });
});
