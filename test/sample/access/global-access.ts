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
 * THAT SENTENCE IS SUPERSEDED BY abofs/stonyx-orm#236/#237 AND IS LEFT STANDING
 * ON PURPOSE. The string comparison is gone; the sub-path rule is now a
 * comparison against the DECODED `recordId` the framework supplies, so variant
 * 3 no longer has a comparison to be stepped around. It is not edited here
 * because the same "variant 3 survives" wording appears at four sites — this
 * header, README.md twice, and `src/orm-request.ts` — three of which SHIP, and
 * retiring one of four leaves the shipped copies contradicting each other.
 * Retiring all four, with the measurement that retires them rather than by
 * deletion, is abofs/stonyx-orm#238.
 *
 * ONE READ OF ARGUMENT ONE SURVIVED #222, AND IT IS GONE AS OF
 * abofs/stonyx-orm#236/#237. The paragraph that follows is kept because it
 * states the constraint the fix had to satisfy, not because it still describes
 * the code: the context named which model and which verb, NOT which route —
 * `GET /owners`, `GET /owners/gina` and `GET /owners/archived` all produced
 * `{ model: 'owner', operation: 'read' }`. So the `/archived` deny could not be
 * expressed from the context alone, and a predicate migrated to context-ONLY
 * would have silently dropped it: a deny becoming an allow. `request.path` was
 * therefore read for the sub-path rule. #236 added `recordId` — the DECODED
 * route-parameter id — to that context, which is what made the deny expressible
 * from argument two, and the read of argument one was retired rather than
 * dropped. The rule it enforced is still enforced, against a better input.
 *
 * SURVIVING WAS NOT THE SAME AS BEING SOUND, AND THAT IS WHY IT WAS RETIRED.
 * The `.toLowerCase()` that used to sit below matched the case-insensitive
 * router and closed exactly one gap. Express sets `request.path` from the RAW
 * pathname while the router DECODES `:id`, so `GET /owners/%61rchived` reached
 * the comparison as `/%61rchived`, walked past the deny, and was dispatched as
 * the record `archived` — measured, 200 on GET and 204 on DELETE with the
 * record DESTROYED, unauthenticated. It was wrong in the other direction at the
 * same time: a record id is a VALUE, not a literal route segment, so with a
 * distinct owner seeded at `ARCHIVED` it 403'd `GET /owners/ARCHIVED` — the
 * wrong record — while still admitting `GET /owners/%41RCHIVED`. Two
 * consumer-side normalisation schemes were measured wrong in OPPOSITE
 * directions (the other was `decodeURIComponent(request.path)`, which
 * over-denied the distinct record at `/owners/archived%2fx` because it decodes
 * THEN splits while the router splits THEN decodes). That is the argument for
 * the framework doing it once: #236, closed by #237.
 *
 * `?? ''` IS NOT A DEFENCE, and the lesson outlived the read it was about. A
 * previous revision wrote `String(request.originalUrl ?? '')`, which turns an
 * absent request target into an empty string, which matches no collection,
 * which falls through to the CRUD grant. A guard added to stop a throw traded
 * fail-closed for fail-open. An input this function cannot identify DENIES —
 * which is why an absent `model` returns `false` below rather than falling
 * through, AND why an absent `recordId` does too. The guard MOVED WITH THE
 * READ: argument one is no longer read, so guarding it would be theatre, and
 * the thing that can now be missing is the context key. `auth()` always sets
 * `recordId` (`null` on a collection route), so `undefined` means the context
 * was hand-assembled by a caller resolving this predicate through
 * `Orm.instance.getAccess()` — and letting that through falls to the per-record
 * filter, which is a DENY becoming an ALLOW. Measured before the guard existed.
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
  // `tag` IS MISSING FROM THIS ARRAY ON PURPOSE, AND IT IS MISSING FROM
  // test/sample/db-schema.ts ON PURPOSE TOO. Both absences are the fixture;
  // neither is an oversight to tidy up.
  //
  // Absent HERE, `tag` is a model no access class claims: `getAccess('tag')`
  // is `undefined` and `setup-rest-server` mounts no route for it. That is
  // abofs/stonyx-orm#240 fixture 2, and it is what makes the unclaimed-model
  // case testable at all -- see test/sample/models/tag.ts for the three
  // constraints that shaped it, and `[GUARD] #240 AC8/1` and `AC8/2` in
  // test/unit/relationship-route-access-test.ts for the pins.
  //
  // Absent from `db-schema.ts`, it is ALSO never persisted -- served normally
  // and gone on restart, with no signal at boot, mount, write or read. That
  // second absence is a repo-wide framework defect this fixture is merely the
  // first sample model to occupy, and it is owned and specified by
  // abofs/stonyx-orm#248 (open). Read that issue rather than re-deriving it
  // here; this comment exists because the `models` array is the line a
  // newcomer edits, and until now it said nothing about either absence.
  //
  // SO DO NOT "FIX" EITHER ONE. Adding `'tag'` here, or `tags = hasMany('tag')`
  // to `db-schema.ts`, silently un-tests the unclaimed-model case that #232 and
  // #233 depend on (#248 AC3 states this as a requirement on whatever signal
  // #248 lands). The schema edit additionally costs 6 reds across two files,
  // measured -- see `[GUARD] #240 AC8/1`.
  models = ['owner', 'animal', 'trait', 'category', 'phone-number']; // * instead of an array will allow access to all models

  access(request, { model, operation, recordId }) {
    // `model` is the model this route was mounted for. It is assigned once, at
    // mount time, and no request can influence it — not a mount prefix, not a
    // query string, not a case-varied path, not an absolute-form request
    // target. `recordId` is the record this route was ADDRESSED TO, decoded by
    // the router and coerced to the key the store lookup uses. Nothing below
    // parses anything, and since abofs/stonyx-orm#236 nothing below reads
    // argument one AT ALL. Variants 1, 2, 4 and 5 were already unconstructible;
    // the sub-path STRING COMPARISON that variant 3 lived in is gone too,
    // replaced by a comparison against the decoded id. Retiring the "variant 3
    // survives" wording at the four sites that still carry it — with the
    // measurement that retires it, rather than by deletion — is
    // abofs/stonyx-orm#238.
    //
    // `operation` is destructured to name the whole contract at the point of
    // use. This sample's rules are per-model and per-record rather than
    // per-verb, so it does not branch on it; the permission array at the bottom
    // is where the verb is answered.

    // FAIL CLOSED ON AN UNIDENTIFIABLE MODEL. `model` is absent for any caller
    // that resolved this predicate without supplying the context, and a request
    // this function cannot identify DENIES rather than falling through to the
    // CRUD grant at the bottom. An unidentifiable input must never be the
    // permissive path.
    if (typeof model !== 'string' || model === '') return false;

    if (model === 'owner') {
      // FAIL CLOSED ON AN ABSENT `recordId` TOO, AND `undefined` IS THE ONLY
      // SPELLING OF ABSENT. `auth()` ALWAYS sets the key — `null` on a
      // collection route, which is addressed to no record — so `undefined`
      // means the context did not come from `auth()`: it was hand-assembled by
      // a caller resolving this predicate through the documented
      // `Orm.instance.getAccess()` path. Letting that through would fall
      // straight to the per-record filter below, which is a DENY becoming an
      // ALLOW. This is the same rule the old guard on `request.path` enforced,
      // moved to the argument this predicate now actually reads.
      if (recordId === undefined) return false;

      // THE `/archived` DENY, EXPRESSED AGAINST THE DECODED ID. It used to be
      // `request.path.toLowerCase()` compared against `'/archived'`, and that
      // was wrong in both directions at once.
      //
      // TOO PERMISSIVE: express sets `request.path` from the RAW pathname while
      // the router DECODES `:id`, so `GET /owners/%61rchived` reached the
      // comparison as `/%61rchived`, walked past the deny and was dispatched as
      // the record `archived` — 200 with the record in full, and DELETE
      // answered 204 with the record DESTROYED, unauthenticated. 255
      // non-canonical spellings of that 8-character id decode to the same key,
      // so no deny-list of spellings was ever going to close it.
      //
      // TOO STRICT: a record id is a VALUE, not a literal route segment, and
      // express's `case sensitive routing` governs literal segments only. With
      // a distinct owner seeded at `ARCHIVED`, the `.toLowerCase()` 403'd
      // `GET /owners/ARCHIVED` — the wrong record — while still admitting
      // `GET /owners/%41RCHIVED`, the same record encoded.
      //
      // SO DO NOT NORMALISE `recordId`. It is already decoded, exactly ONCE,
      // which is what a route parameter means: `/owners/%2561rchived` is the
      // legitimate id `%61rchived`, and decoding until stable would deny it. Do
      // not case-fold it. Do not rebuild it from `request.path` — decoding the
      // whole path decodes THEN splits while the router splits THEN decodes,
      // which over-denies the distinct record at `/owners/archived%2fx`.
      //
      // THE DENY IS NOW EXPRESSIBLE FROM THE CONTEXT ALONE, which is exactly
      // what `recordId` bought — and it still must not be dropped. Deleting it
      // does not remove a rule loudly, it turns a deny into an ALLOW, silently.
      if (recordId === 'archived') return false;

      // Returning a function plugs it in as a per-record filter. It is enforced
      // on every surface addressed to one of these records —
      //   /owners, /owners/:id, /owners/:id/pets, /owners/:id/relationships/pets
      // — AND, since #232, on every surface that reaches one of these records
      // as the RELATED resource of another model:
      //   /animals/:id/owner, /animals/:id/relationships/owner
      // Both readings are the same rule: an owner this predicate rejects is
      // withheld wherever she is reachable, not only on /owners.
      //
      // NOTHING HERE IS AN EXISTENCE ORACLE, AND THE SPELLING DIFFERS BY WHOSE
      // RECORD IS BEING REJECTED. A rejected ADDRESSED record is 404 — the same
      // status as a record that does not exist. A rejected RELATED record is
      // `data: null` at 200 — byte-identical to a relationship that is
      // genuinely empty, because on those routes 404 is already the answer for
      // a PARENT that does not exist. In both cases "rejected" and "not there"
      // are the same answer, which is the property that matters.
      return record => record.id !== 'angela' && record.id !== 'restricted';
    }

    // `record.owner` resolves to an OrmRecord, not to the owner's id string —
    // comparing it directly against a string is the bug that made this predicate
    // inert. Deliberately NO `?? record.owner` fallback: accepting the raw
    // shape as well as the resolved one would absorb a resolution regression
    // silently, which is exactly what blinded this fixture before.
    // `record.id !== 18` IS abofs/stonyx-orm#240's FIRST FIXTURE, AND IT IS THE
    // ONLY HIDDEN CHILD IN THIS SAMPLE WITH A PERMITTED PARENT. Animal 18 is
    // owned by `gina`, who is NOT hidden. Before it, every hidden animal (21,
    // 22) was owned by `restricted`, who is hidden himself -- so no permitted
    // parent named a hidden child anywhere in the fixture, and every `hasMany`
    // assertion about that shape was vacuously green. Measured: `owner.pets`,
    // `owner.phoneNumbers` and `animal.traits` named ZERO hidden children.
    //
    // The cheap alternative does NOT work and was measured: adding an owner
    // whose `pets` names the already-hidden animal 21 RE-PARENTS it onto the
    // new owner and de-hides it (`GET /animals` goes 20 -> 22). A hidden-child
    // fixture has to come from an access() rule.
    //
    // DO NOT MOVE THIS TO `trait`: `/traits` is this suite's designated
    // UNFILTERED collection, load-bearing for #190's GATE-0 scoping guard and
    // for #234's AC7 cache guard -- measured at 6 reds.
    if (model === 'animal') return record => record.owner?.id !== 'restricted' && record.id !== 18;

    // Allows full access to all calls that don't match any of the above conditions
    return ['read', 'create', 'update', 'delete'];
  }
}
