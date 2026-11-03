# @stonyx/orm Architecture

## Overview

`@stonyx/orm` is the data layer for the Stonyx framework. It gives a Node.js backend built on `stonyx` a way to define models with typed attributes and bidirectional relationships, normalize third-party/raw payloads into those models through serializers and transforms, hold records in an in-memory store, and persist that store to one of several backends — a JSON file, a JSON directory, MySQL, PostgreSQL, TimescaleDB, or DynamoDB. When `@stonyx/rest-server` and an access class are configured, the ORM also generates a JSON:API-shaped REST surface (list/get/create/update/delete, relationship routes, `?include=`/`?fields=`/`?filter=`) for the consuming application, gated by the app's own access classes and before/after hooks.

This file names every area of the codebase by separation of concerns, states what each owns and where it lives, and points at the existing per-area guide for depth. It is not a replacement for [usage-patterns.md](usage-patterns.md), [views.md](views.md), [hooks.md](hooks.md), [internals.md](internals.md), [security.md](security.md), [testing.md](testing.md), or [code-style.md](code-style.md) — those are kept and linked where their content still matches the source (verified against `src/` in this pass).

## Areas

### Models

Owns the shape of a record: attributes (`attr(type)`), relationships (`belongsTo`, `hasMany`), computed getters, and per-model configuration (`static memory`, `static pluralName`). Lives in `src/model.ts`, `src/attr.ts`, `src/model-property.ts`, `src/belongs-to.ts`, `src/has-many.ts`, `src/relationships.ts`; consumer-facing model files live under the app's configured `paths.model` (default `./models`), auto-discovered and registered by `src/main.ts`. `View` (see Views, below) is a deliberately separate base class, not a subclass of `Model`. Full usage is in [usage-patterns.md §1](usage-patterns.md#1-model-definition).

### Serializers / Transforms

Owns mapping raw, possibly poorly-structured input data onto model attributes, and converting attribute values between wire/storage representation and in-memory representation. Serializers (`src/serializer.ts`, app files under `paths.serializer`) define a `map` of target field → source path or transform function. Transforms (`src/transforms.ts` for the built-ins — `boolean`, `number`, `string`, `date`, `round`, `trim`, `passthrough`, etc. — plus app files under `paths.transform`) are the per-value conversion functions a `map` entry or `attr(type)` invokes. `undefined` vs `null` is a deliberate sentinel split here (`undefined` = leave untouched, `null` = explicitly clear), which is what makes PATCH-style partial updates work. See [usage-patterns.md §2–3, §11](usage-patterns.md#2-serializers-data-transformation).

### The Store

Owns the in-memory record cache and its read/write paths: `Store.data` is a `Map<modelName, Map<id, Record>>` (`src/store.ts`), populated via `createRecord()`/`updateRecord()` (`src/manage-record.ts`). Reads split into a synchronous memory-only path (`store.get()`) and async paths that fall through to a configured database adapter for any model not flagged `static memory = true` (`store.find()`, `store.findAll()`, `store.query()`). Writes split into the REST path (`src/orm-request.ts`: `access()` → before hooks → handler → adapter persist → after hooks) and the programmatic path (`createRecord`/`updateRecord`/`store.remove()`, which persist fire-and-forget with no access check and no hooks, reporting failures through `Orm.instance.emitPersistError()` instead of throwing). Full detail, including the `belongsTo`-resolves-only-if-in-memory trap, is in [internals.md](internals.md).

### Persistence Adapters

Owns translating Store records to and from each configured backend's storage shape. Five backends exist: JSON file, JSON directory, MySQL, PostgreSQL, TimescaleDB, and DynamoDB — the first two in `src/db.ts`, the SQL ones in `src/mysql/`, `src/postgres/`, `src/timescale/`, and DynamoDB in `src/dynamodb/`. MySQL, PostgreSQL and TimescaleDB implement the same `SqlDb`-shaped interface described in `src/main.ts` (`init`, `startup`, `shutdown`, `persist`, `findRecord`, `findAll`); `Orm.init()` drives `DynamoDBDB` through that same interface, so the four database adapters move together. This area also carries the repo's known rough edges honestly: seven open, on-hold GitHub issues (`abofs/stonyx-orm#297`–`#303`) describe DynamoDB adapter bugs (a `findRecord` race that overwrites a live `memory:true` record with stale DB values, `createRecord`+`updateRecord` in the same tick losing create-only fields, no awaitable write/flush so short scripts can lose writes, a foreign-key GSI attribute typed `'S'` that breaks `belongsTo` to numeric-id models, `shutdown()` failing pending writes instead of draining them) plus one JSON file-DB bug (`create()` not awaiting `createFile()`, so the first `save()` after a fresh boot can fail with `ENOENT`) and one DynamoDB test-suite bug (`pnpm test:dynamodb` hangs after passing). All seven are labeled `bug` + `on-hold` — tracked, not scheduled, and not touched by this documentation pass. Full per-adapter detail, including these issues, is in [docs/areas/persistence-adapters.md](areas/persistence-adapters.md); the memory-flag/read-path interaction they share with the Store is in [internals.md](internals.md).

### Views

Owns read-only, model-like projections computed from existing model data — aggregates (`count`, `avg`, `sum`, `min`, `max`), a `resolve` escape hatch, and optional `groupBy`. Lives in `src/view.ts`, `src/aggregates.ts`, `src/view-resolver.ts` (in-memory computation for JSON mode), plus `introspectViews()`/`buildViewDDL()` in `src/mysql/schema-introspector.ts` and view-aware diffing in `src/mysql/migration-generator.ts` for MySQL `CREATE OR REPLACE VIEW` generation. Views are enforced read-only at every layer (`createRecord`/`updateRecord`/`store.remove()` all throw) and only mount GET routes. Full guide: [views.md](views.md).

### Hooks

Owns before/after middleware around the five REST CRUD operations (`list`, `get`, `create`, `update`, `delete`). Lives in `src/hooks.ts` (the before/after registries, `beforeHook`/`afterHook`/`clearHook`/`clearAllHooks`) and `src/orm-request.ts` (`_withHooks()`, which runs them sequentially, captures `oldState` for update/delete, and lets a before hook halt the operation by returning any non-`undefined` value). Hooks only fire on the REST path, not on programmatic `createRecord`/`updateRecord`/`store.remove()` calls. Full guide: [hooks.md](hooks.md).

### Access Control / Security

Owns the authorization gate on generated REST routes. Lives in app-level access classes under `paths.access` (`access(request)` returning `false`, an operations array, or a filter function) and the request-side wiring in `src/orm-request.ts` that computes `request.recordId` before `access()` runs. This is the *only* authorization gate on a model's own generated routes; `?include=`, `/:id/<relationship>` and `/:id/relationships/<relationship>` serve related records without consulting the related model's own access class, and before hooks are a second gate layered on top of `access()`, not a substitute for it. Full guide, including the measured `?include=` cost and a capping pattern: [security.md](security.md).

### REST API Surface

Owns the auto-generated JSON:API-shaped routes mounted by `@stonyx/rest-server` for every model named by an access class: `GET /:models`, `GET /:models/:id`, `POST /:models`, `PATCH /:models/:id`, `DELETE /:models/:id`, plus `GET /:models/:id/:relationship` and `GET /:models/:id/relationships/:relationship`. Lives in `src/orm-request.ts` (route handlers, hooks wrapper, `?include=`/`?fields=`/`?filter=` parsing) and `src/setup-rest-server.ts` (route registration, wired lazily so `@stonyx/rest-server` is only required when `restServer.enabled` is `'true'`). This surface is generated **for the consuming application** — see Delivery, below — not served by stonyx-orm itself. Usage: [usage-patterns.md §8–9](usage-patterns.md#8-rest-api-auto-generated); link/mount behavior: [project-structure.md §API/Routes](project-structure.md#api--routes).

## Build, Run, Test

Verified in this environment: node v24.13.0, pnpm 10.23.0, on branch `docs/onboarding` off `dev`.

**Install**
```bash
pnpm install --frozen-lockfile
```
Ran clean — lockfile was already up to date, no resolution step, no lockfile changes. (`pnpm install` without `--frozen-lockfile` was not needed as a fallback.)

**Build**
```bash
pnpm build        # tsc — compiles src/ to dist/
pnpm build:test    # tsc -p tsconfig.test.json — test-only type-check build
```
`pnpm build` is also run implicitly by `pnpm test`, `pnpm test:readme`, `pnpm test:reference`, and `pnpm test:dynamodb`.

**Run**

This package has no standalone runtime of its own. It ships a CLI (`stonyx-orm` → `dist/cli.js`, plus `stonyx db:*` commands registered through `src/commands.ts`) for migrations and DB-mode conversion, but the ORM itself runs embedded inside a Stonyx app via `stonyx serve` — see the README's "Usage example".

**Test**

| Command | What it needs locally | Result here |
|---|---|---|
| `pnpm test` | Nothing strictly required — MySQL/PostgreSQL/DynamoDB-touching tests inside the glob self-skip when their backend is unreachable | **Ran clean, exit 0.** Builds, then `test/**/*-test.ts` under `NODE_ENV=test` (953 pass / 0 fail), then `test:mounted` once per `ORM_TEST_ROUTE` value `/`, `/api`, `api`, `/api/v1`, `/api/` (5–6 pass each), then `test:readme` (36 pass) and `test:reference` (32 pass) |
| `pnpm test:mounted` | A free local port per run (`MOUNTED_REST_PORT`, default 2777) | Ran as part of `pnpm test`, 5 times, clean |
| `pnpm test:readme` | A free local port (`README_REST_PORT`, default 2888) | Ran as part of `pnpm test`, clean |
| `pnpm test:reference` | A free local port (`REFERENCE_REST_PORT`, default 2999) | Ran as part of `pnpm test`, clean |
| `pnpm test:dynamodb` | DynamoDB Local reachable at `http://localhost:8000` | **Not run** — no DynamoDB Local was listening on `:8000` in this environment. Independent of availability, open issue `abofs/stonyx-orm#303` documents that this script hangs after passing (its glob omits `test/zz-exit-test.ts`, the file that forces the process to exit); see [docs/areas/persistence-adapters.md](areas/persistence-adapters.md) |
| Real MySQL coverage (inside `pnpm test`'s glob) | Local MySQL 8.0+ at `localhost:3306`, user/password `stonyx_test`, db `stonyx_orm_test` — see `scripts/setup-test-db.sh` and `test/helpers/mysql-test-helper.ts` | **Not available.** `localhost:3306` was unreachable, so these tests hit their connectivity guard and no-op (`assert.expect(0)`), reporting "ok" without exercising MySQL |
| Real PostgreSQL/TimescaleDB coverage (inside `pnpm test`'s glob) | Postgres reachable at `localhost:5433`, user `postgres`, password `testpass`, db `stonyx_test`, with the `vector` extension — see `test/helpers/pg-test-helper.ts` | **Not available as configured.** A Postgres-speaking service *was* listening on `localhost:5433`, but it rejected the hardcoded test credentials (`password authentication failed for user "postgres"`), so the helper's connectivity probe fails, `pool` stays `null`, and the Postgres/TimescaleDB/pgvector-stress tests no-op the same way the MySQL ones do |

Net effect: the green `pnpm test` run in this environment is real coverage of the JSON-file/directory persistence path, the Store, hooks, views, serializers/transforms, relationships, and the REST surface (including the `?include=` and record-id-resolution regression suites) — all run against live local processes, not stubs. The MySQL, PostgreSQL/TimescaleDB, and DynamoDB adapter test files in the same glob report "ok" but ran zero assertions in this environment, because none of those three backends was reachable with the credentials the test fixtures expect. That is a statement about this environment's available local services, not about the adapters' correctness.

## Delivery

`@stonyx/orm` is delivered as an npm package (`publishConfig.access: "public"`, `provenance: true`) consumed as a library inside a Node.js backend running the Stonyx framework. It has no web, iOS, or Android surface of its own, and it is not deployed or run as a standalone service. It does generate a REST API surface (see above), but that surface is generated *for the consuming application* — mounted inside that app's own `@stonyx/rest-server` instance, under that app's own route prefix and access classes — not something stonyx-orm itself exposes externally. The package's own delivery surface is: the `dist/` build, `src/` (shipped per `files` in `package.json` so consumers get readable stack traces and types), `config/` (default environment), `README.md`, and the `stonyx-orm` CLI bin.

## Dependencies

| Dependency | Responsibility |
|---|---|
| `stonyx` (core framework, dependency) | The base Stonyx framework: CLI, module discovery/auto-loading, lifecycle (startup/shutdown hooks, signal handling), configuration, and logging. `@stonyx/orm` is one of the modules it discovers and initializes; `Orm.init()` plugs into that lifecycle rather than running standalone. |
| `@stonyx/events` (dependency) | A lightweight, singleton pub/sub event system with error isolation and async support. Available to the ORM and to apps built on it for decoupled notifications, separate from the ORM's own before/after hook system. |
| `@stonyx/cron` (dependency) | A min-heap-based scheduler for interval/scheduled work. The ORM uses it for JSON-mode auto-save on an interval (`DB_AUTO_SAVE='true'`, `DB_SAVE_INTERVAL`). |
| `@stonyx/utils` (dependency) | Shared helper functions (file, object, string, date, promise, prompt helpers) used across Stonyx modules, including this one. |
| `mysql2` (optional peer) | The actual MySQL wire protocol driver — connection pooling, prepared statements, SSL/compression. `src/mysql/` only owns the mapping on top of it: schema introspection, DDL/migration generation, query building from model definitions, and FK remapping. If `mysql2` or a reachable MySQL server is missing locally, that is an observation about this dependency/environment (confirmed in this pass — see Build, Run, Test), not a defect in the ORM's adapter code. |
| `pg` (optional peer) | The actual PostgreSQL wire protocol driver, used by both the PostgreSQL and TimescaleDB adapters (`TimescaleDB` extends `PostgresDB`). `src/postgres/` and `src/timescale/` own the mapping on top of it (schema introspection, DDL, hypertables/continuous aggregates/compression for Timescale). Same caveat as `mysql2`: a missing or unreachable Postgres instance, or one without the `vector` extension, is an environment/dependency observation, not an ORM defect. |
| `@aws-sdk/client-dynamodb` (optional peer) | The actual DynamoDB wire protocol client (`CreateTable`, `PutItem`, `Query`, `Scan`, etc.). `src/dynamodb/connection.ts` and `src/dynamodb/dynamodb-db.ts` own the mapping on top of it (table/GSI provisioning from model `belongsTo` relationships, ULID generation, routing `findAll()` conditions to a GSI Query vs. a Scan+FilterExpression fallback). |
| `@aws-sdk/lib-dynamodb` (optional peer) | The document-client layer on top of `@aws-sdk/client-dynamodb` that abstracts DynamoDB's attribute-value marshalling for item reads/writes. Used by the same `src/dynamodb/` mapping code. If DynamoDB Local (or a reachable DynamoDB endpoint) is missing, that is an observation about this dependency's local test/dev facility, not a reason to reject this repo — and it is also where the seven on-hold adapter issues live (see Persistence Adapters, above, and [docs/areas/persistence-adapters.md](areas/persistence-adapters.md)). |

`@stonyx/rest-server` (optional peer, not listed above) owns the actual HTTP server and route mounting that `src/setup-rest-server.ts` and `src/orm-request.ts` register routes against; it is outside this repo and not covered here beyond that boundary.
