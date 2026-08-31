import config from 'stonyx/config';

/**
 * Sample access control.
 *
 * This fixture is itself acceptance criteria for #190. Before that change it had
 * two defects, and together they made the whole regression suite blind to a live
 * authorization bypass — a candidate fix passed all 855 tests without the guard
 * ever being reached:
 *
 *   1. It matched with `endsWith()`, so it returned a filter ONLY for the exact
 *      collection urls. `state.filter` was therefore `undefined` on every
 *      record-level route. The gap was even documented here in an
 *      "Intentional Gap" comment and worked around with a hand-written
 *      `/owners/angela` deny — a workaround that existed precisely because the
 *      filter could not reach the record route.
 *
 *   2. The animals predicate compared `record.owner` — a resolved OrmRecord —
 *      against a string. That is never equal, so it excluded 0 of 20 animals
 *      while looking like it worked.
 *
 * Both are fixed below. If either regresses, test/unit/access-filter-enforcement-test.ts
 * goes red rather than going vacuously green.
 *
 * ---------------------------------------------------------------------------
 * READ THIS BEFORE COPYING THE `matches()` HELPER — IT IS A STOPGAP
 * ---------------------------------------------------------------------------
 * Authorization by string-matching a URL has now failed OPEN in four distinct
 * ways during the review of a single three-line example, each one found only
 * after the previous was "fixed":
 *
 *   1. `request.url` is mount-relative under RestServer.mountRoute, so a prefix
 *      match against it is ALWAYS false.
 *   2. `request.originalUrl` carries the query string, so an anchored equality
 *      check misses `/owners?filter[age]=30` and returns that collection
 *      unfiltered.
 *   3. The router is a bare `express()`, whose default is
 *      `caseSensitive: false`, while a hand-written matcher is case-SENSITIVE.
 *      `GET /OwNeRs/angela` therefore reached the handler with no filter at all,
 *      and `DELETE /ANIMALS/22` destroyed a hidden record.
 *   4. Under a configured `ORM_REST_ROUTE` every path gains a mount prefix, so a
 *      hard-coded `/owners` matches nothing.
 *
 * Four fail-open variants of one example, found by four different people. That
 * is not a sequence of bugs in the sample; it is evidence that a consumer cannot
 * be asked to re-derive, correctly and defensively, information the framework
 * already holds structurally. The ORM knows the model, the operation and the
 * record at the point it calls `access()`.
 *
 * `matches()` below closes all four. It is NOT proof the pattern is safe — it is
 * safe against the four variants we happen to have found. The real fix is
 * abofs/stonyx-orm#202: hand `access()` the model, the operation and the record
 * so there is no URL to parse and no variant to miss. The case-insensitive
 * router itself is abofs/stonyx-rest-server#47.
 */

/**
 * The mount prefix, built from the SAME config value the ORM mounts under.
 *
 * `setup-rest-server.ts` mounts each model at `${name}/${pluralizedModel}` where
 * `name` is `config.orm.restServer.route` with its leading slash stripped, or
 * `index` for the default `'/'`. Hard-coding `/owners` therefore fails open the
 * moment `ORM_REST_ROUTE` is set — environment-specifically, which is worse than
 * failing everywhere.
 *
 * Note what this must NOT be. README once suggested
 * `` `${config.orm.restServer.route}owners` ``; for the shipped default that is
 * `/owners` and looks right, but for `ORM_REST_ROUTE=/api` it evaluates to
 * `/apiowners` — so a reader who followed the documented remediation exactly
 * still failed open, and believed they had handled it. Join on `/` and collapse.
 *
 * Read per call, not once at module load, so a test can vary the route.
 */
function mountPrefix() {
  const route = config.orm.restServer.route ?? '/';
  const trimmed = String(route).replace(/^\/+|\/+$/g, '');

  return trimmed === '' ? '' : `/${trimmed}`;
}

/**
 * True when `request` addresses `collection` or a record beneath it.
 *
 * `originalUrl`, not `url`: RestServer.mountRoute mounts each model as an
 * Express sub-app, so `request.url` arrives with the mount path STRIPPED —
 * `GET /owners/angela` is `url === '/angela'` — and a prefix match against it is
 * always false. That is the shape of failure this whole fixture exists to make
 * visible: a security control that silently does nothing while every test passes.
 *
 * The query string is stripped, because `originalUrl` carries it and an anchored
 * match against the raw value misses `/animals?filter[age]=2`.
 *
 * Compared lower-cased, because the router matched the path case-INSENSITIVELY.
 * A matcher stricter than the router is a matcher that can be walked past.
 * `toLowerCase()` is applied to the PATH ONLY for the prefix comparison; record
 * ids are never lower-cased, and the predicate below still compares `record.id`
 * at its real case.
 *
 * Anchored on a `/` boundary so it cannot also catch a sibling collection like
 * `/owners-archive`.
 */
function matches(request, collection) {
  const path = String(request.originalUrl ?? '').split('?')[0].toLowerCase();
  const prefix = `${mountPrefix()}/${collection}`.toLowerCase();

  return path === prefix || path.startsWith(`${prefix}/`);
}

export default class GlobalAccess {
  models = ['owner', 'animal', 'trait', 'category', 'phone-number']; // * instead of an array will allow access to all models

  // Custom logic here
  access(request) {
    // Returning a function plugs it in as a per-record filter.
    //
    // Matched on the collection PREFIX, not on the exact collection url, so the
    // predicate is returned for record routes too and reaches every surface that
    // can hand back one of these records:
    //   /owners, /owners/:id, /owners/:id/pets, /owners/:id/relationships/pets
    //
    // A rejected record is a 404 on record routes — the same status as a record
    // that does not exist — so the filter cannot be used as an existence oracle.
    // This replaces the previous `endsWith('/owners/angela') -> false` deny,
    // which returned 403 and therefore disclosed that angela exists.
    //
    // `angela` is hidden from the owners collection exactly as she was before
    // this change; `restricted` is the dedicated subject described below.
    if (matches(request, 'owners')) {
      return record => record.id !== 'angela' && record.id !== 'restricted';
    }

    // `restricted` owns animals 21 and 22 and nothing else in the suite touches
    // them, so the animals filter has a subject of its own rather than hiding a
    // record the JSON:API mechanics tests depend on. Both are filtered out on
    // every surface, so the dataset visible through the REST API is unchanged by
    // their existence and every pre-existing assertion keeps its meaning.
    //
    // `record.owner` resolves to an OrmRecord, not to the owner's id string —
    // comparing it directly against a string is the bug that made this predicate
    // inert.
    //
    // Deliberately NO `?? record.owner` fallback. Accepting the raw-string shape
    // as well as the resolved shape is exactly the mismatch that blinded this
    // fixture in the first place: if record resolution ever regresses on any
    // surface, a tolerant predicate absorbs it silently and the guarantee two
    // paragraphs up stops holding. `record.owner?.id` on an unresolved record is
    // `undefined`, which fails the comparison, which turns this file red — which
    // is the whole point of binding the unit suite to the shipped fixture.
    if (matches(request, 'animals')) {
      return record => record.owner?.id !== 'restricted';
    }

    // Allows full access to all calls that don't match any of the above conditions
    return ['read', 'create', 'update', 'delete'];
  }
}
