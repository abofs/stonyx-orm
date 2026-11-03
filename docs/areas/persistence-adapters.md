# Persistence Adapters

What this area owns: translating [Store](../internals.md) records to and from each configured backend's storage shape — schema introspection, DDL/migration generation where applicable, query building from model definitions, and the read/write paths each backend uses. It does not own the backend's own wire protocol or client behavior; that belongs to the backend's own driver (see [docs/index.md — Dependencies](../index.md#dependencies)).

Five backends exist. The first two need no external service; the other three are optional peers and are only imported when selected by configuration (`src/*/connection.ts`, lazy `await import(...)`, documented in [project-structure.md](../project-structure.md)).

## JSON file / directory — `src/db.ts`

Default backend. Two modes, `DB_MODE='file'` (single `db.json`) or `DB_MODE='directory'` (one file per collection, e.g. `db/animals.json`, with `db.json` kept as an empty-array skeleton). Auto-save is `DB_AUTO_SAVE`: `'false'` (manual `Orm.db.save()` only), `'true'` (interval save via `@stonyx/cron`, `DB_SAVE_INTERVAL` seconds), or `'onUpdate'` (save after every REST create/update/delete). `src/migrate.ts` converts between the two modes (`fileToDirectory()`/`directoryToFile()`, also exposed as `stonyx db:migrate-to-directory` / `stonyx db:migrate-to-file`). Per [security.md](../security.md), this backend has no protection beyond filesystem permissions — no encryption, no access control at the storage layer.

## MySQL — `src/mysql/`

Enabled by setting `MYSQL_HOST`. `src/mysql/connection.ts` manages a `mysql2` connection pool; `src/mysql/mysql-db.ts` implements the shared adapter interface (`init`, `startup`, `shutdown`, `persist`, `findRecord`, `findAll`) and loads into memory only models with `static memory = true`, matching the [Store read-path rules](../internals.md#store-reads-and-the-memory-flag). `src/mysql/schema-introspector.ts` turns model definitions into table/column/FK schemas (and view metadata for [Views](../views.md)); `src/mysql/migration-generator.ts` diffs that against a `.snapshot.json` to produce `.sql` migration files; `src/mysql/migration-runner.ts` applies/rolls them back transactionally and tracks them in a `__migrations` table; `src/mysql/type-map.ts` maps `attr()` types to MySQL column types (`attr('number')` → `INT`); `src/mysql/query-builder.ts` builds parameterized INSERT/UPDATE/DELETE/SELECT SQL (values bound as placeholders; table/column names are interpolated only after `validateIdentifier`, per [security.md](../security.md)).

Writes use the same serial, batched, bounded queue as the PostgreSQL adapter below (#309): consecutive same-model creates are coalesced into one multi-row INSERT (`buildInsertMany`), up to `writeBatchSize` rows (default 500, `MYSQL_WRITE_BATCH_SIZE`) and at most 65535 placeholders, with a per-row retry when a batch fails; `writeQueueLimit` (default 10000, `MYSQL_WRITE_QUEUE_LIMIT`) rejects writes past it with `WriteQueueFullError`; `shutdown()` drains the queue and an exit without it logs the lost writes per model. MySQL has no `RETURNING`, so a batch of pending auto-increment rows is re-keyed as `insertId`, `insertId + 1`, and so on. That assumes `auto_increment_increment = 1` (the MySQL default) and relies on InnoDB allocating consecutive ids to a simple multi-row INSERT. Pending-id rows are never batched with explicit-id rows, which keeps every batch a simple insert.

## PostgreSQL — `src/postgres/`

Enabled by setting `orm.postgres` (or `orm.timescale` — see below). `src/postgres/connection.ts` wraps the `pg` driver; `src/postgres/postgres-db.ts`, `src/postgres/schema-introspector.ts`, `src/postgres/migration-generator.ts`, `src/postgres/migration-runner.ts`, `src/postgres/query-builder.ts`, `src/postgres/column-rules.ts`, and `src/postgres/type-map.ts` are the PostgreSQL-shaped counterparts of the MySQL files above (`attr('number')` → `INTEGER` here, not `INT`).

Writes go through one serial write queue per adapter instance, so only one statement is ever in flight and FK-linked writes cannot deadlock each other (#156). Consecutive queued creates for the same model are coalesced into one multi-row `INSERT ... VALUES (...), (...) RETURNING "id"` (`buildInsertMany`), up to `writeBatchSize` rows (default 500, `PG_WRITE_BATCH_SIZE`) and never more than PostgreSQL's 65535 bind parameters; a column a row lacks is written as `DEFAULT`, and pending auto-increment ids are re-keyed from `RETURNING` in row order. An update or delete is never merged, so a record's create always lands before its own later update. If a multi-row insert fails, each of its rows is retried alone, so only the bad row's `persist()` rejects (and reaches `emitPersistError`) while its siblings land. The queue holds at most `writeQueueLimit` waiting writes (default 10000, `PG_WRITE_QUEUE_LIMIT`); past that, `persist()` rejects with `WriteQueueFullError` instead of growing memory without bound. Durability is accepted loss, made visible: `shutdown()` stops accepting writes (`WriteQueueClosedError`) and drains the queue before closing the pool, while a process that exits without `shutdown()` logs an error naming how many queued writes were lost, per model. `pendingWriteCount` reports in-flight plus queued writes. TimescaleDB inherits all of this, with `TIMESCALE_WRITE_BATCH_SIZE` and `TIMESCALE_WRITE_QUEUE_LIMIT`. The MySQL adapter queues writes the same way (see MySQL, above). The repo's PostgreSQL integration test fixtures additionally exercise `pgvector` (the `vector` extension, `CREATE EXTENSION IF NOT EXISTS vector`) — that extension and the test database/credentials it expects are local dev/test infrastructure for this adapter, not code shipped by stonyx-orm.

## TimescaleDB — `src/timescale/`

`TimescaleDB` (`src/timescale/timescale-db.ts`) extends `PostgresDB` and adds hypertables, time buckets, continuous aggregates, and compression on top of the same PostgreSQL connection, migrations, and query builder (`src/timescale/query-builder.ts` extends the PostgreSQL one). It is reached through the same shared adapter interface as the other three database adapters, so a change to that interface in `src/main.ts` touches MySQL, PostgreSQL, TimescaleDB, and DynamoDB together.

## DynamoDB — `src/dynamodb/`

Enabled by setting `DYNAMODB_REGION`. `src/dynamodb/connection.ts` and `src/dynamodb/dynamodb-db.ts` lazily import `@aws-sdk/client-dynamodb` and `@aws-sdk/lib-dynamodb` only when this adapter is selected. Tables are provisioned PAY_PER_REQUEST; a Global Secondary Index is auto-created per `belongsTo` foreign-key column, based on the owning model's relationships (`src/dynamodb/operation-builder.ts`, `src/dynamodb/type-map.ts`). `findAll()` with a condition on an indexed FK routes to a GSI `Query`; a condition on a non-indexed attribute falls back to `Scan` + `FilterExpression`. ULID generation replaces auto-increment for numeric-ID models. The `memory` flag and the "`belongsTo` resolves only when the related record is already in memory" rule work the same way here as for the SQL adapters. Every AWS SDK call is injected through a `DynamoDBDeps` argument, which is what lets `test/unit/dynamodb/` run fully offline, without the SDK or a real/local DynamoDB endpoint.

## Known rough edges (open, on-hold — stated factually, not fixed here)

As of this documentation pass, seven GitHub issues on `abofs/stonyx-orm` describe adapter bugs. All seven carry both the `bug` and `on-hold` labels — `on-hold` means "excluded from sprint cycle; do not triage, refine, or sprint-plan unless explicitly unlocked." They are listed here so this document doesn't quietly imply these adapters are bug-free; none of them was investigated, reproduced, or fixed as part of this pass.

DynamoDB adapter:

- **`abofs/stonyx-orm#301`** — `Orm.db.findRecord` on a `memory: true` model overwrites the live in-memory record with stale DynamoDB values.
- **`abofs/stonyx-orm#300`** — `createRecord` immediately followed by `updateRecord` in the same tick loses fields that were only present on the create.
- **`abofs/stonyx-orm#299`** — no awaitable write or flush; a short-lived entry script (e.g. a one-shot script or Lambda) can exit before a write actually lands.
- **`abofs/stonyx-orm#297`** — a `belongsTo` to a numeric-id model fails because the FK's auto-provisioned GSI attribute is typed `'S'` (string) instead of matching the numeric id.
- **`abofs/stonyx-orm#302`** — `Orm.shutdown()` fails pending writes outright instead of draining them before the process exits.

File-DB adapter:

- **`abofs/stonyx-orm#298`** — `create()` does not await `createFile()`, so the first `save()` after a fresh boot can fail with `ENOENT`.

Test suite:

- **`abofs/stonyx-orm#303`** — `pnpm test:dynamodb` hangs after its tests pass, because its glob omits `test/zz-exit-test.ts`, the file the other test scripts rely on to force the process to exit. (Separately, `test/integration/dynamodb/stress-test.ts` is matched by `pnpm test`'s own glob and runs under `test/setup.ts`/`NODE_ENV=test` rather than the DynamoDB setup; with no DynamoDB Local reachable it reports "ok" with zero assertions after a multi-second health-check retry — see [testing.md](../testing.md) and [docs/index.md — Build, Run, Test](../index.md#build-run-test).)

None of the above affects the JSON file/directory, MySQL, PostgreSQL, or TimescaleDB adapters.
