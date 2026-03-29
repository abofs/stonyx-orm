import QUnit from 'qunit';
import { getPostgresType } from '../../../src/postgres/type-map.js';

const { module, test } = QUnit;

module('[Unit] Postgres Type Map — getPostgresType', function () {
  test('returns correct Postgres types for all built-in ORM types', function (assert) {
    assert.strictEqual(getPostgresType('string'), 'VARCHAR(255)');
    assert.strictEqual(getPostgresType('number'), 'INTEGER');
    assert.strictEqual(getPostgresType('float'), 'DOUBLE PRECISION');
    assert.strictEqual(getPostgresType('boolean'), 'BOOLEAN');
    assert.strictEqual(getPostgresType('date'), 'TIMESTAMPTZ');
    assert.strictEqual(getPostgresType('timestamp'), 'BIGINT');
    assert.strictEqual(getPostgresType('passthrough'), 'TEXT');
    assert.strictEqual(getPostgresType('trim'), 'VARCHAR(255)');
    assert.strictEqual(getPostgresType('uppercase'), 'VARCHAR(255)');
    assert.strictEqual(getPostgresType('ceil'), 'INTEGER');
    assert.strictEqual(getPostgresType('floor'), 'INTEGER');
    assert.strictEqual(getPostgresType('round'), 'INTEGER');
  });

  test('built-in types ignore transformFn even if it has postgresType', function (assert) {
    const transformFn = (v) => v;
    transformFn.postgresType = 'BYTEA';
    assert.strictEqual(getPostgresType('string', transformFn), 'VARCHAR(255)');
  });

  test('custom transform with postgresType property uses declared type', function (assert) {
    const intTransform = (v) => parseInt(v);
    intTransform.postgresType = 'INTEGER';
    assert.strictEqual(getPostgresType('animal', intTransform), 'INTEGER');
  });

  test('custom transform without postgresType defaults to JSONB', function (assert) {
    const transform = (v) => ({ parsed: v });
    assert.strictEqual(getPostgresType('customObj', transform), 'JSONB');
  });

  test('unknown type with no transformFn defaults to JSONB', function (assert) {
    assert.strictEqual(getPostgresType('unknownType'), 'JSONB');
    assert.strictEqual(getPostgresType('unknownType', undefined), 'JSONB');
    assert.strictEqual(getPostgresType('unknownType', null), 'JSONB');
  });
});
