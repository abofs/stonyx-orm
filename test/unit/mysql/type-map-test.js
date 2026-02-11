import QUnit from 'qunit';
import { getMysqlType } from '../../../src/mysql/type-map.js';

const { module, test } = QUnit;

module('[Unit] Type Map — getMysqlType', function() {

  test('returns correct MySQL types for all built-in ORM types', function(assert) {
    assert.strictEqual(getMysqlType('string'), 'VARCHAR(255)');
    assert.strictEqual(getMysqlType('number'), 'INT');
    assert.strictEqual(getMysqlType('float'), 'FLOAT');
    assert.strictEqual(getMysqlType('boolean'), 'TINYINT(1)');
    assert.strictEqual(getMysqlType('date'), 'DATETIME');
    assert.strictEqual(getMysqlType('timestamp'), 'BIGINT');
    assert.strictEqual(getMysqlType('passthrough'), 'TEXT');
    assert.strictEqual(getMysqlType('trim'), 'VARCHAR(255)');
    assert.strictEqual(getMysqlType('uppercase'), 'VARCHAR(255)');
    assert.strictEqual(getMysqlType('ceil'), 'INT');
    assert.strictEqual(getMysqlType('floor'), 'INT');
    assert.strictEqual(getMysqlType('round'), 'INT');
  });

  test('built-in types ignore transformFn even if it has mysqlType', function(assert) {
    const transformFn = (v) => v;
    transformFn.mysqlType = 'BLOB';

    assert.strictEqual(getMysqlType('string', transformFn), 'VARCHAR(255)', 'built-in takes priority over transformFn.mysqlType');
  });

  test('custom transform with mysqlType property uses declared type', function(assert) {
    const intTransform = (v) => parseInt(v);
    intTransform.mysqlType = 'INT';

    assert.strictEqual(getMysqlType('animal', intTransform), 'INT');
  });

  test('custom transform with mysqlType supports any valid MySQL type', function(assert) {
    const blobTransform = (v) => v;
    blobTransform.mysqlType = 'MEDIUMBLOB';

    const enumTransform = (v) => v;
    enumTransform.mysqlType = "ENUM('a','b','c')";

    assert.strictEqual(getMysqlType('customBlob', blobTransform), 'MEDIUMBLOB');
    assert.strictEqual(getMysqlType('customEnum', enumTransform), "ENUM('a','b','c')");
  });

  test('custom transform without mysqlType defaults to JSON', function(assert) {
    const transform = (v) => ({ parsed: v });

    assert.strictEqual(getMysqlType('customObj', transform), 'JSON');
  });

  test('unknown type with no transformFn defaults to JSON', function(assert) {
    assert.strictEqual(getMysqlType('unknownType'), 'JSON');
    assert.strictEqual(getMysqlType('unknownType', undefined), 'JSON');
    assert.strictEqual(getMysqlType('unknownType', null), 'JSON');
  });
});
