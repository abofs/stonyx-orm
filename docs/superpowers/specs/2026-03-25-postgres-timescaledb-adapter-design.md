# Postgres/TimescaleDB Adapter Design

Add a first-class Postgres/TimescaleDB adapter to `@stonyx/orm`, mirroring the MySQL adapter's structure and conventions. The adapter lives inside the ORM library, making it available to all Stonyx projects.

---

## Approach

Mirror MySQL — full parallel adapter (Approach C). Create `src/postgres/` with 7 files matching `src/mysql/`. No shared code extraction — each adapter evolves independently. Refactoring to extract shared logic deferred until a third adapter is needed.

---

## Scope

- Standard Postgres CRUD persistence (create, read, update, delete)
- Schema introspection from ORM models
- Auto-migration generation and execution
- Connection pooling via `pg` (node-postgres)
- TimescaleDB hypertable creation for time-series models
- TimescaleDB compression policies
- Memory/non-memory model support (same as MySQL)
- View support with aggregates

Out of scope: continuous aggregates, retention policies, TimescaleDB-specific query extensions.

---

## File Structure

```
src/postgres/
├── postgres-db.js           # Main driver (mirrors mysql-db.js)
├── connection.js            # pg Pool management
├── type-map.js              # ORM types → Postgres column types
├── query-builder.js         # SQL generation with $1 params and "quoted" identifiers
├── schema-introspector.js   # Model → Postgres schema, DDL with hypertable/compression
├── migration-generator.js   # Schema diff → .sql migration files
└── migration-runner.js      # Apply/rollback migrations with transactions
```

---

## Connection Management

Uses the `pg` library (node-postgres). Pool API mirrors mysql2:

```js
import pg from 'pg';
const { Pool } = pg;

let pool = null;

export async function getPool(postgresConfig) {
  if (pool) return pool;
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

### Consumer Configuration

```js
// config/environment.js
orm: {
  postgres: {
    host: process.env.PG_HOST,
    port: process.env.PG_PORT ?? 5432,
    user: process.env.PG_USER ?? 'postgres',
    password: process.env.PG_PASSWORD ?? '',
    database: process.env.PG_DATABASE ?? 'stonyx',
    connectionLimit: process.env.PG_CONNECTION_LIMIT ?? 10,
    migrationsDir: process.env.PG_MIGRATIONS_DIR ?? 'migrations',
    migrationsTable: '__migrations',
  }
}
```

### Peer Dependency

`pg` is added as an optional peer dependency alongside `mysql2`:

```json
"peerDependencies": {
  "mysql2": "^3.0.0",
  "pg": "^8.0.0",
  "@stonyx/rest-server": ">=0.2.1-beta.14"
},
"peerDependenciesMeta": {
  "mysql2": { "optional": true },
  "pg": { "optional": true },
  "@stonyx/rest-server": { "optional": true }
}
```

---

## Type Mapping

Maps ORM attribute types to Postgres column types via `getPostgresType()`.

| ORM Type | MySQL | Postgres |
|----------|-------|----------|
| `string` | `VARCHAR(255)` | `VARCHAR(255)` |
| `number` | `INT` | `INTEGER` |
| `float` | `FLOAT` | `DOUBLE PRECISION` |
| `boolean` | `TINYINT(1)` | `BOOLEAN` |
| `date` | `DATETIME` | `TIMESTAMPTZ` |
| `timestamp` | `BIGINT` | `BIGINT` |
| `passthrough` | `TEXT` | `TEXT` |
| Custom transform | `JSON` | `JSONB` |

Key differences:
- **`BOOLEAN`** — native booleans, no TINYINT conversion in `_rowToRawData`
- **`TIMESTAMPTZ`** — timezone-aware timestamps
- **`DOUBLE PRECISION`** — better numeric fidelity for odds and statistics
- **`JSONB`** — binary JSON with indexing, better query performance than MySQL's text JSON

Custom transforms export `postgresType` (following the `mysqlType` convention):

```js
export function getPostgresType(attrType, transformFn) {
  if (typeMap[attrType]) return typeMap[attrType];
  if (transformFn?.postgresType) return transformFn.postgresType;
  return 'JSONB';
}
```

---

## Query Builder

Same four functions as MySQL with two syntax differences:
1. Parameterized queries use `$1, $2, $3` instead of `?`
2. Identifier quoting uses `"double quotes"` instead of `` `backticks` ``

```js
buildInsert(table, data)
// INSERT INTO "matches" ("id", "home_team") VALUES ($1, $2)

buildUpdate(table, id, data)
// UPDATE "matches" SET "home_team" = $1 WHERE "id" = $2

buildDelete(table, id)
// DELETE FROM "matches" WHERE "id" = $1

buildSelect(table, conditions)
// SELECT * FROM "matches" WHERE "status" = $1
```

`validateIdentifier()` and `SAFE_IDENTIFIER` regex are identical to MySQL.

---

## Schema Introspection & DDL Generation

### `introspectModels()`

Same model-walking logic as MySQL. Calls `getPostgresType()` instead of `getMysqlType()`. Additionally reads two generic model properties:

- `static timeSeries = 'timestamp'` — declares time-series data, naming the time column
- `static compression = { after: '7d' }` — declares a compression policy

These are captured in the schema object:

```js
schemas[name] = {
  table, idType, columns, foreignKeys, relationships,
  memory: modelClass.memory === true,
  timeSeries: modelClass.timeSeries || null,
  compression: modelClass.compression || null,
};
```

### `buildTableDDL()`

Key differences from MySQL:

**Primary keys:**
```sql
-- Numeric: SERIAL PRIMARY KEY (replaces INT AUTO_INCREMENT PRIMARY KEY)
-- String:  VARCHAR(255) PRIMARY KEY
```

**Timestamps:**
```sql
"created_at" TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
"updated_at" TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
-- No ON UPDATE CURRENT_TIMESTAMP (Postgres doesn't support this syntax)
```

**Foreign key constraints** — identical logic, `"` quoting instead of backticks.

### Hypertable DDL

For models with `static timeSeries`, after the `CREATE TABLE`:

```sql
SELECT create_hypertable('stat_snapshots', 'timestamp');
```

If `timeSeries` names a column that doesn't exist in the schema, introspection throws an error.

**FK constraint handling:** Hypertable target tables omit `FOREIGN KEY ... REFERENCES` constraints (TimescaleDB limitation). The FK column itself (`match_id VARCHAR(255)`) is still created. Relationship enforcement stays at the ORM level.

### Compression Policy DDL

For models with both `timeSeries` and `compression`:

```sql
ALTER TABLE "stat_snapshots" SET (
  timescaledb.compress,
  timescaledb.compress_segmentby = 'match_id'
);
SELECT add_compression_policy('stat_snapshots', INTERVAL '7 days');
```

`compress_segmentby` is inferred from the model's `belongsTo` FK column — the natural segmentation for time-series data grouped by parent entity.

### Views

`introspectViews()` and `buildViewDDL()` follow the same pattern as MySQL with Postgres quoting.

---

## Main Driver (`postgres-db.js`)

### Class Structure

`PostgresDB` mirrors `MysqlDB` — same singleton pattern, dependency injection, public API:

```
constructor(deps) → init() → startup() → shutdown()
                      ↓
                loadMemoryRecords()

persist(operation, modelName, context, response)
  → _persistCreate() / _persistUpdate() / _persistDelete()

findRecord(modelName, id)
findAll(modelName, conditions)
```

### Differences from MysqlDB

**`_rowToRawData()`** — simpler:
- No TINYINT(1) → boolean conversion (`pg` returns native booleans)
- No manual JSON.parse for JSONB columns (`pg` returns parsed objects)
- FK remapping and timestamp stripping remain the same

**`_recordToRow()`** — simpler:
- No JSON.stringify for JSONB columns (`pg` accepts JS objects directly)

**`_persistCreate()`** — uses `RETURNING id`:
```sql
INSERT INTO "matches" ("home_team") VALUES ($1) RETURNING id
```
ID comes back in `rows[0].id` instead of MySQL's `result.insertId`. Re-keying logic for auto-increment IDs is identical.

**Error codes:**
- MySQL: `error.code === 'ER_NO_SUCH_TABLE'`
- Postgres: `error.code === '42P01'` (undefined_table)

**`_evictIfNotMemory()`** — identical, no changes.

### Integration with `main.js`

Selection logic expands:

```js
if (config.orm.mysql) {
  const { default: MysqlDB } = await import('./mysql/mysql-db.js');
  this.mysqlDb = new MysqlDB();
  this.db = this.mysqlDb;
  promises.push(this.mysqlDb.init());
} else if (config.orm.postgres) {
  const { default: PostgresDB } = await import('./postgres/postgres-db.js');
  this.postgresDb = new PostgresDB();
  this.db = this.postgresDb;
  promises.push(this.postgresDb.init());
} else if (this.options.dbType !== 'none') {
  const db = new DB();
  this.db = db;
  promises.push(db.init());
}
```

Store wiring reuses `_mysqlDb` property name (private, same interface):

```js
if (this.mysqlDb) {
  Orm.store._mysqlDb = this.mysqlDb;
} else if (this.postgresDb) {
  Orm.store._mysqlDb = this.postgresDb;
}
```

`startup()` and `shutdown()` expand to handle both adapters.

---

## Migration System

### Migration Runner

Functionally identical to MySQL. Key differences:

**`ensureMigrationsTable()`:**
```sql
CREATE TABLE IF NOT EXISTS "__migrations" (
  id SERIAL PRIMARY KEY,
  filename VARCHAR(255) NOT NULL UNIQUE,
  applied_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
)
```

**Transaction API:**
```js
const client = await pool.connect();
try {
  await client.query('BEGIN');
  for (const stmt of statements) {
    await client.query(stmt);
  }
  await client.query('INSERT INTO "__migrations" (filename) VALUES ($1)', [filename]);
  await client.query('COMMIT');
} catch (error) {
  await client.query('ROLLBACK');
  throw error;
} finally {
  client.release();
}
```

**`parseMigrationFile()`, `getMigrationFiles()`, `splitStatements()`** — identical to MySQL.

### Migration Generator

Same diffing logic. SQL string differences:

- Quoting: `"table"` instead of `` `table` ``
- Column alteration: `ALTER COLUMN "c" TYPE NEW_TYPE` instead of `MODIFY COLUMN`
- Drop FK: `DROP CONSTRAINT "t_fk_col_fkey"` instead of `DROP FOREIGN KEY`
- New tables with `timeSeries`: appends `create_hypertable()` and optional compression DDL
- Snapshot includes `timeSeries` and `compression` fields for drift detection

---

## Testing Strategy

### Unit Tests (`test/unit/postgres/`)

Mirror MySQL unit test structure with sinon stubs:

| Test File | Coverage |
|-----------|----------|
| `postgres-db-memory-flag-test.js` | Memory flag behavior, findRecord eviction, on-demand queries |
| `postgres-db-startup-test.js` | Migration detection, schema drift, initial migration prompt |
| `query-builder-test.js` | `$1` parameterization, `"` quoting, identifier validation |
| `schema-introspector-test.js` | Model introspection, `timeSeries`/`compression` capture |
| `type-map-test.js` | Type mappings, custom `postgresType` on transforms |
| `hypertable-ddl-test.js` | `create_hypertable` DDL, compression DDL, FK omission for hypertables |
| `migration-generator-test.js` | Snapshot diffing, Postgres DDL syntax |

### Integration Tests (`test/integration/postgres/`)

Against real Postgres + TimescaleDB:

| Test File | Coverage |
|-----------|----------|
| `crud-test.js` | `_persistCreate` with `RETURNING id`, update, delete |
| `migration-runner-test.js` | Apply/rollback with transactions |
| `migration-generation-test.js` | End-to-end migration generation |
| `hypertable-test.js` | Hypertable creation, compression policy, querying compressed data |

### Test Helper (`test/helpers/postgres-test-helper.js`)

Mirrors `mysql-test-helper.js`:

```js
export function setupPostgresTests(hooks, { tables = [] } = {}) {
  // hooks.before() — create pool, create tables
  // hooks.beforeEach() — reset PostgresDB singleton
  // hooks.afterEach() — truncate all tables
  // hooks.after() — drop tables, close pool
}
```

Uses `PG_TEST_*` environment variables. Integration tests skip if no database is available.

---

## Design Decisions

| Decision | Rationale |
|----------|-----------|
| Mirror MySQL, no shared code extraction | Zero risk to existing MySQL adapter. Refactor when adapter #3 arrives (YAGNI). |
| `pg` as peer dependency | Standard Node.js Postgres driver. Optional like `mysql2`. |
| `static timeSeries` (generic) over `static hypertable` | Keeps models database-agnostic. Future adapters interpret the same flag. |
| `static compression` (generic) | Same portability principle. TimescaleDB adapter interprets as native compression. |
| `TIMESTAMPTZ` for dates | Timezone-aware. Critical for ML pipelines operating across time zones. |
| `DOUBLE PRECISION` for floats | Better numeric fidelity than MySQL's FLOAT. Important for odds and statistics. |
| `JSONB` for custom transforms | Binary JSON with indexing. Better query performance for ML feature extraction. |
| `RETURNING id` for inserts | Cleaner than MySQL's `insertId`. Single round-trip for insert + ID retrieval. |
| `compress_segmentby` from belongsTo FK | Natural segmentation — queries for a specific parent's time-series data remain efficient after compression. |
| FK constraints omitted on hypertables | TimescaleDB limitation. ORM enforces relationships in memory. |
| Reuse `_mysqlDb` property name on store | Private property, same interface. Avoids touching store.js and risking regressions. |
| `$1` parameterized queries | Standard pg driver convention. Prevents SQL injection same as MySQL's `?`. |
