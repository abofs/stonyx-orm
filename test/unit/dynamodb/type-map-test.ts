// @ts-nocheck
import QUnit from 'qunit';
import { getDynamoType, getDynamoKeyType } from '../../../src/dynamodb/type-map.js';

const { module, test } = QUnit;

module('[Unit] DynamoDB type-map — getDynamoType', function() {
  test('string maps to S', function(assert) {
    assert.strictEqual(getDynamoType('string'), 'S');
  });

  test('number maps to N', function(assert) {
    assert.strictEqual(getDynamoType('number'), 'N');
  });

  test('float maps to N', function(assert) {
    assert.strictEqual(getDynamoType('float'), 'N');
  });

  test('boolean maps to BOOL', function(assert) {
    assert.strictEqual(getDynamoType('boolean'), 'BOOL');
  });

  test('date maps to S (ISO-8601 string for range queries)', function(assert) {
    assert.strictEqual(getDynamoType('date'), 'S');
  });

  test('timestamp maps to N', function(assert) {
    assert.strictEqual(getDynamoType('timestamp'), 'N');
  });

  test('passthrough maps to S', function(assert) {
    assert.strictEqual(getDynamoType('passthrough'), 'S');
  });

  test('unknown type defaults to S', function(assert) {
    assert.strictEqual(getDynamoType('customTransform'), 'S');
    assert.strictEqual(getDynamoType(''), 'S');
  });
});

module('[Unit] DynamoDB type-map — getDynamoKeyType', function() {
  test('string maps to S key type', function(assert) {
    assert.strictEqual(getDynamoKeyType('string'), 'S');
  });

  test('number maps to N key type', function(assert) {
    assert.strictEqual(getDynamoKeyType('number'), 'N');
  });

  test('float maps to N key type', function(assert) {
    assert.strictEqual(getDynamoKeyType('float'), 'N');
  });

  test('boolean falls back to S key type (BOOL cannot be a key attribute)', function(assert) {
    assert.strictEqual(getDynamoKeyType('boolean'), 'S');
  });

  test('date maps to S key type', function(assert) {
    assert.strictEqual(getDynamoKeyType('date'), 'S');
  });

  test('unknown type falls back to S key type', function(assert) {
    assert.strictEqual(getDynamoKeyType('anything'), 'S');
  });
});
