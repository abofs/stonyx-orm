# Internals

Behaviour of the ORM's internals that is easy to get wrong when changing the source. The source layout is in [Project Structure](project-structure.md).

## Store reads and the `memory` flag

- `Model.memory` defaults to `false` (`src/model.ts`). Set `static memory = true` on a model to have a database adapter (MySQL, Postgres, TimescaleDB or DynamoDB) load its records into the store at startup; each adapter's `loadMemoryRecords()` skips every model whose flag is `false` (`src/mysql/mysql-db.ts`, `src/postgres/postgres-db.ts`, `src/dynamodb/dynamodb-db.ts`).
- `store.get(model, id)` is synchronous and reads memory only. `store.find()` and `store.findAll()` are async: for a `memory: true` model they read the store, for any other model they query the database adapter when one is configured, and in JSON file or directory mode they fall back to the store (`src/store.ts`). `store.query()` always goes to the database adapter when one exists. Calling `get()` on a `memory: false` model with a database adapter returns stale or missing data.
- A record that `find()` reads from a database adapter (MySQL, Postgres, TimescaleDB or DynamoDB) resolves a `belongsTo` only when the related record is already in the store; otherwise the relationship is `null` (its linkage is `{ data: null }`), even though the foreign key was read. With both `animal` and `owner` left at `memory: false`, `(await store.find('animal', id)).owner` is `null`.
- `createRecord()` on a `memory: false` model persists through the database adapter and then evicts the record from the store once the write settles (`src/manage-record.ts`).

## Two write paths

- REST requests go through `src/orm-request.ts`: `access()`, then before hooks, the handler, SQL persistence, after hooks.
- Programmatic writes are `createRecord()`, `updateRecord()` and `store.remove()`. They persist to SQL fire-and-forget and run no access class and no hooks. A persist failure is reported through `Orm.instance.emitPersistError()` rather than thrown.

## Unloading records

`store.unloadRecord()` cleans up in a fixed order for each record (`src/store.ts`): the record is spliced out of every `hasMany` array that holds it, every `belongsTo` that points at it is set to `null`, then its relationship registry entries are removed, and finally the record is deleted from the store. With `includeChildren`, records are queued first and unloaded in reverse order. `unloadAllRecords()` also clears the model from every registry in `TYPES` (`src/relationships.ts`).

## SQL adapters

- MySQL, PostgreSQL and TimescaleDB implement the `SqlDb` interface in `src/main.ts` (`init`, `startup`, `shutdown`, `persist`, `findRecord`, `findAll`). `Orm.init()` also uses `DynamoDBDB` (`src/dynamodb/dynamodb-db.ts`) through that interface, so a change to it touches all four adapters.
- `TimescaleDB` extends `PostgresDB` (`src/timescale/timescale-db.ts`) and adds hypertables, time buckets, continuous aggregates and compression on top of the PostgreSQL connection and migrations.
- Attribute types map differently per adapter: `attr('number')` is `INT` in MySQL (`src/mysql/type-map.ts`) and `INTEGER` in PostgreSQL (`src/postgres/type-map.ts`). Migration drift detection compares against the adapter's own map.

## Initialisation

`Orm.init()` collects the DB and REST setup promises and assigns `Orm.ready = await Promise.all(promises)` (`src/main.ts`), so one failing sub-initialisation rejects `init()`.

## Published files

`files` in `package.json` publishes `dist`, `src`, `config` and `README.md`. Source files ship to consumers, so they must not contain debug output or imports of test-only code.
