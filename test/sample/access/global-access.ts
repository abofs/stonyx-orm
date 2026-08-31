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
 * DO NOT RECONSTRUCT THE REQUEST PATH. THIS FILE USED TO, AND IT FAILED OPEN.
 * ---------------------------------------------------------------------------
 * Authorization by string-matching a reconstructed request path failed OPEN in
 * FIVE distinct ways during the review of a single three-line example, each one
 * found only after the previous was "fixed":
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
 *   5. HTTP/1.1 permits an ABSOLUTE-FORM request-target. Express routes on
 *      `parseurl(req).pathname`, but `originalUrl` is the RAW target, so
 *      `GET http://anything.example/owners/angela` arrives with
 *      `originalUrl === 'http://anything.example/owners/angela'`. Measured: a
 *      `/owners` prefix match is false, `access()` falls through to the CRUD
 *      array, the record comes back in full, `DELETE` succeeds — and it walks
 *      past a hard `return false` deny too, because that deny is a prefix match
 *      on the same reconstructed string.
 *
 * Five fail-open variants of one example, found by five different people. That
 * is not a sequence of bugs in the sample; it is evidence that a consumer cannot
 * be asked to re-derive, correctly and defensively, information the framework
 * already holds. The ORM knows the model, the operation and the record at the
 * point it calls `access()`.
 *
 * SO THE MATCHER BELOW DOES NOT PARSE ANYTHING. `request.baseUrl` is the mount
 * Express actually matched when it dispatched this request. It carries no query
 * string (variant 2), it is not mount-relative (variant 1), it already contains
 * the configured `ORM_REST_ROUTE` prefix (variant 4 — there is nothing left to
 * derive, so the `/apiowners` mistake is unconstructible), and it is unaffected
 * by an absolute-form target (variant 5). Only variant 3 survives as a rule, and
 * it is one `.toLowerCase()`.
 *
 * `?? ''` IS NOT A DEFENCE. The previous revision wrote
 * `String(request.originalUrl ?? '')`, which turns an absent request target into
 * an empty string, which matches no collection, which falls through to the CRUD
 * grant. A guard added to stop a throw traded fail-closed for fail-open. An
 * input this function cannot identify DENIES.
 *
 * This is still a stopgap — `baseUrl` is a transport artifact standing in for a
 * structural fact. The real fix is abofs/stonyx-orm#202: hand `access()` the
 * model, the operation and the record. The case-insensitive router itself is
 * abofs/stonyx-rest-server#47.
 *
 * AND IT IS NOT A GUARANTEE THAT A HIDDEN RECORD CANNOT BE MODIFIED. `restricted`
 * is hidden on every ANIMAL surface, but a write to `/owners` can re-parent
 * animals 21 and 22 onto a different owner and de-hide them —
 * abofs/stonyx-orm#207, blocked on #202 and #196. See README
 * `### Known limitations`.
 *
 * ---------------------------------------------------------------------------
 * THE `access()` METHOD BELOW IS THE README SAMPLE, VERBATIM.
 * ---------------------------------------------------------------------------
 * Every mutation in the sweep targets THIS file, which `package.json`'s `files`
 * list excludes from the package — so for four rounds the matcher under test and
 * the matcher a consumer copies were two independently written pieces of code,
 * and variant 5 was found in the shipped one. They are now one shape, and
 * assertion 46 reads both files and asserts the two `access()` bodies are
 * identical line for line. Edit one without the other and the suite goes red.
 */
export default class GlobalAccess {
  models = ['owner', 'animal', 'trait', 'category', 'phone-number']; // * instead of an array will allow access to all models

  access(request) {
    // `request.baseUrl` is the mount Express matched — `/owners`, or
    // `/api/owners` under ORM_REST_ROUTE=/api. Never parse `originalUrl`: it is
    // the raw request target and can be absolute-form.
    const mount = request.baseUrl;

    // FAIL CLOSED. If Express did not tell us what it matched we are not behind
    // the mount we think we are, and an unidentifiable request denies rather
    // than falling through to the CRUD grant at the bottom.
    if (typeof mount !== 'string' || mount === '') return false;

    // Lower-cased because the router matched case-INSENSITIVELY, and a matcher
    // stricter than the router that dispatched the request can be stepped
    // around. The PATH only — record ids stay at their real case below.
    const collection = mount.toLowerCase();

    // `request.path` is mount-relative and query-free, so sub-path rules need no
    // prefix arithmetic either. false → 403 for the whole request.
    const path = String(request.path ?? '').toLowerCase();

    if (collection.endsWith('/owners')) {
      if (path === '/archived' || path.startsWith('/archived/')) return false;

      // Returning a function plugs it in as a per-record filter, and it is
      // enforced on every surface addressed to one of these records:
      //   /owners, /owners/:id, /owners/:id/pets, /owners/:id/relationships/pets
      // A rejected record is 404 on record routes — the same status as a record
      // that does not exist — so the filter is not an existence oracle.
      return record => record.id !== 'angela' && record.id !== 'restricted';
    }

    // `record.owner` resolves to an OrmRecord, not to the owner's id string —
    // comparing it directly against a string is the bug that made this predicate
    // inert. Deliberately NO `?? record.owner` fallback: accepting the raw
    // shape as well as the resolved one would absorb a resolution regression
    // silently, which is exactly what blinded this fixture before.
    if (collection.endsWith('/animals')) return record => record.owner?.id !== 'restricted';

    // Allows full access to all calls that don't match any of the above conditions
    return ['read', 'create', 'update', 'delete'];
  }
}
