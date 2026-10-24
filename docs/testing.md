# Testing

How this repo's test suite is put together, for anyone adding or changing tests. Usage examples for consumers live in [`test/sample/`](https://github.com/abofs/stonyx-orm/tree/dev/test/sample), which the suite loads as its fixture app.

## Commands

| Command | What it runs |
|---|---|
| `pnpm test` | Builds, then runs `test/**/*-test.ts` with `NODE_ENV=test`, then `test:mounted` once per `ORM_TEST_ROUTE` value (`/`, `/api`, `api`, `/api/v1`, `/api/`), then `test:readme` and `test:reference` |
| `pnpm test:readme` | The README access samples, in their own process (`test/integration/readme-access/`) |
| `pnpm test:reference` | The `test/sample/` access class and record-id resolution (`test/integration/reference-access/`) |
| `pnpm test:dynamodb` | DynamoDB integration tests (`test/integration/dynamodb/`). Not part of `pnpm test`; needs DynamoDB Local on `http://localhost:8000` |

`test:mounted`, `test:readme`, `test:reference` and `test:dynamodb` use their own setup files and do **not** run under `NODE_ENV=test`: with it set, the `test/config/environment.ts` overrides are merged into their config and replace the paths their setup sets.

Each REST-serving run binds a port. The defaults are `REST_PORT` 2666 (from `@stonyx/rest-server`, for the main run), `MOUNTED_REST_PORT` 2777, `README_REST_PORT` 2888 and `REFERENCE_REST_PORT` 2999. Set them to free ports when another process already holds one; a run that hits `EADDRINUSE` does not test what it reports.

## Fixtures and config

- `test/sample/` holds real models, serializers, transforms, access classes and views. The ORM discovers them through `test/config/environment.ts`, so a change there changes test behaviour.
- MySQL and PostgreSQL test config lives in `test/helpers/mysql-test-helper.ts` and `test/helpers/pg-test-helper.ts`, not in `test/config/environment.ts`. Those suites skip when the database is not reachable. `scripts/setup-test-db.sh` creates the local MySQL test database.

## State between tests

The ORM is built from singletons, and state leaks between tests unless it is reset:

- `Store.instance` / `Orm.store` keeps records across tests. Unload what a test creates (for example `store.unloadAllRecords(model, { includeChildren: true })`).
- Hooks are module-level maps in `src/hooks.ts`. Call `clearAllHooks()` in teardown.
- `DynamoDBDB.instance` is a singleton too. `resetInstance()` from `test/helpers/dynamodb-test-helper.ts` clears it; call it in `beforeEach` and `afterEach`.

## DynamoDB unit tests

- They live in `test/unit/dynamodb/` and never import the AWS SDK. Every SDK command is injected through the `DynamoDBDeps` argument (`src/dynamodb/dynamodb-db.ts`), so the tests run offline.
- `test/helpers/dynamodb-test-helper.ts` exports `makeCommandStub`, `makeDocClientCommands`, `createMockDeps`, `resetInstance` and `buildDb`.

## Behaviour worth a test

- Records are read through the proxy (`record.age`), not `record.__data.age`: with a transform in play the two can differ.
- Views are read-only: `store.remove()` on a view throws (`src/store.ts`).
- A `belongsTo` that names a record that does not exist yet is queued and wired when that record is created; tests that create records out of order exercise the pending queue, not the direct path.
