import QUnit from 'qunit';
import { buildTableDDL, getTopologicalOrder, schemasToSnapshot } from '../../../src/postgres/schema-introspector.js';

const { module, test } = QUnit;

function stringPkSchemas() {
  return {
    user: {
      table: 'users', idType: 'string',
      columns: { password: 'VARCHAR(255)' },
      foreignKeys: {},
      relationships: { belongsTo: {}, hasMany: { device: true } },
    },
    device: {
      table: 'devices', idType: 'string',
      columns: {},
      foreignKeys: { user_id: { references: 'users', column: 'id' } },
      relationships: { belongsTo: { user: true }, hasMany: {} },
    },
  };
}

function numericPkSchemas() {
  return {
    author: {
      table: 'authors', idType: 'number',
      columns: { name: 'VARCHAR(255)' },
      foreignKeys: {},
      relationships: { belongsTo: {}, hasMany: { book: true } },
    },
    book: {
      table: 'books', idType: 'number',
      columns: { title: 'VARCHAR(255)' },
      foreignKeys: { author_id: { references: 'authors', column: 'id' } },
      relationships: { belongsTo: { author: true }, hasMany: {} },
    },
  };
}

module('[Unit] Postgres Schema Introspector — buildTableDDL', function () {
  test('string PK generates VARCHAR(255) PRIMARY KEY', function (assert) {
    const schemas = stringPkSchemas();
    const ddl = buildTableDDL('user', schemas.user, schemas);
    assert.true(ddl.includes('"id" VARCHAR(255) PRIMARY KEY'));
  });

  test('numeric PK generates INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY', function (assert) {
    const schemas = numericPkSchemas();
    const ddl = buildTableDDL('author', schemas.author, schemas);
    assert.true(ddl.includes('"id" INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY'));
  });

  test('FK column uses VARCHAR(255) when referenced table has string PK', function (assert) {
    const schemas = stringPkSchemas();
    const ddl = buildTableDDL('device', schemas.device, schemas);
    assert.true(ddl.includes('"user_id" VARCHAR(255)'));
  });

  test('FK column uses INTEGER when referenced table has numeric PK', function (assert) {
    const schemas = numericPkSchemas();
    const ddl = buildTableDDL('book', schemas.book, schemas);
    assert.true(ddl.includes('"author_id" INTEGER'));
  });

  test('includes TIMESTAMPTZ timestamps', function (assert) {
    const schemas = stringPkSchemas();
    const ddl = buildTableDDL('user', schemas.user, schemas);
    assert.true(ddl.includes('"created_at" TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP'));
    assert.true(ddl.includes('"updated_at" TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP'));
    assert.false(ddl.includes('ON UPDATE'), 'no ON UPDATE clause for Postgres');
  });

  test('uses double quotes not backticks', function (assert) {
    const schemas = stringPkSchemas();
    const ddl = buildTableDDL('user', schemas.user, schemas);
    assert.false(ddl.includes('`'), 'no backticks in Postgres DDL');
    assert.true(ddl.includes('"users"'), 'table name double-quoted');
  });

  test('includes FK constraint with ON DELETE SET NULL', function (assert) {
    const schemas = stringPkSchemas();
    const ddl = buildTableDDL('device', schemas.device, schemas);
    assert.true(ddl.includes('FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL'));
  });

  test('sanitizes hyphenated table names to underscores', function (assert) {
    const schemas = {
      'access-link': {
        table: 'access_links', idType: 'string',
        columns: { active: 'BOOLEAN' },
        foreignKeys: {},
        relationships: { belongsTo: {}, hasMany: {} },
      },
    };
    const ddl = buildTableDDL('access-link', schemas['access-link'], schemas);
    assert.true(ddl.includes('"access_links"'));
  });
});

module('[Unit] Postgres Schema Introspector — getTopologicalOrder', function () {
  test('parent tables come before child tables', function (assert) {
    const schemas = stringPkSchemas();
    const order = getTopologicalOrder(schemas);
    assert.true(order.indexOf('user') < order.indexOf('device'));
  });

  test('all models are included', function (assert) {
    const schemas = stringPkSchemas();
    const order = getTopologicalOrder(schemas);
    assert.strictEqual(order.length, 2);
    assert.true(order.includes('user'));
    assert.true(order.includes('device'));
  });
});

module('[Unit] Postgres Schema Introspector — schemasToSnapshot', function () {
  test('includes timeSeries and compression fields in snapshot', function (assert) {
    const schemas = {
      event: {
        table: 'events', idType: 'number',
        columns: { timestamp: 'TIMESTAMPTZ' },
        foreignKeys: {},
        relationships: { belongsTo: {}, hasMany: {} },
        timeSeries: 'timestamp',
        compression: { after: '7d' },
      },
    };
    const snapshot = schemasToSnapshot(schemas);
    assert.strictEqual(snapshot.event.timeSeries, 'timestamp');
    assert.deepEqual(snapshot.event.compression, { after: '7d' });
  });

  test('omits timeSeries and compression when not present', function (assert) {
    const schemas = {
      user: {
        table: 'users', idType: 'string',
        columns: { name: 'VARCHAR(255)' },
        foreignKeys: {},
        relationships: { belongsTo: {}, hasMany: {} },
        timeSeries: null,
        compression: null,
      },
    };
    const snapshot = schemasToSnapshot(schemas);
    assert.strictEqual(snapshot.user.timeSeries, undefined);
    assert.strictEqual(snapshot.user.compression, undefined);
  });
});
