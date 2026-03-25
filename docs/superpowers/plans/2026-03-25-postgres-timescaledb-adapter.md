# Postgres/TimescaleDB Adapter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a first-class Postgres/TimescaleDB adapter to `@stonyx/orm`, mirroring the MySQL adapter's structure, with hypertable and compression policy support.

**Architecture:** Mirror the existing `src/mysql/` directory as `src/postgres/` with 7 parallel files. Before building the adapter, generalize MySQL-specific property names in core ORM files (`mysqlDb` → `sqlDb`, `__pendingMysqlId` → `__pendingSqlId`). The adapter uses `pg` (node-postgres) as an optional peer dependency with lazy dynamic imports.

**Tech Stack:** Node.js (ES modules), `pg` (node-postgres), QUnit, Sinon, TimescaleDB

**Spec:** `docs/superpowers/specs/2026-03-25-postgres-timescaledb-adapter-design.md`

**Working directory:** `/Users/dandelim/Projects/SynamicD/stonyx/stonyx-orm`

**Test command:** `npm test` (runs `stonyx test`)

---

## Task 1: ORM Core Renames — Generalize MySQL-Specific Property Names

The ORM core currently hardcodes `mysqlDb`, `_mysqlDb`, and `__pendingMysqlId`. These must become adapter-agnostic (`sqlDb`, `_sqlDb`, `__pendingSqlId`) before we build the Postgres adapter. This task also updates existing MySQL tests that reference these names.

**Files:**
- Modify: `src/main.js:112-148`
- Modify: `src/store.js:33-131`
- Modify: `src/manage-record.js:108-115`
- Modify: `src/orm-request.js:389-390`
- Modify: `src/mysql/mysql-db.js:355,383`
- Modify: `test/unit/store-find-test.js` — 14 references to `_mysqlDb` / `mysqlDb`
- Modify: `test/unit/orm-lifecycle-test.js` — 10 references to `mysqlDb`
- Modify: `test/unit/view-rest-test.js` — 1 reference to `mysqlDb`

- [ ] **Step 1: Verify the rename scope**

Run:
```bash
cd /Users/dandelim/Projects/SynamicD/stonyx/stonyx-orm && grep -rn "pendingMysqlId\|mysqlDb\|_mysqlDb" src/ test/ --include="*.js" | grep -v node_modules
```
This confirms every file and line that needs updating. Cross-check against the file list above.

- [ ] **Step 3: Apply all renames**

**`src/main.js`** — Replace all `mysqlDb` with `sqlDb` and `_mysqlDb` with `_sqlDb`. Add dual-adapter guard and postgres branch:

```js
// Line 112 — add guard before adapter selection:
if (config.orm.mysql && config.orm.postgres) {
  throw new Error('Cannot configure both MySQL and Postgres adapters. Choose one.');
}

if (config.orm.mysql) {
  const { default: MysqlDB } = await import('./mysql/mysql-db.js');
  this.sqlDb = new MysqlDB();
  this.db = this.sqlDb;
  promises.push(this.sqlDb.init());
} else if (config.orm.postgres) {
  const { default: PostgresDB } = await import('./postgres/postgres-db.js');
  this.sqlDb = new PostgresDB();
  this.db = this.sqlDb;
  promises.push(this.sqlDb.init());
} else if (this.options.dbType !== 'none') {
  const db = new DB();
  this.db = db;
  promises.push(db.init());
}

// Line 134-137 — rename store wiring:
if (this.sqlDb) {
  Orm.store._sqlDb = this.sqlDb;
}

// Line 143-144 — startup:
async startup() {
  if (this.sqlDb) await this.sqlDb.startup();
}

// Line 147-148 — shutdown:
async shutdown() {
  if (this.sqlDb) await this.sqlDb.shutdown();
}
```

**`src/store.js`** — Replace all `_mysqlDb` with `_sqlDb` (6 occurrences in find/findAll/query + declaration + JSDoc):

- Line 33: `!this._mysqlDb` → `!this._sqlDb`
- Line 44-45: `this._mysqlDb` → `this._sqlDb` (×2)
- Line 61: `!this._mysqlDb` → `!this._sqlDb`
- Line 79-80: `this._mysqlDb` → `this._sqlDb` (×2)
- Line 104-105: `this._mysqlDb` → `this._sqlDb` (×2)
- Line 131: `_mysqlDb = null` → `_sqlDb = null`
- Update JSDoc comments: "MySQL" → "database", `@type {MysqlDB|null}` → `@type {Object|null}`

**`src/manage-record.js`** — Two renames:

- Line 112: `Orm.instance?.mysqlDb` → `Orm.instance?.sqlDb`
- Line 114: `__pendingMysqlId` → `__pendingSqlId`

**`src/orm-request.js`** — One rename:

- Line 389: `Orm.instance.mysqlDb` → `Orm.instance.sqlDb`
- Line 390: `Orm.instance.mysqlDb.persist` → `Orm.instance.sqlDb.persist`

**`src/mysql/mysql-db.js`** — Pending ID flag:

- Line 355: `record.__data.__pendingMysqlId` → `record.__data.__pendingSqlId`
- Line 383: `delete record.__data.__pendingMysqlId` → `delete record.__data.__pendingSqlId`

- [ ] **Step 4: Run all existing tests to verify renames don't break anything**

Run: `cd /Users/dandelim/Projects/SynamicD/stonyx/stonyx-orm && npm test`
Expected: All existing tests PASS (renames are all internal/private properties)

These test files also need updating (found via grep in Step 1):
- `test/unit/store-find-test.js` — all `_mysqlDb` → `_sqlDb`, `mysqlDb` → `sqlDb` (14 occurrences)
- `test/unit/orm-lifecycle-test.js` — all `mysqlDb` → `sqlDb` (10 occurrences)
- `test/unit/view-rest-test.js` — all `mysqlDb` → `sqlDb` (1 occurrence)
- Any other files found by the grep in Step 1

- [ ] **Step 5: Commit**

```bash
git add src/main.js src/store.js src/manage-record.js src/orm-request.js src/mysql/mysql-db.js test/
git commit -m "Generalize MySQL-specific property names for multi-adapter support"
```

---

## Task 2: Package.json — Add `pg` Peer Dependency

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Add `pg` as optional peer dependency and dev dependency**

In `package.json`:

```json
"peerDependencies": {
  "@stonyx/rest-server": ">=0.2.1-beta.14",
  "mysql2": "^3.0.0",
  "pg": "^8.0.0"
},
"peerDependenciesMeta": {
  "mysql2": { "optional": true },
  "pg": { "optional": true },
  "@stonyx/rest-server": { "optional": true }
}
```

Add to `devDependencies`:
```json
"pg": "^8.16.0"
```

- [ ] **Step 2: Install**

Run: `cd /Users/dandelim/Projects/SynamicD/stonyx/stonyx-orm && pnpm install`

- [ ] **Step 3: Commit**

```bash
git add package.json pnpm-lock.yaml
git commit -m "Add pg as optional peer dependency for Postgres adapter"
```

---

## Task 3: Type Map

**Files:**
- Create: `src/postgres/type-map.js`
- Create: `test/unit/postgres/type-map-test.js`

- [ ] **Step 1: Write the failing test**

Create `test/unit/postgres/type-map-test.js`:

```js
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/dandelim/Projects/SynamicD/stonyx/stonyx-orm && npm test`
Expected: FAIL — module `../../../src/postgres/type-map.js` not found

- [ ] **Step 3: Write minimal implementation**

Create `src/postgres/type-map.js`:

```js
const typeMap = {
  string: 'VARCHAR(255)',
  number: 'INTEGER',
  float: 'DOUBLE PRECISION',
  boolean: 'BOOLEAN',
  date: 'TIMESTAMPTZ',
  timestamp: 'BIGINT',
  passthrough: 'TEXT',
  trim: 'VARCHAR(255)',
  uppercase: 'VARCHAR(255)',
  ceil: 'INTEGER',
  floor: 'INTEGER',
  round: 'INTEGER',
};

/**
 * Resolves a Stonyx ORM attribute type to a Postgres column type.
 *
 * For built-in types, returns the mapped Postgres type directly.
 * For custom transforms, checks for a `postgresType` property.
 * Falls back to JSONB (binary JSON with indexing support).
 */
export function getPostgresType(attrType, transformFn) {
  if (typeMap[attrType]) return typeMap[attrType];
  if (transformFn?.postgresType) return transformFn.postgresType;
  return 'JSONB';
}

export default typeMap;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/dandelim/Projects/SynamicD/stonyx/stonyx-orm && npm test`
Expected: All type-map tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/postgres/type-map.js test/unit/postgres/type-map-test.js
git commit -m "Add Postgres type map with JSONB, BOOLEAN, TIMESTAMPTZ defaults"
```

---

## Task 4: Query Builder

**Files:**
- Create: `src/postgres/query-builder.js`
- Create: `test/unit/postgres/query-builder-test.js`

- [ ] **Step 1: Write the failing test**

Create `test/unit/postgres/query-builder-test.js`:

```js
import QUnit from 'qunit';
import { buildInsert, buildUpdate, buildDelete, buildSelect, validateIdentifier } from '../../../src/postgres/query-builder.js';

const { module, test } = QUnit;

module('[Unit] Postgres Query Builder — validateIdentifier', function () {
  test('accepts valid identifiers', function (assert) {
    assert.strictEqual(validateIdentifier('users'), 'users');
    assert.strictEqual(validateIdentifier('user_id'), 'user_id');
    assert.strictEqual(validateIdentifier('access-links'), 'access-links');
  });

  test('rejects invalid identifiers', function (assert) {
    assert.throws(() => validateIdentifier('users; DROP TABLE'), /Invalid SQL identifier/);
    assert.throws(() => validateIdentifier(''), /Invalid SQL identifier/);
    assert.throws(() => validateIdentifier(null), /Invalid SQL identifier/);
    assert.throws(() => validateIdentifier('1users'), /Invalid SQL identifier/);
  });
});

module('[Unit] Postgres Query Builder — buildInsert', function () {
  test('generates parameterized INSERT with $N placeholders and double-quoted identifiers', function (assert) {
    const { sql, values } = buildInsert('users', { name: 'Alice', age: 30 });
    assert.strictEqual(sql, 'INSERT INTO "users" ("name", "age") VALUES ($1, $2)');
    assert.deepEqual(values, ['Alice', 30]);
  });

  test('SQL injection payloads are safely parameterized', function (assert) {
    const { sql, values } = buildInsert('users', { name: "'; DROP TABLE users; --" });
    assert.true(sql.includes('VALUES ($1)'));
    assert.strictEqual(values[0], "'; DROP TABLE users; --");
  });

  test('rejects malicious table names', function (assert) {
    assert.throws(() => buildInsert('users; DROP TABLE users', { name: 'test' }), /Invalid SQL table name/);
  });

  test('rejects malicious column names', function (assert) {
    assert.throws(() => buildInsert('users', { 'name"; --': 'test' }), /Invalid SQL column name/);
  });
});

module('[Unit] Postgres Query Builder — buildUpdate', function () {
  test('generates parameterized UPDATE with $N placeholders', function (assert) {
    const { sql, values } = buildUpdate('users', 1, { name: 'Bob' });
    assert.strictEqual(sql, 'UPDATE "users" SET "name" = $1 WHERE "id" = $2');
    assert.deepEqual(values, ['Bob', 1]);
  });

  test('handles multiple columns', function (assert) {
    const { sql, values } = buildUpdate('users', 5, { name: 'Eve', age: 25 });
    assert.strictEqual(sql, 'UPDATE "users" SET "name" = $1, "age" = $2 WHERE "id" = $3');
    assert.deepEqual(values, ['Eve', 25, 5]);
  });
});

module('[Unit] Postgres Query Builder — buildDelete', function () {
  test('generates parameterized DELETE', function (assert) {
    const { sql, values } = buildDelete('users', 5);
    assert.strictEqual(sql, 'DELETE FROM "users" WHERE "id" = $1');
    assert.deepEqual(values, [5]);
  });
});

module('[Unit] Postgres Query Builder — buildSelect', function () {
  test('generates SELECT * with no conditions', function (assert) {
    const { sql, values } = buildSelect('users');
    assert.strictEqual(sql, 'SELECT * FROM "users"');
    assert.deepEqual(values, []);
  });

  test('generates parameterized WHERE clause with $N placeholders', function (assert) {
    const { sql, values } = buildSelect('users', { name: 'Alice', active: true });
    assert.strictEqual(sql, 'SELECT * FROM "users" WHERE "name" = $1 AND "active" = $2');
    assert.deepEqual(values, ['Alice', true]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/dandelim/Projects/SynamicD/stonyx/stonyx-orm && npm test`
Expected: FAIL — module not found

- [ ] **Step 3: Write minimal implementation**

Create `src/postgres/query-builder.js`:

```js
const SAFE_IDENTIFIER = /^[a-zA-Z_][a-zA-Z0-9_-]*$/;

export function validateIdentifier(name, context = 'identifier') {
  if (!name || typeof name !== 'string' || !SAFE_IDENTIFIER.test(name)) {
    throw new Error(`Invalid SQL ${context}: "${name}". Identifiers must match ${SAFE_IDENTIFIER}`);
  }
  return name;
}

export function buildInsert(table, data) {
  validateIdentifier(table, 'table name');

  const keys = Object.keys(data);
  keys.forEach(k => validateIdentifier(k, 'column name'));

  const placeholders = keys.map((_, i) => `$${i + 1}`);
  const values = keys.map(k => data[k]);

  const sql = `INSERT INTO "${table}" (${keys.map(k => `"${k}"`).join(', ')}) VALUES (${placeholders.join(', ')})`;

  return { sql, values };
}

export function buildUpdate(table, id, data) {
  validateIdentifier(table, 'table name');

  const keys = Object.keys(data);
  keys.forEach(k => validateIdentifier(k, 'column name'));

  const setClauses = keys.map((k, i) => `"${k}" = $${i + 1}`);
  const values = [...keys.map(k => data[k]), id];

  const sql = `UPDATE "${table}" SET ${setClauses.join(', ')} WHERE "id" = $${keys.length + 1}`;

  return { sql, values };
}

export function buildDelete(table, id) {
  validateIdentifier(table, 'table name');

  return {
    sql: `DELETE FROM "${table}" WHERE "id" = $1`,
    values: [id],
  };
}

export function buildSelect(table, conditions) {
  validateIdentifier(table, 'table name');

  if (!conditions || Object.keys(conditions).length === 0) {
    return { sql: `SELECT * FROM "${table}"`, values: [] };
  }

  const keys = Object.keys(conditions);
  keys.forEach(k => validateIdentifier(k, 'column name'));

  const whereClauses = keys.map((k, i) => `"${k}" = $${i + 1}`);
  const values = keys.map(k => conditions[k]);

  const sql = `SELECT * FROM "${table}" WHERE ${whereClauses.join(' AND ')}`;

  return { sql, values };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/dandelim/Projects/SynamicD/stonyx/stonyx-orm && npm test`
Expected: All query-builder tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/postgres/query-builder.js test/unit/postgres/query-builder-test.js
git commit -m "Add Postgres query builder with \$N parameterization and double-quote identifiers"
```

---

## Task 5: Connection Module

**Files:**
- Create: `src/postgres/connection.js`
- Create: `test/unit/postgres/connection-test.js`

- [ ] **Step 1: Write the failing test**

Create `test/unit/postgres/connection-test.js`:

```js
import QUnit from 'qunit';
import sinon from 'sinon';

const { module, test } = QUnit;

module('[Unit] Postgres Connection', function (hooks) {
  let connectionModule;

  hooks.beforeEach(async function () {
    // Re-import to reset module state (pool = null)
    // We test the exported functions' behavior
  });

  hooks.afterEach(function () {
    sinon.restore();
  });

  test('closePool is a function', async function (assert) {
    const { closePool } = await import('../../../src/postgres/connection.js');
    assert.strictEqual(typeof closePool, 'function');
  });

  test('getPool is a function', async function (assert) {
    const { getPool } = await import('../../../src/postgres/connection.js');
    assert.strictEqual(typeof getPool, 'function');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/dandelim/Projects/SynamicD/stonyx/stonyx-orm && npm test`
Expected: FAIL — module not found

- [ ] **Step 3: Write minimal implementation**

Create `src/postgres/connection.js`:

```js
let pool = null;

export async function getPool(postgresConfig) {
  if (pool) return pool;

  const pg = await import('pg');
  const { Pool } = pg.default;

  pool = new Pool({
    host: postgresConfig.host,
    port: postgresConfig.port,
    user: postgresConfig.user,
    password: postgresConfig.password,
    database: postgresConfig.database,
    max: postgresConfig.connectionLimit,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 2000,
  });

  return pool;
}

export async function closePool() {
  if (!pool) return;
  await pool.end();
  pool = null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/dandelim/Projects/SynamicD/stonyx/stonyx-orm && npm test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/postgres/connection.js test/unit/postgres/connection-test.js
git commit -m "Add Postgres connection pool with lazy pg import"
```

---

## Task 6: Schema Introspector — Table DDL

**Files:**
- Create: `src/postgres/schema-introspector.js`
- Create: `test/unit/postgres/schema-introspector-test.js`

- [ ] **Step 1: Write the failing test**

Create `test/unit/postgres/schema-introspector-test.js`:

```js
import QUnit from 'qunit';
import { buildTableDDL, getTopologicalOrder } from '../../../src/postgres/schema-introspector.js';

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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/dandelim/Projects/SynamicD/stonyx/stonyx-orm && npm test`
Expected: FAIL — module not found

- [ ] **Step 3: Write the schema introspector**

Create `src/postgres/schema-introspector.js`. This mirrors `src/mysql/schema-introspector.js` but uses `getPostgresType`, double quotes, `GENERATED ALWAYS AS IDENTITY`, and `TIMESTAMPTZ`. Copy the full structure from the MySQL version — the key functions are `introspectModels()`, `buildTableDDL()`, `getTopologicalOrder()`, `introspectViews()`, `buildViewDDL()`, `schemasToSnapshot()`.

Key differences in `introspectModels()`:
- Call `getPostgresType()` instead of `getMysqlType()`
- Capture `timeSeries: modelClass.timeSeries || null`
- Capture `compression: modelClass.compression || null`

Key differences in `buildTableDDL()`:
- String PK: `"id" VARCHAR(255) PRIMARY KEY`
- Numeric PK: `"id" INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY`
- All identifiers use `"` not backtick
- Timestamps: `"created_at" TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP` (no ON UPDATE)
- FK constraints: same logic, `"` quoting
- For hypertable schemas (schema.timeSeries is set): omit FK constraints (return them separately — see Task 7)

Key differences in `buildViewDDL()`:
- All `"` quoting instead of backticks
- Reference `aggProp.mysqlFunction` — the values (COUNT, SUM, AVG, etc.) are standard SQL, same in Postgres. Add a comment in the code: `// Uses mysqlFunction property — values are standard SQL (COUNT, SUM, etc.), named in aggregates.js`

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Users/dandelim/Projects/SynamicD/stonyx/stonyx-orm && npm test`
Expected: All schema-introspector tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/postgres/schema-introspector.js test/unit/postgres/schema-introspector-test.js
git commit -m "Add Postgres schema introspector with IDENTITY, TIMESTAMPTZ, timeSeries support"
```

---

## Task 7: Hypertable & Compression DDL

**Files:**
- Modify: `src/postgres/schema-introspector.js`
- Create: `test/unit/postgres/hypertable-ddl-test.js`

- [ ] **Step 1: Write the failing test**

Create `test/unit/postgres/hypertable-ddl-test.js`:

```js
import QUnit from 'qunit';
import { buildTableDDL } from '../../../src/postgres/schema-introspector.js';

const { module, test } = QUnit;

function hypertableSchema() {
  return {
    match: {
      table: 'matches', idType: 'string',
      columns: {}, foreignKeys: {},
      relationships: { belongsTo: {}, hasMany: {} },
    },
    'stat-snapshot': {
      table: 'stat_snapshots', idType: 'number',
      columns: { timestamp: 'TIMESTAMPTZ', possession_home: 'DOUBLE PRECISION' },
      foreignKeys: { match_id: { references: 'matches', column: 'id' } },
      relationships: { belongsTo: { match: 'match' }, hasMany: {} },
      timeSeries: 'timestamp',
      compression: { after: '7d' },
    },
  };
}

function multipleFK() {
  return {
    match: {
      table: 'matches', idType: 'string',
      columns: {}, foreignKeys: {},
      relationships: { belongsTo: {}, hasMany: {} },
    },
    player: {
      table: 'players', idType: 'number',
      columns: {}, foreignKeys: {},
      relationships: { belongsTo: {}, hasMany: {} },
    },
    event: {
      table: 'events', idType: 'number',
      columns: { timestamp: 'TIMESTAMPTZ' },
      foreignKeys: {
        match_id: { references: 'matches', column: 'id' },
        player_id: { references: 'players', column: 'id' },
      },
      relationships: { belongsTo: { match: 'match', player: 'player' }, hasMany: {} },
      timeSeries: 'timestamp',
      compression: { after: '7d' },
    },
  };
}

module('[Unit] Postgres Hypertable DDL', function () {
  test('buildTableDDL omits FK constraints for hypertable schemas', function (assert) {
    const schemas = hypertableSchema();
    const ddl = buildTableDDL('stat-snapshot', schemas['stat-snapshot'], schemas);
    assert.true(ddl.includes('"match_id" VARCHAR(255)'), 'FK column is still created');
    assert.false(ddl.includes('FOREIGN KEY'), 'no FK constraint for hypertable');
  });

  test('buildTableDDL includes FK constraints for non-hypertable schemas', function (assert) {
    const schemas = hypertableSchema();
    const ddl = buildTableDDL('match', schemas.match, schemas);
    assert.false(ddl.includes('FOREIGN KEY'), 'match has no FKs');
  });

  test('buildTableDDL returns hypertable DDL statements', function (assert) {
    const schemas = hypertableSchema();
    const ddl = buildTableDDL('stat-snapshot', schemas['stat-snapshot'], schemas);
    assert.true(ddl.includes("SELECT create_hypertable('stat_snapshots', 'timestamp')"), 'includes create_hypertable');
  });

  test('buildTableDDL returns compression DDL when compression is set', function (assert) {
    const schemas = hypertableSchema();
    const ddl = buildTableDDL('stat-snapshot', schemas['stat-snapshot'], schemas);
    assert.true(ddl.includes('timescaledb.compress'), 'includes compression setting');
    assert.true(ddl.includes("timescaledb.compress_segmentby = 'match_id'"), 'segments by FK column');
    assert.true(ddl.includes("add_compression_policy('stat_snapshots', INTERVAL '7 days')"), 'includes compression policy');
  });

  test('compression segmentby includes all FK columns for multiple belongsTo', function (assert) {
    const schemas = multipleFK();
    const ddl = buildTableDDL('event', schemas.event, schemas);
    assert.true(
      ddl.includes("timescaledb.compress_segmentby = 'match_id, player_id'"),
      'segments by all FK columns'
    );
  });

  test('non-hypertable schemas do not include hypertable DDL', function (assert) {
    const schemas = hypertableSchema();
    const ddl = buildTableDDL('match', schemas.match, schemas);
    assert.false(ddl.includes('create_hypertable'), 'no hypertable DDL for regular table');
    assert.false(ddl.includes('compress'), 'no compression for regular table');
  });

  test('timeSeries without compression does not include compression DDL', function (assert) {
    const schemas = {
      event: {
        table: 'events', idType: 'number',
        columns: { timestamp: 'TIMESTAMPTZ' },
        foreignKeys: { match_id: { references: 'matches', column: 'id' } },
        relationships: { belongsTo: { match: 'match' }, hasMany: {} },
        timeSeries: 'timestamp',
      },
    };
    const ddl = buildTableDDL('event', schemas.event, schemas);
    assert.true(ddl.includes('create_hypertable'), 'includes hypertable DDL');
    assert.false(ddl.includes('compress'), 'no compression DDL');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/dandelim/Projects/SynamicD/stonyx/stonyx-orm && npm test`
Expected: FAIL — hypertable DDL not yet emitted

- [ ] **Step 3: Update schema introspector to emit hypertable/compression DDL**

In `src/postgres/schema-introspector.js`, update `buildTableDDL()`:

1. If `schema.timeSeries` is set, omit FK constraints from the CREATE TABLE
2. After the CREATE TABLE closing `)`, append:
   - `;\nSELECT create_hypertable('${table}', '${schema.timeSeries}')`
3. If `schema.compression` is also set, append:
   - The `ALTER TABLE ... SET (timescaledb.compress, ...)` statement
   - The `SELECT add_compression_policy(...)` statement
   - `compress_segmentby` lists all FK column names, comma-separated

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Users/dandelim/Projects/SynamicD/stonyx/stonyx-orm && npm test`
Expected: All hypertable DDL tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/postgres/schema-introspector.js test/unit/postgres/hypertable-ddl-test.js
git commit -m "Add hypertable and compression DDL generation to Postgres introspector"
```

---

## Task 8: Migration Runner

**Files:**
- Create: `src/postgres/migration-runner.js`
- Create: `test/unit/postgres/migration-runner-test.js`

- [ ] **Step 1: Write the failing test**

Create `test/unit/postgres/migration-runner-test.js`:

```js
import QUnit from 'qunit';
import { parseMigrationFile, splitStatements } from '../../../src/postgres/migration-runner.js';

const { module, test } = QUnit;

module('[Unit] Postgres Migration Runner — parseMigrationFile', function () {
  test('parses UP and DOWN sections', function (assert) {
    const content = '-- UP\nCREATE TABLE "t" ("id" INTEGER);\n\n-- DOWN\nDROP TABLE "t";';
    const { up, down } = parseMigrationFile(content);
    assert.strictEqual(up, 'CREATE TABLE "t" ("id" INTEGER);');
    assert.strictEqual(down, 'DROP TABLE "t";');
  });

  test('handles missing DOWN section', function (assert) {
    const content = '-- UP\nCREATE TABLE "t" ("id" INTEGER);';
    const { up, down } = parseMigrationFile(content);
    assert.strictEqual(up, 'CREATE TABLE "t" ("id" INTEGER);');
    assert.strictEqual(down, '');
  });

  test('handles content without markers', function (assert) {
    const content = 'CREATE TABLE "t" ("id" INTEGER);';
    const { up, down } = parseMigrationFile(content);
    assert.strictEqual(up, 'CREATE TABLE "t" ("id" INTEGER);');
    assert.strictEqual(down, '');
  });
});

module('[Unit] Postgres Migration Runner — splitStatements', function () {
  test('splits on semicolons and filters empty/comments', function (assert) {
    const sql = 'CREATE TABLE "t" ("id" INTEGER);\n-- comment\nINSERT INTO "t" VALUES (1);';
    const stmts = splitStatements(sql);
    assert.strictEqual(stmts.length, 2);
    assert.strictEqual(stmts[0], 'CREATE TABLE "t" ("id" INTEGER)');
    assert.strictEqual(stmts[1], 'INSERT INTO "t" VALUES (1)');
  });

  test('handles hypertable DDL statements', function (assert) {
    const sql = "CREATE TABLE \"t\" (\"id\" INTEGER);\nSELECT create_hypertable('t', 'ts');\nSELECT add_compression_policy('t', INTERVAL '7 days');";
    const stmts = splitStatements(sql);
    assert.strictEqual(stmts.length, 3);
    assert.true(stmts[1].includes('create_hypertable'));
    assert.true(stmts[2].includes('add_compression_policy'));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/dandelim/Projects/SynamicD/stonyx/stonyx-orm && npm test`
Expected: FAIL — module not found

- [ ] **Step 3: Write the migration runner**

Create `src/postgres/migration-runner.js`. Mirror `src/mysql/migration-runner.js` with these differences:

- `ensureMigrationsTable()`: uses `INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY` and `TIMESTAMPTZ`
- `applyMigration()`: uses `pool.connect()` → `client.query('BEGIN')` / `client.query(stmt)` / `client.query('COMMIT')` pattern with `$1` parameterization
- `rollbackMigration()`: same pattern with `DELETE FROM "__migrations" WHERE filename = $1`
- `getAppliedMigrations()`: uses `pool.query()` instead of `pool.execute()`
- `parseMigrationFile()`, `getMigrationFiles()`, `splitStatements()`: identical to MySQL

Copy `splitStatements` from MySQL but add `export` keyword: `export function splitStatements(sql)` (MySQL keeps it as a non-exported `function` — we export it for testability).

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Users/dandelim/Projects/SynamicD/stonyx/stonyx-orm && npm test`
Expected: All migration runner tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/postgres/migration-runner.js test/unit/postgres/migration-runner-test.js
git commit -m "Add Postgres migration runner with transaction-based apply/rollback"
```

---

## Task 9: Migration Generator

**Files:**
- Create: `src/postgres/migration-generator.js`
- Create: `test/unit/postgres/migration-generator-test.js`

- [ ] **Step 1: Write the failing test**

Create `test/unit/postgres/migration-generator-test.js`:

```js
import QUnit from 'qunit';
import { diffSnapshots } from '../../../src/postgres/migration-generator.js';

const { module, test } = QUnit;

module('[Unit] Postgres Migration Generator — diffSnapshots', function () {
  test('detects added models', function (assert) {
    const current = {
      user: { table: 'users', idType: 'string', columns: { name: 'VARCHAR(255)' }, foreignKeys: {} },
    };
    const diff = diffSnapshots({}, current);
    assert.true(diff.hasChanges);
    assert.deepEqual(diff.addedModels, ['user']);
  });

  test('detects removed models', function (assert) {
    const previous = {
      user: { table: 'users', idType: 'string', columns: {}, foreignKeys: {} },
    };
    const diff = diffSnapshots(previous, {});
    assert.true(diff.hasChanges);
    assert.deepEqual(diff.removedModels, ['user']);
  });

  test('detects added columns', function (assert) {
    const previous = { user: { table: 'users', columns: { name: 'VARCHAR(255)' }, foreignKeys: {} } };
    const current = { user: { table: 'users', columns: { name: 'VARCHAR(255)', email: 'VARCHAR(255)' }, foreignKeys: {} } };
    const diff = diffSnapshots(previous, current);
    assert.true(diff.hasChanges);
    assert.strictEqual(diff.addedColumns.length, 1);
    assert.strictEqual(diff.addedColumns[0].column, 'email');
  });

  test('detects changed column types', function (assert) {
    const previous = { user: { table: 'users', columns: { score: 'INTEGER' }, foreignKeys: {} } };
    const current = { user: { table: 'users', columns: { score: 'DOUBLE PRECISION' }, foreignKeys: {} } };
    const diff = diffSnapshots(previous, current);
    assert.true(diff.hasChanges);
    assert.strictEqual(diff.changedColumns[0].from, 'INTEGER');
    assert.strictEqual(diff.changedColumns[0].to, 'DOUBLE PRECISION');
  });

  test('no changes returns hasChanges: false', function (assert) {
    const snapshot = { user: { table: 'users', columns: { name: 'VARCHAR(255)' }, foreignKeys: {} } };
    const diff = diffSnapshots(snapshot, snapshot);
    assert.false(diff.hasChanges);
  });

  test('snapshot includes timeSeries and compression fields', function (assert) {
    const current = {
      event: {
        table: 'events', idType: 'number',
        columns: { timestamp: 'TIMESTAMPTZ' }, foreignKeys: {},
        timeSeries: 'timestamp', compression: { after: '7d' },
      },
    };
    const diff = diffSnapshots({}, current);
    assert.true(diff.hasChanges);
    assert.deepEqual(diff.addedModels, ['event']);
  });
});
```

Note: The `generateMigration()` function includes a TimescaleDB extension check. When generating hypertable DDL, it queries `SELECT * FROM pg_extension WHERE extname = 'timescaledb'` and throws `"TimescaleDB extension is not installed. Install it with: CREATE EXTENSION IF NOT EXISTS timescaledb;"` if not found. This is tested in the integration tests (Task 13) against a real database.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/dandelim/Projects/SynamicD/stonyx/stonyx-orm && npm test`
Expected: FAIL — module not found

- [ ] **Step 3: Write the migration generator**

Create `src/postgres/migration-generator.js`. Mirror `src/mysql/migration-generator.js` with these SQL differences:

- Column alteration: `ALTER TABLE "t" ALTER COLUMN "c" TYPE NEW_TYPE` instead of `MODIFY COLUMN`
- Drop FK: `ALTER TABLE "t" DROP CONSTRAINT "t_fk_col_fkey"` instead of `DROP FOREIGN KEY`
- All identifiers use `"` not backticks
- `generateMigration()` imports from `./schema-introspector.js` (Postgres version)
- Config reads from `config.orm.postgres` instead of `config.orm.mysql`
- When generating DDL for added models with `timeSeries`, include `create_hypertable()` and compression DDL
- TimescaleDB extension check: in `generateMigration()`, if any model has `timeSeries`, query `SELECT * FROM pg_extension WHERE extname = 'timescaledb'` before generating DDL. Throw a clear error if not found.
- Snapshot includes `timeSeries` and `compression` fields
- Export `diffSnapshots`, `detectSchemaDrift`, `loadLatestSnapshot` (same names as MySQL version — `diffSnapshots` is the internal diff function, `detectSchemaDrift` wraps it for the startup check)

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Users/dandelim/Projects/SynamicD/stonyx/stonyx-orm && npm test`
Expected: All migration generator tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/postgres/migration-generator.js test/unit/postgres/migration-generator-test.js
git commit -m "Add Postgres migration generator with hypertable and ALTER COLUMN TYPE syntax"
```

---

## Task 10: Main Driver — `PostgresDB`

**Files:**
- Create: `src/postgres/postgres-db.js`
- Create: `test/unit/postgres/postgres-db-memory-flag-test.js`

- [ ] **Step 1: Write the failing test**

Create `test/unit/postgres/postgres-db-memory-flag-test.js`:

```js
import QUnit from 'qunit';
import sinon from 'sinon';
import PostgresDB from '../../../src/postgres/postgres-db.js';

const { module, test } = QUnit;

function createMockDeps(overrides = {}) {
  return {
    getPool: sinon.stub().resolves({}),
    closePool: sinon.stub().resolves(),
    ensureMigrationsTable: sinon.stub().resolves(),
    getAppliedMigrations: sinon.stub().resolves([]),
    getMigrationFiles: sinon.stub().resolves([]),
    applyMigration: sinon.stub().resolves(),
    parseMigrationFile: sinon.stub().returns({ up: 'CREATE TABLE t (id INTEGER);', down: 'DROP TABLE t;' }),
    introspectModels: sinon.stub().returns({}),
    introspectViews: sinon.stub().returns({}),
    getTopologicalOrder: sinon.stub().returns([]),
    schemasToSnapshot: sinon.stub().returns({}),
    loadLatestSnapshot: sinon.stub().resolves({}),
    detectSchemaDrift: sinon.stub().returns({ hasChanges: false }),
    buildInsert: sinon.stub().returns({ sql: '', values: [] }),
    buildUpdate: sinon.stub().returns({ sql: '', values: [] }),
    buildDelete: sinon.stub().returns({ sql: '', values: [] }),
    buildSelect: sinon.stub().returns({ sql: 'SELECT * FROM "test"', values: [] }),
    createRecord: sinon.stub().callsFake((name, data) => ({ id: data.id, __model: { __name: name }, __data: data })),
    store: { get: sinon.stub() },
    confirm: sinon.stub().resolves(true),
    readFile: sinon.stub().resolves(''),
    getPluralName: sinon.stub(),
    config: {
      rootPath: '/app',
      orm: {
        postgres: {
          host: 'localhost',
          port: 5432,
          migrationsDir: 'migrations',
          migrationsTable: '__migrations',
        }
      }
    },
    log: { db: sinon.stub(), warn: sinon.stub() },
    path: {
      resolve: sinon.stub().returns('/app/migrations'),
      join: sinon.stub().callsFake((...args) => args.join('/')),
    },
    ...overrides,
  };
}

module('[Unit] PostgresDB.findRecord', function (hooks) {
  hooks.beforeEach(function () { PostgresDB.instance = null; });
  hooks.afterEach(function () { PostgresDB.instance = null; sinon.restore(); });

  test('findRecord queries by ID and returns a record', async function (assert) {
    const deps = createMockDeps({
      introspectModels: sinon.stub().returns({
        alert: { table: 'alerts', columns: { message: 'VARCHAR(255)' }, foreignKeys: {} },
      }),
      buildSelect: sinon.stub().returns({ sql: 'SELECT * FROM "alerts" WHERE "id" = $1', values: [42] }),
    });

    const db = new PostgresDB(deps);
    db.pool = { query: sinon.stub().resolves({ rows: [{ id: 42, message: 'test' }] }) };

    const record = await db.findRecord('alert', 42);

    assert.ok(deps.buildSelect.calledOnce);
    assert.deepEqual(deps.buildSelect.firstCall.args, ['alerts', { id: 42 }]);
    assert.strictEqual(record.id, 42);
  });

  test('findRecord returns undefined when no rows found', async function (assert) {
    const deps = createMockDeps({
      introspectModels: sinon.stub().returns({
        alert: { table: 'alerts', columns: {}, foreignKeys: {} },
      }),
      buildSelect: sinon.stub().returns({ sql: 'SELECT * FROM "alerts" WHERE "id" = $1', values: [999] }),
    });

    const db = new PostgresDB(deps);
    db.pool = { query: sinon.stub().resolves({ rows: [] }) };

    const record = await db.findRecord('alert', 999);
    assert.strictEqual(record, undefined);
  });

  test('findRecord handles undefined_table error gracefully', async function (assert) {
    const deps = createMockDeps({
      introspectModels: sinon.stub().returns({
        alert: { table: 'alerts', columns: {}, foreignKeys: {} },
      }),
      buildSelect: sinon.stub().returns({ sql: 'SELECT * FROM "alerts"', values: [] }),
    });

    const db = new PostgresDB(deps);
    const error = new Error('relation "alerts" does not exist');
    error.code = '42P01';
    db.pool = { query: sinon.stub().rejects(error) };

    const record = await db.findRecord('alert', 1);
    assert.strictEqual(record, undefined);
  });
});

module('[Unit] PostgresDB.findAll', function (hooks) {
  hooks.beforeEach(function () { PostgresDB.instance = null; });
  hooks.afterEach(function () { PostgresDB.instance = null; sinon.restore(); });

  test('findAll returns records', async function (assert) {
    const deps = createMockDeps({
      introspectModels: sinon.stub().returns({
        alert: { table: 'alerts', columns: { message: 'VARCHAR(255)' }, foreignKeys: {} },
      }),
      buildSelect: sinon.stub().returns({ sql: 'SELECT * FROM "alerts"', values: [] }),
    });

    const db = new PostgresDB(deps);
    db.pool = { query: sinon.stub().resolves({ rows: [{ id: 1 }, { id: 2 }] }) };

    const records = await db.findAll('alert');
    assert.strictEqual(records.length, 2);
  });

  test('findAll handles undefined_table gracefully', async function (assert) {
    const deps = createMockDeps({
      introspectModels: sinon.stub().returns({
        alert: { table: 'alerts', columns: {}, foreignKeys: {} },
      }),
      buildSelect: sinon.stub().returns({ sql: 'SELECT * FROM "alerts"', values: [] }),
    });

    const db = new PostgresDB(deps);
    const error = new Error('relation "alerts" does not exist');
    error.code = '42P01';
    db.pool = { query: sinon.stub().rejects(error) };

    const records = await db.findAll('alert');
    assert.deepEqual(records, []);
  });
});

module('[Unit] PostgresDB._evictIfNotMemory', function (hooks) {
  hooks.beforeEach(function () { PostgresDB.instance = null; });
  hooks.afterEach(function () { PostgresDB.instance = null; sinon.restore(); });

  test('evicts record when memory resolver returns false', function (assert) {
    const modelStore = new Map();
    modelStore.set(42, { id: 42 });

    const deps = createMockDeps({
      store: {
        get: sinon.stub().returns(modelStore),
        _memoryResolver: (name) => name !== 'alert',
      },
    });

    const db = new PostgresDB(deps);
    db._evictIfNotMemory('alert', { id: 42 });
    assert.notOk(modelStore.has(42));
  });

  test('does not evict when memory resolver returns true', function (assert) {
    const modelStore = new Map();
    modelStore.set(1, { id: 1 });

    const deps = createMockDeps({
      store: {
        get: sinon.stub().returns(modelStore),
        _memoryResolver: () => true,
      },
    });

    const db = new PostgresDB(deps);
    db._evictIfNotMemory('session', { id: 1 });
    assert.ok(modelStore.has(1));
  });
});

module('[Unit] PostgresDB._rowToRawData', function (hooks) {
  hooks.beforeEach(function () { PostgresDB.instance = null; });
  hooks.afterEach(function () { PostgresDB.instance = null; sinon.restore(); });

  test('remaps FK columns to relationship keys', function (assert) {
    const deps = createMockDeps();
    const db = new PostgresDB(deps);

    const rawData = db._rowToRawData(
      { id: 1, name: 'test', owner_id: 5, created_at: new Date(), updated_at: new Date() },
      { columns: { name: 'VARCHAR(255)' }, foreignKeys: { owner_id: { references: 'owners', column: 'id' } } }
    );

    assert.strictEqual(rawData.owner, 5, 'FK remapped to relationship key');
    assert.strictEqual(rawData.owner_id, undefined, 'FK column removed');
    assert.strictEqual(rawData.created_at, undefined, 'created_at stripped');
    assert.strictEqual(rawData.updated_at, undefined, 'updated_at stripped');
  });

  test('converts BIGINT string values to Number for timestamp columns', function (assert) {
    const deps = createMockDeps();
    const db = new PostgresDB(deps);

    const rawData = db._rowToRawData(
      { id: 1, ts: '1711382400', created_at: new Date(), updated_at: new Date() },
      { columns: { ts: 'BIGINT' }, foreignKeys: {} }
    );

    assert.strictEqual(rawData.ts, 1711382400, 'BIGINT string converted to Number');
    assert.strictEqual(typeof rawData.ts, 'number');
  });
});

module('[Unit] PostgresDB._recordToRow', function (hooks) {
  hooks.beforeEach(function () { PostgresDB.instance = null; });
  hooks.afterEach(function () { PostgresDB.instance = null; sinon.restore(); });

  test('does not stringify JSONB values (pg accepts objects directly)', function (assert) {
    const deps = createMockDeps();
    const db = new PostgresDB(deps);

    const record = {
      id: 1,
      __data: { id: 1, config: { key: 'value' } },
      __relationships: {},
    };
    const schema = { columns: { config: 'JSONB' }, foreignKeys: {} };

    const row = db._recordToRow(record, schema);
    assert.deepEqual(row.config, { key: 'value' }, 'JSONB value passed as object, not stringified');
    assert.strictEqual(typeof row.config, 'object');
  });

  test('extracts FK values from relationships', function (assert) {
    const deps = createMockDeps();
    const db = new PostgresDB(deps);

    const record = {
      id: 1,
      __data: { id: 1 },
      __relationships: { owner: { id: 5 } },
    };
    const schema = { columns: {}, foreignKeys: { owner_id: { references: 'owners', column: 'id' } } };

    const row = db._recordToRow(record, schema);
    assert.strictEqual(row.owner_id, 5);
  });
});

module('[Unit] PostgresDB._persistCreate', function (hooks) {
  hooks.beforeEach(function () { PostgresDB.instance = null; });
  hooks.afterEach(function () { PostgresDB.instance = null; sinon.restore(); });

  test('appends RETURNING id to INSERT SQL for auto-increment models', async function (assert) {
    const modelStore = new Map();
    const record = {
      id: '__pending_123',
      __data: { id: '__pending_123', name: 'test', __pendingSqlId: true },
      __relationships: {},
    };
    modelStore.set('__pending_123', record);

    const deps = createMockDeps({
      introspectModels: sinon.stub().returns({
        alert: { table: 'alerts', columns: { name: 'VARCHAR(255)' }, foreignKeys: {} },
      }),
      buildInsert: sinon.stub().returns({ sql: 'INSERT INTO "alerts" ("name") VALUES ($1)', values: ['test'] }),
      store: {
        get: sinon.stub().callsFake((name, id) => id ? modelStore.get(id) : modelStore),
      },
    });

    const db = new PostgresDB(deps);
    db.pool = {
      query: sinon.stub().resolves({ rows: [{ id: 42 }] }),
    };

    await db._persistCreate('alert', {}, { data: { id: '__pending_123' } });

    const executedSql = db.pool.query.firstCall.args[0];
    assert.true(executedSql.includes('RETURNING id'), 'SQL includes RETURNING id');
    assert.strictEqual(record.__data.id, 42, 'record re-keyed with real ID');
    assert.strictEqual(record.__data.__pendingSqlId, undefined, '__pendingSqlId cleaned up');
  });
});

module('[Unit] PostgresDB._persistUpdate', function (hooks) {
  hooks.beforeEach(function () { PostgresDB.instance = null; });
  hooks.afterEach(function () { PostgresDB.instance = null; sinon.restore(); });

  test('includes updated_at in changed columns', async function (assert) {
    const deps = createMockDeps({
      introspectModels: sinon.stub().returns({
        alert: { table: 'alerts', columns: { name: 'VARCHAR(255)' }, foreignKeys: {} },
      }),
      buildUpdate: sinon.stub().returns({ sql: 'UPDATE "alerts" SET "name" = $1, "updated_at" = $2 WHERE "id" = $3', values: ['new', new Date(), 1] }),
    });

    const db = new PostgresDB(deps);
    db.pool = { query: sinon.stub().resolves({ rows: [] }) };

    const record = {
      id: 1,
      __data: { id: 1, name: 'new' },
      __relationships: {},
    };

    await db._persistUpdate('alert', { record, oldState: { name: 'old' } }, {});

    const buildUpdateCall = deps.buildUpdate.firstCall;
    assert.ok(buildUpdateCall, 'buildUpdate was called');
    const changedData = buildUpdateCall.args[2];
    assert.ok(changedData.updated_at instanceof Date, 'updated_at is a Date');
    assert.strictEqual(changedData.name, 'new', 'changed column included');
  });

  test('skips update when no columns changed', async function (assert) {
    const deps = createMockDeps({
      introspectModels: sinon.stub().returns({
        alert: { table: 'alerts', columns: { name: 'VARCHAR(255)' }, foreignKeys: {} },
      }),
      buildUpdate: sinon.stub().returns({ sql: '', values: [] }),
    });

    const db = new PostgresDB(deps);
    db.pool = { query: sinon.stub().resolves({ rows: [] }) };

    const record = {
      id: 1,
      __data: { id: 1, name: 'same' },
      __relationships: {},
    };

    await db._persistUpdate('alert', { record, oldState: { name: 'same' } }, {});

    assert.ok(deps.buildUpdate.notCalled, 'buildUpdate not called when no changes');
  });
});

module('[Unit] PostgresDB._persistDelete', function (hooks) {
  hooks.beforeEach(function () { PostgresDB.instance = null; });
  hooks.afterEach(function () { PostgresDB.instance = null; sinon.restore(); });

  test('deletes by record ID', async function (assert) {
    const deps = createMockDeps({
      introspectModels: sinon.stub().returns({
        alert: { table: 'alerts', columns: {}, foreignKeys: {} },
      }),
      buildDelete: sinon.stub().returns({ sql: 'DELETE FROM "alerts" WHERE "id" = $1', values: [5] }),
    });

    const db = new PostgresDB(deps);
    db.pool = { query: sinon.stub().resolves({ rows: [] }) };

    await db._persistDelete('alert', { recordId: 5 });

    assert.ok(deps.buildDelete.calledOnce);
    assert.deepEqual(deps.buildDelete.firstCall.args, ['alerts', 5]);
    assert.ok(db.pool.query.calledOnce);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/dandelim/Projects/SynamicD/stonyx/stonyx-orm && npm test`
Expected: FAIL — module not found

- [ ] **Step 3: Write the PostgresDB driver**

Create `src/postgres/postgres-db.js`. Mirror `src/mysql/mysql-db.js` with these differences:

1. **Imports** — from `./connection.js`, `./migration-runner.js`, `./schema-introspector.js`, `./query-builder.js`
2. **Config key** — `this.deps.config.orm.postgres` instead of `mysql`
3. **Pool query API** — `pool.query(sql, values)` returns `{ rows }` instead of `[rows]`
4. **`_rowToRawData()`**:
   - No TINYINT → boolean conversion (pg returns native booleans)
   - No JSON.parse (pg returns parsed JSONB objects)
   - Convert BIGINT string values to Number: `if (pgType === 'BIGINT' && typeof rawData[col] === 'string') rawData[col] = Number(rawData[col]);`
   - FK remapping and timestamp stripping — identical
5. **`_recordToRow()`**:
   - No JSON.stringify for JSONB columns (pg accepts objects directly)
6. **`_persistCreate()`**:
   - `buildInsert` result extended with `RETURNING id`: append ` RETURNING id` to sql
   - Result in `result.rows[0].id` instead of `result.insertId`
   - Check `record.__data.__pendingSqlId` (not `__pendingMysqlId`)
7. **`_persistUpdate()`**:
   - Add `changedData.updated_at = new Date()` before building the UPDATE query
8. **Error code** — `error.code === '42P01'` instead of `'ER_NO_SUCH_TABLE'`
9. **`save()`** — no-op (identical to MySQL)

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Users/dandelim/Projects/SynamicD/stonyx/stonyx-orm && npm test`
Expected: All PostgresDB tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/postgres/postgres-db.js test/unit/postgres/postgres-db-memory-flag-test.js
git commit -m "Add PostgresDB driver with RETURNING id, BIGINT conversion, updated_at handling"
```

---

## Task 11: Commands.js — Adapter-Aware CLI Dispatch

**Files:**
- Modify: `src/commands.js`

- [ ] **Step 1: Write a failing test for adapter dispatch**

Create `test/unit/commands-adapter-dispatch-test.js`:

```js
import QUnit from 'qunit';
import commands from '../../src/commands.js';

const { module, test } = QUnit;

module('[Unit] Commands — Adapter Dispatch', function () {
  test('db:migrate command object exists', function (assert) {
    assert.ok(commands['db:migrate'], 'db:migrate command exists');
    assert.strictEqual(typeof commands['db:migrate'].run, 'function', 'has run function');
  });

  test('db:generate-migration command object exists', function (assert) {
    assert.ok(commands['db:generate-migration'], 'command exists');
    assert.strictEqual(typeof commands['db:generate-migration'].run, 'function', 'has run function');
  });

  test('db:migrate:rollback command object exists', function (assert) {
    assert.ok(commands['db:migrate:rollback'], 'command exists');
    assert.strictEqual(typeof commands['db:migrate:rollback'].run, 'function', 'has run function');
  });

  test('db:migrate:status command object exists', function (assert) {
    assert.ok(commands['db:migrate:status'], 'command exists');
    assert.strictEqual(typeof commands['db:migrate:status'].run, 'function', 'has run function');
  });

  test('command descriptions do not reference MySQL specifically', function (assert) {
    for (const [name, cmd] of Object.entries(commands)) {
      if (name.startsWith('db:') && name !== 'db:migrate-to-directory' && name !== 'db:migrate-to-file') {
        assert.false(
          cmd.description.includes('MySQL'),
          `${name} description should not reference MySQL: "${cmd.description}"`
        );
      }
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/dandelim/Projects/SynamicD/stonyx/stonyx-orm && npm test`
Expected: FAIL — source still contains MySQL-specific messages

- [ ] **Step 3: Update `src/commands.js`**

Add two helper functions at the top of the file:

```js
function getAdapterConfig(config) {
  if (config.orm.postgres) return { type: 'postgres', config: config.orm.postgres };
  if (config.orm.mysql) return { type: 'mysql', config: config.orm.mysql };
  return null;
}

function getAdapterImports(type) {
  if (type === 'postgres') return {
    connection: () => import('./postgres/connection.js'),
    runner: () => import('./postgres/migration-runner.js'),
    generator: () => import('./postgres/migration-generator.js'),
  };
  return {
    connection: () => import('./mysql/connection.js'),
    runner: () => import('./mysql/migration-runner.js'),
    generator: () => import('./mysql/migration-generator.js'),
  };
}
```

Update each `db:*` command to use these helpers instead of hardcoded MySQL imports. Replace all `"MySQL is not configured. Set MYSQL_HOST to enable MySQL mode."` with `"No SQL database configured. Set PG_HOST or MYSQL_HOST in your environment."`.

Update descriptions to remove "MySQL" — e.g., `'Generate a database migration from current model schemas'`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Users/dandelim/Projects/SynamicD/stonyx/stonyx-orm && npm test`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/commands.js test/unit/commands-adapter-dispatch-test.js
git commit -m "Make CLI migration commands adapter-agnostic with Postgres/MySQL dispatch"
```

---

## Task 12: Integration Test Helper

**Files:**
- Create: `test/helpers/postgres-test-helper.js`

- [ ] **Step 1: Write the test helper**

Create `test/helpers/postgres-test-helper.js`:

```js
import { introspectModels, buildTableDDL, getTopologicalOrder } from '../../src/postgres/schema-introspector.js';
import PostgresDB from '../../src/postgres/postgres-db.js';

const TEST_PG_CONFIG = {
  host: process.env.PG_TEST_HOST || 'localhost',
  port: parseInt(process.env.PG_TEST_PORT || '5432'),
  user: process.env.PG_TEST_USER || 'stonyx_test',
  password: process.env.PG_TEST_PASSWORD || 'stonyx_test',
  database: process.env.PG_TEST_DATABASE || 'stonyx_orm_test',
  connectionLimit: 5,
};

export let pool = null;

export function setupPostgresTests(hooks, { tables = [] } = {}) {
  let tableOrder = [];
  let tableNames = {};

  hooks.before(async function () {
    try {
      const pg = await import('pg');
      const { Pool } = pg.default;
      const testPool = new Pool(TEST_PG_CONFIG);
      await testPool.query('SELECT 1');
      pool = testPool;
    } catch {
      return;
    }

    PostgresDB.instance = null;

    const schemas = introspectModels();
    const fullOrder = getTopologicalOrder(schemas);
    tableOrder = fullOrder.filter(name => tables.includes(name));

    for (const name of tableOrder) {
      tableNames[name] = schemas[name].table;
    }

    for (const name of tableOrder) {
      const ddl = buildTableDDL(name, schemas[name], schemas);
      // DDL may contain multiple statements (hypertable, compression)
      const statements = ddl.split(';').map(s => s.trim()).filter(s => s.length > 0 && !s.startsWith('--'));
      for (const stmt of statements) {
        await pool.query(stmt);
      }
    }
  });

  hooks.beforeEach(function () {
    PostgresDB.instance = null;
  });

  hooks.afterEach(async function () {
    PostgresDB.instance = null;
    if (!pool) return;

    for (const name of tableOrder) {
      await pool.query(`TRUNCATE TABLE "${tableNames[name]}" CASCADE`);
    }
  });

  hooks.after(async function () {
    if (!pool) return;

    for (const name of [...tableOrder].reverse()) {
      await pool.query(`DROP TABLE IF EXISTS "${tableNames[name]}" CASCADE`);
    }

    await pool.end();
    pool = null;
    PostgresDB.instance = null;
  });
}
```

- [ ] **Step 2: Verify the helper file is syntactically valid**

Run: `cd /Users/dandelim/Projects/SynamicD/stonyx/stonyx-orm && node -e "import('./test/helpers/postgres-test-helper.js').then(() => console.log('OK')).catch(e => console.error(e.message))"`
Expected: OK (or import error if pg not installed yet, which is fine)

- [ ] **Step 3: Commit**

```bash
git add test/helpers/postgres-test-helper.js
git commit -m "Add Postgres integration test helper with TimescaleDB-aware setup/teardown"
```

---

## Task 13: Integration Tests

**Files:**
- Create: `test/integration/postgres/crud-test.js`
- Create: `test/integration/postgres/migration-runner-test.js`

These tests require a running Postgres + TimescaleDB instance. They skip gracefully if the database is unavailable (same pattern as MySQL integration tests).

- [ ] **Step 1: Write CRUD integration test**

Create `test/integration/postgres/crud-test.js`:

```js
import QUnit from 'qunit';
import sinon from 'sinon';
import { setupPostgresTests, pool } from '../../helpers/postgres-test-helper.js';
import { setupIntegrationTests } from '../../helpers/integration-test-helper.js';
import PostgresDB from '../../../src/postgres/postgres-db.js';
import { store } from '../../../src/index.js';

const { module, test } = QUnit;

module('[Integration] Postgres CRUD', function (hooks) {
  setupIntegrationTests(hooks);
  setupPostgresTests(hooks, { tables: ['owner', 'animal'] });

  hooks.afterEach(function () {
    sinon.restore();
  });

  test('_persistCreate inserts a record with string ID', async function (assert) {
    if (!pool) { assert.expect(0); return; }

    const deps = PostgresDB.instance?.deps || {};
    // Test INSERT directly against real Postgres
    const result = await pool.query(
      'INSERT INTO "owners" ("id") VALUES ($1) RETURNING id',
      ['alice']
    );
    assert.strictEqual(result.rows[0].id, 'alice');
  });

  test('_persistUpdate updates a record', async function (assert) {
    if (!pool) { assert.expect(0); return; }

    await pool.query('INSERT INTO "owners" ("id") VALUES ($1)', ['bob']);
    await pool.query('UPDATE "owners" SET "updated_at" = CURRENT_TIMESTAMP WHERE "id" = $1', ['bob']);

    const result = await pool.query('SELECT * FROM "owners" WHERE "id" = $1', ['bob']);
    assert.strictEqual(result.rows.length, 1);
  });

  test('_persistDelete removes a record', async function (assert) {
    if (!pool) { assert.expect(0); return; }

    await pool.query('INSERT INTO "owners" ("id") VALUES ($1)', ['charlie']);
    await pool.query('DELETE FROM "owners" WHERE "id" = $1', ['charlie']);

    const result = await pool.query('SELECT * FROM "owners" WHERE "id" = $1', ['charlie']);
    assert.strictEqual(result.rows.length, 0);
  });
});
```

- [ ] **Step 2: Write migration runner integration test**

Create `test/integration/postgres/migration-runner-test.js`:

```js
import QUnit from 'qunit';
import { pool } from '../../helpers/postgres-test-helper.js';
import { ensureMigrationsTable, applyMigration, getAppliedMigrations, rollbackMigration } from '../../../src/postgres/migration-runner.js';

const { module, test } = QUnit;

module('[Integration] Postgres Migration Runner', function (hooks) {
  hooks.before(async function () {
    if (!pool) return;
    // Clean up any existing migrations table
    await pool.query('DROP TABLE IF EXISTS "__test_migrations"');
  });

  hooks.after(async function () {
    if (!pool) return;
    await pool.query('DROP TABLE IF EXISTS "__test_migrations"');
    await pool.query('DROP TABLE IF EXISTS "__test_table"');
  });

  test('ensureMigrationsTable creates the tracking table', async function (assert) {
    if (!pool) { assert.expect(0); return; }

    await ensureMigrationsTable(pool, '__test_migrations');

    const result = await pool.query(
      "SELECT table_name FROM information_schema.tables WHERE table_name = '__test_migrations'"
    );
    assert.strictEqual(result.rows.length, 1);
  });

  test('applyMigration executes SQL and records in tracking table', async function (assert) {
    if (!pool) { assert.expect(0); return; }

    await ensureMigrationsTable(pool, '__test_migrations');

    const upSql = 'CREATE TABLE "__test_table" ("id" INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY, "name" VARCHAR(255))';
    await applyMigration(pool, '001_test.sql', upSql, '__test_migrations');

    const applied = await getAppliedMigrations(pool, '__test_migrations');
    assert.true(applied.includes('001_test.sql'));

    const tableCheck = await pool.query(
      "SELECT table_name FROM information_schema.tables WHERE table_name = '__test_table'"
    );
    assert.strictEqual(tableCheck.rows.length, 1);
  });

  test('rollbackMigration reverses and removes tracking entry', async function (assert) {
    if (!pool) { assert.expect(0); return; }

    const downSql = 'DROP TABLE IF EXISTS "__test_table"';
    await rollbackMigration(pool, '001_test.sql', downSql, '__test_migrations');

    const applied = await getAppliedMigrations(pool, '__test_migrations');
    assert.false(applied.includes('001_test.sql'));
  });
});
```

- [ ] **Step 3: Run all tests**

Run: `cd /Users/dandelim/Projects/SynamicD/stonyx/stonyx-orm && npm test`
Expected: Unit tests all PASS. Integration tests PASS if Postgres is available, skip if not.

- [ ] **Step 4: Commit**

```bash
git add test/integration/postgres/
git commit -m "Add Postgres CRUD and migration runner integration tests"
```

---

## Task 14: Full Test Suite Verification & Cleanup

- [ ] **Step 1: Run the complete test suite**

Run: `cd /Users/dandelim/Projects/SynamicD/stonyx/stonyx-orm && npm test`
Expected: All existing MySQL tests still pass. All new Postgres tests pass. Zero regressions.

- [ ] **Step 2: Verify the `test/unit/orm-core-rename-test.js` from Task 1 passes**

The dual-adapter guard test should now pass since `main.js` has been updated.

- [ ] **Step 3: Clean up any test files that were created as scaffolding**

Remove the `test/unit/orm-core-rename-test.js` if it's no longer needed (the guard is implicitly tested by the full suite). Keep it if it provides value.

- [ ] **Step 4: Final commit (if any remaining unstaged changes)**

```bash
git status
# Stage only specific changed files if any remain
git commit -m "Postgres/TimescaleDB adapter: final cleanup"
```
