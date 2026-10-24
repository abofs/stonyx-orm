# Security Notes

What an app that exposes the ORM's REST routes needs to know about where authorization happens and what the ORM does and does not check. How to write an access class is in the README, [REST Server Integration](../README.md#rest-server-integration); this page does not repeat it.

## Authorization

- **Access classes are the only authorization gate on generated routes.** `access(request)` receives the raw Express request with `request.recordId` attached, so headers, cookies, tokens and query values read there are client input and are validated defensively. It returns `false` (403), an operations array, or a filter function. A filter function is an unconditional allow for every method on that collection, including `POST`; the operations list is consulted only when an array is returned (README, REST Server Integration).
- **Authorize on `request.recordId`, never on a URL property or on raw `request.params.id`.** The README explains why and documents [`normalizeRecordId`](../README.md#normalizerecordidid) for code that `access()` does not reach.
- **Before hooks are a second gate, not a replacement.** A `beforeHook` that returns any value other than `undefined` halts the operation and that value becomes the response (`src/orm-request.ts`, `_withHooks`). Hooks run after `access()` has already allowed the request.
- **Related records are authorized only by the source model's `access()`.** Three routes serve records of another model: `?include=` adds every related record it reaches from the records in `data` (`collectIncludedRecords` in `src/orm-request.ts`), and `/:id/<relationship>` and `/:id/relationships/<relationship>` return the related records and their linkage (`_generateRelationshipRoutes`). None of them consults the related model's access class. An access rule that hides a record from its own routes, even one that returns `false`, does not hide it from another model's `?include=` or relationship routes. Capping or refusing `include` does not close the two relationship routes.
- **`?include=` has no depth or size cap, and its cost grows with the path length.** The parameter is split on `,` and `.` with no limit on the number of paths or segments (`parseInclude`). The response is deduplicated by type and id, but the traversal is not: at each level every related record is walked again, including ones already seen (`traverseIncludePath`). The work is roughly the relationship fan-out raised to the number of segments, while the response stays the same size. The traversal is synchronous, so it blocks every other request. Measured with one owner holding 208 animals: `GET /owners/<id>?include=pets.owner.pets.owner` took 14 ms, `…pets.owner.pets.owner.pets` 1.1 s, `…pets.owner.pets.owner.pets.owner` 2.7 s, and a 7-segment path had not returned after 70 s. The three that returned were all 127 KB.
- **Cap `include` in `access()`, both its depth and its number of paths.** `access()` runs before the handler on every route that honours `include`, so it can refuse an expensive request. Capping depth alone is not enough: the paths are not deduplicated and each one is walked again (`collectIncludedRecords`), so with 224 animals `GET /animals?include=owner.pets,owner.pets,…` repeated 1,400 times (15 KB of URL, two segments each) took 7.3 s, and three paths took 22 ms. Put the check in each access class whose models have relationships. With this check the 7-segment path and the 1,400-path request above both return 403 in about 1 ms, while `?include=pets.owner`, `?include=pets,pets.owner` and three `owner.pets` paths are still served:

  ```js
  access(request) {
    const { include } = request.query;
    const maxPaths = 3;
    const maxSegments = 2;

    // A repeated parameter (?include=a&include=b) arrives as an array, which the
    // ORM ignores; refusing it keeps the check to one shape
    if (include !== undefined) {
      if (typeof include !== 'string') return false;

      const paths = include.split(',');
      if (paths.length > maxPaths || paths.some(path => path.split('.').length > maxSegments)) return false;
    }

    // ...the rest of the access rules
  }
  ```

## Request input

- **Hook context is untrusted input.** `context.body` is the parsed JSON request body and `context.params` / `context.query` are raw client text (`src/orm-request.ts`). A hook that reads them validates them first.
- **SQL values are bound as parameters.** The MySQL and PostgreSQL query builders (`src/mysql/query-builder.ts`, `src/postgres/query-builder.ts`) pass values as placeholders. Table and column names are interpolated, quoted, after `validateIdentifier`; they come from model definitions, not from request input.

## Persistence and configuration

- **JSON persistence has no protection beyond the filesystem.** In file and directory mode the store is written to disk as plain JSON: no encryption and no access control beyond file permissions.
- **`DB_FILE` and `DB_DIRECTORY` are used as given.** `src/db.ts` resolves them against the project root with `path.resolve` and does not validate them. They are operator configuration; never derive them from request input.
- **Migrations run with the configured database user's grants.** Generated migration SQL is executed as-is by the migration runner (`src/mysql/migration-runner.ts`), so what a migration can do is limited only by that user's privileges.
- **Database credentials come from configuration.** `src/mysql/connection.ts` and `src/postgres/connection.ts` pass them to the driver and do not log them. Keep them out of your own log lines and error messages.
- **Internal record properties bypass the proxy.** `__data`, `__relationships` and the other `__`-prefixed properties skip transforms and change tracking (README, [Public API vs Internals](../README.md#public-api-vs-internals)). Consumer code never writes through them.
