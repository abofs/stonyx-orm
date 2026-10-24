# Security Notes

What an app that exposes the ORM's REST routes needs to know about where authorization happens and what the ORM does and does not check. How to write an access class is in the README, [REST Server Integration](../README.md#rest-server-integration); this page does not repeat it.

## Authorization

- **Access classes are the only authorization gate on generated routes.** `access(request)` receives the Express request with `request.recordId` attached, and returns `false` (403), an operations array, or a filter function. A filter function is an unconditional allow for every method on that collection, including `POST`; the operations list is consulted only when an array is returned (README, REST Server Integration).
- **Authorize on `request.recordId`, never on a URL property or on raw `request.params.id`.** The README explains why and documents [`normalizeRecordId`](../README.md#normalizerecordidid) for code that `access()` does not reach.
- **Before hooks are a second gate, not a replacement.** A `beforeHook` that returns any value other than `undefined` halts the operation and that value becomes the response (`src/orm-request.ts`, `_withHooks`). Hooks run after `access()` has already allowed the request.
- **`included` records are not checked against their own model's `access()`.** `?include=` walks the relationships of the records in `data` and adds every related record it reaches (`collectIncludedRecords` in `src/orm-request.ts`); no access class is consulted for the related model. An access rule that hides a record from its own collection route does not hide it from another model's `?include=`.
- **`?include=` has no depth or size cap.** The parameter is split on `,` and `.` with no limit on the number of paths or segments (`parseInclude` in `src/orm-request.ts`). Each segment walks one relationship level, and records are deduplicated by type and id, so a circular path such as `owner.pets.owner` ends when the path ends. The size of the response is bounded only by the data.

## Request input

- **Hook context is untrusted input.** `context.body` is the parsed JSON request body and `context.params` / `context.query` are raw client text (`src/orm-request.ts`). A hook that reads them validates them first.
- **SQL values are bound as parameters.** The MySQL and PostgreSQL query builders (`src/mysql/query-builder.ts`, `src/postgres/query-builder.ts`) pass values as placeholders. Table and column names are interpolated, quoted, after `validateIdentifier`; they come from model definitions, not from request input.

## Persistence and configuration

- **JSON persistence has no protection beyond the filesystem.** In file and directory mode the store is written to disk as plain JSON: no encryption and no access control beyond file permissions.
- **`DB_FILE` and `DB_DIRECTORY` are used as given.** `src/db.ts` resolves them against the project root with `path.resolve` and does not validate them. They are operator configuration; never derive them from request input.
- **Migrations run with the configured database user's grants.** Generated migration SQL is executed as-is by the migration runner (`src/mysql/migration-runner.ts`), so what a migration can do is limited only by that user's privileges.
- **Database credentials come from configuration.** `src/mysql/connection.ts` and `src/postgres/connection.ts` pass them to the driver and do not log them. Keep them out of your own log lines and error messages.
- **Internal record properties bypass the proxy.** `__data`, `__relationships` and the other `__`-prefixed properties skip transforms and change tracking (README, [Public API vs Internals](../README.md#public-api-vs-internals)). Consumer code never writes through them.
