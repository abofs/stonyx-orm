import QUnit from 'qunit';
import { getPgType, getVectorType } from '../../../src/postgres/type-map.js';

const { module, test } = QUnit;

module('[Unit] Postgres Type Map — getPgType', function() {

  test('returns correct Postgres types for all built-in ORM types', function(assert) {
    assert.strictEqual(getPgType('string'), 'VARCHAR(255)');
    assert.strictEqual(getPgType('number'), 'INTEGER');
    assert.strictEqual(getPgType('float'), 'REAL');
    assert.strictEqual(getPgType('boolean'), 'BOOLEAN');
    assert.strictEqual(getPgType('date'), 'TIMESTAMPTZ');
    assert.strictEqual(getPgType('timestamp'), 'BIGINT');
    assert.strictEqual(getPgType('passthrough'), 'TEXT');
    assert.strictEqual(getPgType('trim'), 'VARCHAR(255)');
    assert.strictEqual(getPgType('uppercase'), 'VARCHAR(255)');
    assert.strictEqual(getPgType('ceil'), 'INTEGER');
    assert.strictEqual(getPgType('floor'), 'INTEGER');
    assert.strictEqual(getPgType('round'), 'INTEGER');
  });

  test('built-in types ignore transformFn even if it has pgType', function(assert) {
    const transformFn = (v) => v;
    transformFn.pgType = 'JSONB';

    assert.strictEqual(getPgType('string', transformFn), 'VARCHAR(255)', 'built-in takes priority over transformFn.pgType');
  });

  test('custom transform with pgType property uses declared type', function(assert) {
    const intTransform = (v) => parseInt(v);
    intTransform.pgType = 'INTEGER';

    assert.strictEqual(getPgType('animal', intTransform), 'INTEGER');
  });

  test('custom transform with pgType supports any valid Postgres type', function(assert) {
    const bytesTransform = (v) => v;
    bytesTransform.pgType = 'BYTEA';

    const enumTransform = (v) => v;
    enumTransform.pgType = 'TEXT';

    assert.strictEqual(getPgType('customBytes', bytesTransform), 'BYTEA');
    assert.strictEqual(getPgType('customEnum', enumTransform), 'TEXT');
  });

  test('custom transform with mysqlType but no pgType maps via mysqlTypeToPg', function(assert) {
    const boolTransform = (v) => !!v;
    boolTransform.mysqlType = 'TINYINT(1)';

    const intTransform = (v) => parseInt(v);
    intTransform.mysqlType = 'INT';

    const dateTransform = (v) => new Date(v);
    dateTransform.mysqlType = 'DATETIME';

    const jsonTransform = (v) => JSON.parse(v);
    jsonTransform.mysqlType = 'JSON';

    assert.strictEqual(getPgType('customBool', boolTransform), 'BOOLEAN', 'TINYINT(1) maps to BOOLEAN');
    assert.strictEqual(getPgType('customInt', intTransform), 'INTEGER', 'INT maps to INTEGER');
    assert.strictEqual(getPgType('customDate', dateTransform), 'TIMESTAMPTZ', 'DATETIME maps to TIMESTAMPTZ');
    assert.strictEqual(getPgType('customJson', jsonTransform), 'JSONB', 'JSON maps to JSONB');
  });

  test('custom transform without pgType or mysqlType defaults to JSONB', function(assert) {
    const transform = (v) => ({ parsed: v });

    assert.strictEqual(getPgType('customObj', transform), 'JSONB');
  });

  test('unknown type with no transformFn defaults to JSONB', function(assert) {
    assert.strictEqual(getPgType('unknownType'), 'JSONB');
    assert.strictEqual(getPgType('unknownType', undefined), 'JSONB');
  });
});

module('[Unit] Postgres Type Map — getVectorType', function() {

  test('returns vector type with specified dimensions', function(assert) {
    assert.strictEqual(getVectorType(1536), 'vector(1536)');
    assert.strictEqual(getVectorType(768), 'vector(768)');
    assert.strictEqual(getVectorType(3), 'vector(3)');
  });

  test('handles edge case dimensions', function(assert) {
    assert.strictEqual(getVectorType(1), 'vector(1)');
    assert.strictEqual(getVectorType(4096), 'vector(4096)');
  });
});
