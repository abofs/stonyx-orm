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
 * THIS PREDICATE READS THE ACCESS CONTEXT. IT USED TO PARSE THE REQUEST TARGET,
 * AND EVERY VERSION THAT DID FAILED OPEN.
 * ---------------------------------------------------------------------------
 * abofs/stonyx-orm#202 gave `access()` a second argument —
 * `access(request, { model, operation })` — and abofs/stonyx-orm#222 migrated
 * this file onto it. `model` is the model name setup-rest-server mounted this
 * route for, assigned once at mount time; `operation` is one of `'read'`,
 * `'create'`, `'update'`, `'delete'`. Neither is derived from the request
 * target, so neither can be influenced by one.
 *
 * WHAT FOLLOWS IS HISTORY, NOT GUIDANCE. Do not reintroduce any of it. Before
 * #202, authorization here meant string-matching a reconstructed request path,
 * and that failed OPEN in FIVE distinct ways during the review of a single
 * three-line example, each one found only after the previous was "fixed":
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
 * already holds. The ORM knows the model and the operation at the point it calls
 * `access()`, and it now hands both over.
 *
 * SO THE MATCHER BELOW DOES NOT PARSE ANYTHING — AND IT NO LONGER READS THE
 * MOUNT AT ALL. An intermediate revision read `request.baseUrl`, the mount
 * Express actually matched. That closed all five variants, but it was a
 * transport artifact standing in for a structural fact; `model` IS the
 * structural fact, so variants 1, 2, 4 and 5 are unconstructible against
 * this predicate rather than merely handled. `request.baseUrl` and
 * `request.originalUrl` do not appear below, and neither does `stonyx/config`.
 * VARIANT 3 IS ABSENT FROM THAT LIST DELIBERATELY: variant 3 survives, in the
 * one string comparison this migration leaves behind. Read SURVIVING IS NOT THE
 * SAME AS BEING SOUND, below, before quoting the sentence above.
 *
 * ONE READ OF ARGUMENT ONE SURVIVES, AND IT MUST. The context names which model
 * and which verb, NOT which route — `GET /owners`, `GET /owners/gina` and
 * `GET /owners/archived` all produce `{ model: 'owner', operation: 'read' }`.
 * So the `/archived` deny cannot be expressed from the context alone, and a
 * predicate migrated to context-ONLY would silently drop it: a deny becoming an
 * allow. `request.path` is mount-relative and query-free, and reading it for a
 * sub-path rule is the one read of the raw request README
 * `### Identifying the collection` sanctions. See also README
 * `#### What the context does not tell you: which surface`, which records the six
 * owner surfaces that produce one identical context.
 *
 * SURVIVING IS NOT THE SAME AS BEING SOUND. The `.toLowerCase()` below matches
 * the case-insensitive router, and that is the only gap it closes. Express sets
 * `request.path` from the RAW pathname while the router DECODES `:id`, so
 * `GET /owners/%61rchived` reaches the comparison as `/%61rchived`, walks past
 * the deny, and is dispatched as the record `archived` — measured, 200 on GET
 * and 204 on DELETE with the record destroyed. That is VARIANT 3 in a spelling
 * this sample does not handle; it is pre-existing, it is NOT fixed here, and it
 * is tracked as abofs/stonyx-orm#228. Read the line below as a rule that must
 * normalise the way the router does, not as a recipe that already has.
 *
 * `?? ''` IS NOT A DEFENCE, and that lesson still applies to the one read that
 * is left. A previous revision wrote `String(request.originalUrl ?? '')`, which
 * turns an absent request target into an empty string, which matches no
 * collection, which falls through to the CRUD grant. A guard added to stop a
 * throw traded fail-closed for fail-open. An input this function cannot
 * identify DENIES — which is why an absent `model` returns `false` below rather
 * than falling through, AND why an absent or non-string `request.path` does
 * too. Since #202 the guard and the read can sit on DIFFERENT ARGUMENTS, and a
 * guard on argument two does not protect a read of argument one: with the
 * context supplied and `request.path` absent, `?? ''` matched no sub-path rule
 * and fell through to the per-record filter — a DENY became an ALLOW. Both
 * arguments are guarded below.
 *
 * AND IT IS NOT A GUARANTEE THAT A HIDDEN RECORD CANNOT BE MODIFIED. `restricted`
 * is hidden on every ANIMAL surface, but a write to `/owners` can re-parent
 * animals 21 and 22 onto a different owner and de-hide them —
 * abofs/stonyx-orm#207, blocked on #196. See README `### Known limitations`.
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

  access(request, { model, operation }) {
    // `model` is the model this route was mounted for. It is assigned once, at
    // mount time, and no request can influence it — not a mount prefix, not a
    // query string, not a case-varied path, not an absolute-form request
    // target. Nothing below parses anything, so variants 1, 2, 4 and 5 are not
    // constructible against this predicate any more — they are history, not
    // rules to follow. VARIANT 3 IS THE EXCEPTION AND THE CLAIM IS NARROWER
    // THAN IT WAS: a matcher stricter than the router can still be stepped
    // around, because the sub-path rule below is still a string comparison.
    // Case is handled; percent-encoding is not — abofs/stonyx-orm#228.
    //
    // `operation` is destructured to name the whole contract at the point of
    // use. This sample's rules are per-model and per-sub-path rather than
    // per-verb, so it does not branch on it; the permission array at the bottom
    // is where the verb is answered.

    // FAIL CLOSED ON ARGUMENT TWO. `model` is absent for any caller that
    // resolved this predicate without supplying the context, and a request this
    // function cannot identify DENIES rather than falling through to the CRUD
    // grant at the bottom. An unidentifiable input must never be the permissive
    // path. Argument ONE is guarded at its own read, below — this guard does
    // not cover it.
    if (typeof model !== 'string' || model === '') return false;

    if (model === 'owner') {
      // The context names WHICH MODEL and WHICH VERB — not which route. Six
      // distinct owner surfaces produce one identical context, so a rule that
      // depends on the SUB-PATH still needs argument one. `request.path` is
      // mount-relative and query-free, and it is the one read of the raw
      // request the README sanctions. false → 403 for the whole request.
      //
      // THIS DENY CANNOT BE EXPRESSED FROM THE CONTEXT ALONE. Migrating it away
      // does not remove a rule, it turns a deny into an ALLOW, silently.
      //
      // FAIL CLOSED ON ARGUMENT ONE TOO. The guard above covers the context;
      // this one covers the request, and since #202 they are two different
      // objects. A caller that resolves this predicate through the documented
      // `Orm.instance.getAccess()` path and hand-assembles a request can supply
      // a perfectly valid context with no usable `path` — and
      // `String(request.path ?? '')` is then `''`, which matches no sub-path
      // rule and falls straight through to the per-record filter below. That is
      // a DENY becoming an ALLOW. An input this function cannot identify DENIES,
      // whichever ARGUMENT it arrived on — which is also why the `?? ''` this
      // file's header condemns does not appear below.
      if (typeof request?.path !== 'string' || request.path === '') return false;

      // Lower-cased because the router matched case-insensitively, so a
      // case-sensitive rule here would be stricter than the router and could be
      // stepped around.
      //
      // CASE-FOLDING ALONE IS NOT A SUFFICIENT NORMALISATION, and this line is
      // not a recipe for one. Express sets `request.path` from the RAW pathname
      // while the router DECODES `:id`, so `GET /owners/%61rchived` reaches this
      // comparison as `/%61rchived`, walks past the deny, and is dispatched as
      // the record `archived` — abofs/stonyx-orm#228. A matcher must normalise
      // the way the router that dispatched the request does. Record ids are
      // case-sensitive and must be compared at their real case.
      const path = request.path.toLowerCase();

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
    if (model === 'animal') return record => record.owner?.id !== 'restricted';

    // Allows full access to all calls that don't match any of the above conditions
    return ['read', 'create', 'update', 'delete'];
  }
}
