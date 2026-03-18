import QUnit from 'qunit';
import { buildTableDDL, getTopologicalOrder } from '../../../src/mysql/schema-introspector.js';
import { diffSnapshots } from '../../../src/mysql/migration-generator.js';

const { module, test } = QUnit;

// Schemas that mirror the smart-lock-backend models (all string PKs)
function smartLockSchemas() {
  return {
    user: {
      table: 'users',
      idType: 'string',
      columns: { password: 'VARCHAR(255)', selectedDevice: 'VARCHAR(255)' },
      foreignKeys: {},
      relationships: { belongsTo: {}, hasMany: { device: true, session: true } },
    },
    device: {
      table: 'devices',
      idType: 'string',
      columns: {},
      foreignKeys: { user_id: { references: 'users', column: 'id' } },
      relationships: { belongsTo: { user: true }, hasMany: { 'access-link': true } },
    },
    session: {
      table: 'sessions',
      idType: 'string',
      columns: { expiration: 'INT', selectedDevice: 'VARCHAR(255)' },
      foreignKeys: { user_id: { references: 'users', column: 'id' } },
      relationships: { belongsTo: { user: true }, hasMany: {} },
    },
    'access-link': {
      table: 'access-links',
      idType: 'string',
      columns: { expiration: 'INT', active: 'TINYINT(1)' },
      foreignKeys: { device_id: { references: 'devices', column: 'id' } },
      relationships: { belongsTo: { device: true }, hasMany: {} },
    },
  };
}

// Schemas with numeric PKs for contrast
function numericPkSchemas() {
  return {
    author: {
      table: 'authors',
      idType: 'number',
      columns: { name: 'VARCHAR(255)' },
      foreignKeys: {},
      relationships: { belongsTo: {}, hasMany: { book: true } },
    },
    book: {
      table: 'books',
      idType: 'number',
      columns: { title: 'VARCHAR(255)' },
      foreignKeys: { author_id: { references: 'authors', column: 'id' } },
      relationships: { belongsTo: { author: true }, hasMany: {} },
    },
  };
}

module('[Unit] Schema Introspector — buildTableDDL', function() {

  test('FK column uses VARCHAR(255) when referenced table has string PK', function(assert) {
    const schemas = smartLockSchemas();
    const ddl = buildTableDDL('device', schemas.device, schemas);

    assert.true(ddl.includes('`user_id` VARCHAR(255)'), 'user_id FK should be VARCHAR(255) to match users string PK');
    assert.false(ddl.includes('`user_id` INT'), 'user_id FK should NOT be INT');
  });

  test('FK column uses INT when referenced table has numeric PK', function(assert) {
    const schemas = numericPkSchemas();
    const ddl = buildTableDDL('book', schemas.book, schemas);

    assert.true(ddl.includes('`author_id` INT'), 'author_id FK should be INT to match authors numeric PK');
  });

  test('access-link DDL has correct table name access_links', function(assert) {
    const schemas = smartLockSchemas();
    const ddl = buildTableDDL('access-link', schemas['access-link'], schemas);

    assert.true(ddl.includes('`access_links`'), 'table name should be access_links (dashes converted to underscores)');
    assert.false(ddl.includes('`access-links`'), 'should not use dashes in table name');
  });

  test('FK constraint references correct table name', function(assert) {
    const schemas = smartLockSchemas();
    const ddl = buildTableDDL('access-link', schemas['access-link'], schemas);

    assert.true(
      ddl.includes('REFERENCES `devices`(`id`)'),
      'FK constraint should reference devices table'
    );
  });

  test('string PK generates VARCHAR(255) PRIMARY KEY', function(assert) {
    const schemas = smartLockSchemas();
    const ddl = buildTableDDL('user', schemas.user, schemas);

    assert.true(ddl.includes('`id` VARCHAR(255) PRIMARY KEY'), 'string PK should be VARCHAR(255)');
  });

  test('numeric PK generates INT AUTO_INCREMENT PRIMARY KEY', function(assert) {
    const schemas = numericPkSchemas();
    const ddl = buildTableDDL('author', schemas.author, schemas);

    assert.true(ddl.includes('`id` INT AUTO_INCREMENT PRIMARY KEY'), 'numeric PK should be INT AUTO_INCREMENT');
  });
});

module('[Unit] Schema Introspector — getTopologicalOrder', function() {

  test('parent tables come before child tables', function(assert) {
    const schemas = smartLockSchemas();
    const order = getTopologicalOrder(schemas);

    const userIdx = order.indexOf('user');
    const deviceIdx = order.indexOf('device');
    const sessionIdx = order.indexOf('session');
    const linkIdx = order.indexOf('access-link');

    assert.true(userIdx < deviceIdx, 'user should come before device');
    assert.true(userIdx < sessionIdx, 'user should come before session');
    assert.true(deviceIdx < linkIdx, 'device should come before access-link');
  });

  test('all models are included in order', function(assert) {
    const schemas = smartLockSchemas();
    const order = getTopologicalOrder(schemas);

    assert.strictEqual(order.length, 4, 'should include all 4 models');
    assert.true(order.includes('user'), 'includes user');
    assert.true(order.includes('device'), 'includes device');
    assert.true(order.includes('session'), 'includes session');
    assert.true(order.includes('access-link'), 'includes access-link');
  });
});

module('[Unit] Migration Generator — diffSnapshots', function() {

  test('detects added models from empty previous snapshot', function(assert) {
    const current = {
      user: { table: 'users', idType: 'string', columns: { password: 'VARCHAR(255)' }, foreignKeys: {} },
      device: { table: 'devices', idType: 'string', columns: {}, foreignKeys: { user_id: { references: 'users', column: 'id' } } },
    };

    const diff = diffSnapshots({}, current);

    assert.true(diff.hasChanges, 'should detect changes');
    assert.strictEqual(diff.addedModels.length, 2, 'should have 2 added models');
    assert.true(diff.addedModels.includes('user'), 'includes user');
    assert.true(diff.addedModels.includes('device'), 'includes device');
  });

  test('detects added foreign keys on existing models', function(assert) {
    const previous = {
      user: { table: 'users', idType: 'string', columns: { password: 'VARCHAR(255)' }, foreignKeys: {} },
      device: { table: 'devices', idType: 'string', columns: {}, foreignKeys: {} },
    };
    const current = {
      user: { table: 'users', idType: 'string', columns: { password: 'VARCHAR(255)' }, foreignKeys: {} },
      device: { table: 'devices', idType: 'string', columns: {}, foreignKeys: { user_id: { references: 'users', column: 'id' } } },
    };

    const diff = diffSnapshots(previous, current);

    assert.true(diff.hasChanges, 'should detect changes');
    assert.strictEqual(diff.addedForeignKeys.length, 1, 'should have 1 added FK');
    assert.strictEqual(diff.addedForeignKeys[0].column, 'user_id', 'FK column is user_id');
  });
});
