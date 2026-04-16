// @ts-nocheck
import QUnit from 'qunit';
import { buildTableDDL, buildVectorIndexDDL, getTopologicalOrder, schemasToSnapshot } from '../../../src/postgres/schema-introspector.js';

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
      columns: { expiration: 'INTEGER', selectedDevice: 'VARCHAR(255)' },
      foreignKeys: { user_id: { references: 'users', column: 'id' } },
      relationships: { belongsTo: { user: true }, hasMany: {} },
    },
    'access-link': {
      table: 'access_links',
      idType: 'string',
      columns: { expiration: 'INTEGER', active: 'BOOLEAN' },
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

module('[Unit] Postgres Schema Introspector — buildTableDDL', function() {

  test('FK column uses VARCHAR(255) when referenced table has string PK', function(assert) {
    const schemas = smartLockSchemas();
    const ddl = buildTableDDL('device', schemas.device, schemas);

    assert.true(ddl.includes('"user_id" VARCHAR(255)'), 'user_id FK should be VARCHAR(255) to match users string PK');
    assert.false(ddl.includes('"user_id" INTEGER'), 'user_id FK should NOT be INTEGER');
  });

  test('FK column uses INTEGER when referenced table has numeric PK', function(assert) {
    const schemas = numericPkSchemas();
    const ddl = buildTableDDL('book', schemas.book, schemas);

    assert.true(ddl.includes('"author_id" INTEGER'), 'author_id FK should be INTEGER to match authors numeric PK');
  });

  test('string PK uses VARCHAR(255) PRIMARY KEY', function(assert) {
    const schemas = smartLockSchemas();
    const ddl = buildTableDDL('user', schemas.user, schemas);

    assert.true(ddl.includes('"id" VARCHAR(255) PRIMARY KEY'), 'string PK uses VARCHAR');
  });

  test('numeric PK uses INTEGER GENERATED ALWAYS AS IDENTITY', function(assert) {
    const schemas = numericPkSchemas();
    const ddl = buildTableDDL('author', schemas.author, schemas);

    assert.true(ddl.includes('"id" INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY'), 'numeric PK uses IDENTITY');
  });

  test('includes TIMESTAMPTZ timestamp columns', function(assert) {
    const schemas = numericPkSchemas();
    const ddl = buildTableDDL('author', schemas.author, schemas);

    assert.true(ddl.includes('"created_at" TIMESTAMPTZ DEFAULT NOW()'), 'created_at uses TIMESTAMPTZ');
    assert.true(ddl.includes('"updated_at" TIMESTAMPTZ DEFAULT NOW()'), 'updated_at uses TIMESTAMPTZ');
  });

  test('includes FK constraints with ON DELETE SET NULL', function(assert) {
    const schemas = numericPkSchemas();
    const ddl = buildTableDDL('book', schemas.book, schemas);

    assert.true(ddl.includes('FOREIGN KEY ("author_id") REFERENCES "authors"("id") ON DELETE SET NULL'), 'FK constraint present');
  });

  test('uses double-quoted identifiers (not backticks)', function(assert) {
    const schemas = numericPkSchemas();
    const ddl = buildTableDDL('author', schemas.author, schemas);

    assert.false(ddl.includes('`'), 'no backticks in DDL');
    assert.true(ddl.includes('"authors"'), 'table name double-quoted');
  });

  test('handles vector columns', function(assert) {
    const schemas = {
      document: {
        table: 'documents',
        idType: 'number',
        columns: { title: 'VARCHAR(255)', embedding: 'vector(1536)' },
        foreignKeys: {},
        relationships: { belongsTo: {}, hasMany: {} },
      },
    };
    const ddl = buildTableDDL('document', schemas.document, schemas);

    assert.true(ddl.includes('"embedding" vector(1536)'), 'vector column included in DDL');
  });
});

module('[Unit] Postgres Schema Introspector — buildVectorIndexDDL', function() {

  test('generates HNSW index for vector columns', function(assert) {
    const schema = {
      table: 'documents',
      idType: 'number',
      columns: {},
      foreignKeys: {},
      relationships: { belongsTo: {}, hasMany: {} },
      vectorColumns: { embedding: 1536 },
    };

    const statements = buildVectorIndexDDL('document', schema);

    assert.strictEqual(statements.length, 1, 'one index statement');
    assert.true(statements[0].includes('CREATE INDEX IF NOT EXISTS'), 'uses CREATE INDEX IF NOT EXISTS');
    assert.true(statements[0].includes('USING hnsw'), 'uses HNSW index type');
    assert.true(statements[0].includes('"embedding" vector_cosine_ops'), 'uses cosine distance ops');
    assert.true(statements[0].includes('m = 16'), 'includes m parameter');
    assert.true(statements[0].includes('ef_construction = 200'), 'includes ef_construction parameter');
  });

  test('generates multiple indexes for multiple vector columns', function(assert) {
    const schema = {
      table: 'documents',
      idType: 'number',
      columns: {},
      foreignKeys: {},
      relationships: { belongsTo: {}, hasMany: {} },
      vectorColumns: { embedding: 1536, summary_embedding: 768 },
    };

    const statements = buildVectorIndexDDL('document', schema);

    assert.strictEqual(statements.length, 2, 'two index statements');
  });

  test('returns empty array when no vector columns', function(assert) {
    const schema = {
      table: 'documents',
      idType: 'number',
      columns: {},
      foreignKeys: {},
      relationships: { belongsTo: {}, hasMany: {} },
    };

    const statements = buildVectorIndexDDL('document', schema);

    assert.strictEqual(statements.length, 0, 'no index statements');
  });
});

module('[Unit] Postgres Schema Introspector — getTopologicalOrder', function() {

  test('orders parent tables before child tables', function(assert) {
    const schemas = numericPkSchemas();
    const order = getTopologicalOrder(schemas);

    const authorIdx = order.indexOf('author');
    const bookIdx = order.indexOf('book');

    assert.true(authorIdx < bookIdx, 'author comes before book (book belongsTo author)');
  });

  test('handles deep dependency chains', function(assert) {
    const schemas = smartLockSchemas();
    const order = getTopologicalOrder(schemas);

    const userIdx = order.indexOf('user');
    const deviceIdx = order.indexOf('device');
    const accessLinkIdx = order.indexOf('access-link');

    assert.true(userIdx < deviceIdx, 'user before device');
    assert.true(deviceIdx < accessLinkIdx, 'device before access-link');
  });

  test('includes all models in output', function(assert) {
    const schemas = smartLockSchemas();
    const order = getTopologicalOrder(schemas);

    assert.strictEqual(order.length, 4, 'all 4 models included');
    assert.true(order.includes('user'), 'user included');
    assert.true(order.includes('device'), 'device included');
    assert.true(order.includes('session'), 'session included');
    assert.true(order.includes('access-link'), 'access-link included');
  });
});

module('[Unit] Postgres Schema Introspector — schemasToSnapshot', function() {

  test('generates snapshot with table, idType, columns, foreignKeys', function(assert) {
    const schemas = numericPkSchemas();
    const snapshot = schemasToSnapshot(schemas);

    assert.strictEqual(snapshot.author.table, 'authors');
    assert.strictEqual(snapshot.author.idType, 'number');
    assert.deepEqual(snapshot.author.columns, { name: 'VARCHAR(255)' });
    assert.deepEqual(snapshot.author.foreignKeys, {});
  });

  test('includes vectorColumns in snapshot when present', function(assert) {
    const schemas = {
      document: {
        table: 'documents',
        idType: 'number',
        columns: { title: 'VARCHAR(255)' },
        foreignKeys: {},
        relationships: { belongsTo: {}, hasMany: {} },
        vectorColumns: { embedding: 1536 },
        memory: false,
      },
    };

    const snapshot = schemasToSnapshot(schemas);

    assert.deepEqual(snapshot.document.vectorColumns, { embedding: 1536 }, 'vectorColumns included');
  });

  test('omits vectorColumns when empty', function(assert) {
    const schemas = numericPkSchemas();
    const snapshot = schemasToSnapshot(schemas);

    assert.strictEqual(snapshot.author.vectorColumns, undefined, 'no vectorColumns key');
  });

  test('includes hypertable config in snapshot when present', function(assert) {
    const schemas = {
      'stat-snapshot': {
        table: 'stat_snapshots',
        idType: 'number',
        columns: { minute: 'INTEGER' },
        foreignKeys: {},
        relationships: { belongsTo: {}, hasMany: {} },
        hypertable: { timeColumn: 'created_at', chunkInterval: '7 days' },
        memory: false,
      },
    };

    const snapshot = schemasToSnapshot(schemas);

    assert.deepEqual(snapshot['stat-snapshot'].hypertable, { timeColumn: 'created_at', chunkInterval: '7 days' }, 'hypertable config included');
  });

  test('omits hypertable from snapshot when absent', function(assert) {
    const schemas = numericPkSchemas();
    const snapshot = schemasToSnapshot(schemas);

    assert.strictEqual(snapshot.author.hypertable, undefined, 'no hypertable key');
  });
});

module('[Unit] Postgres Schema Introspector — buildTableDDL hypertable', function() {

  function hypertableSchema() {
    return {
      'stat-snapshot': {
        table: 'stat_snapshots',
        idType: 'number',
        columns: { minute: 'INTEGER', possession: 'REAL' },
        foreignKeys: { match_id: { references: 'matches', column: 'id' } },
        relationships: { belongsTo: { match: 'match' }, hasMany: {} },
        hypertable: { timeColumn: 'created_at', chunkInterval: '7 days' },
        memory: false,
      },
      match: {
        table: 'matches',
        idType: 'string',
        columns: { status: 'VARCHAR(255)' },
        foreignKeys: {},
        relationships: { belongsTo: {}, hasMany: {} },
        memory: false,
      },
    };
  }

  test('emits composite PK for hypertable model with numeric id', function(assert) {
    const schemas = hypertableSchema();
    const ddl = buildTableDDL('stat-snapshot', schemas['stat-snapshot'], schemas);

    assert.true(ddl.includes('PRIMARY KEY ("id", "created_at")'), 'composite PK present');
    assert.false(ddl.includes('IDENTITY PRIMARY KEY'), 'no inline PK on id column');
    assert.true(ddl.includes('"id" INTEGER GENERATED ALWAYS AS IDENTITY'), 'id still uses IDENTITY');
  });

  test('emits NOT NULL on created_at for hypertable model', function(assert) {
    const schemas = hypertableSchema();
    const ddl = buildTableDDL('stat-snapshot', schemas['stat-snapshot'], schemas);

    assert.true(ddl.includes('"created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW()'), 'created_at has NOT NULL');
  });

  test('non-hypertable model keeps inline PK unchanged', function(assert) {
    const schemas = hypertableSchema();
    const ddl = buildTableDDL('match', schemas.match, schemas);

    assert.true(ddl.includes('"id" VARCHAR(255) PRIMARY KEY'), 'inline PK on string id');
    assert.false(ddl.includes('PRIMARY KEY ("id"'), 'no table-level composite PK');
    assert.true(ddl.includes('"created_at" TIMESTAMPTZ DEFAULT NOW()'), 'created_at without NOT NULL');
  });

  test('string PK model with hypertable keeps inline PK (no composite)', function(assert) {
    const schemas = {
      event: {
        table: 'events',
        idType: 'string',
        columns: {},
        foreignKeys: {},
        relationships: { belongsTo: {}, hasMany: {} },
        hypertable: { timeColumn: 'created_at' },
        memory: false,
      },
    };
    const ddl = buildTableDDL('event', schemas.event, schemas);

    assert.true(ddl.includes('"id" VARCHAR(255) PRIMARY KEY'), 'string PK stays inline');
    assert.false(ddl.includes('PRIMARY KEY ("id", "created_at")'), 'no composite PK for string ids');
  });

  test('hypertable DDL includes FK constraints', function(assert) {
    const schemas = hypertableSchema();
    const ddl = buildTableDDL('stat-snapshot', schemas['stat-snapshot'], schemas);

    assert.true(ddl.includes('FOREIGN KEY ("match_id") REFERENCES "matches"("id") ON DELETE SET NULL'), 'FK constraint present');
  });
});
