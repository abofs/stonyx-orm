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
 */
export default class GlobalAccess {
  models = ['owner', 'animal', 'trait', 'category', 'phone-number']; // * instead of an array will allow access to all models

  // Custom logic here
  access(request) {
    // `originalUrl`, not `url`. RestServer.mountRoute mounts each model as an
    // Express sub-app, so `request.url` arrives here with the mount path
    // STRIPPED — `GET /owners/angela` is `url === '/angela'` — and a prefix
    // match against it is always false. That is the shape of failure this whole
    // fixture exists to make visible: a security control that silently does
    // nothing while every test passes.
    //
    // The query string is stripped as well: `originalUrl` carries it, so an
    // anchored match against the raw value misses `/animals?filter[age]=2` and
    // that collection would come back unfiltered.
    const path = request.originalUrl.split('?')[0];

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
    // Anchored, so it cannot also catch a sibling collection like
    // `/owners-archive` — matching more than intended is safe here and is not
    // in someone else's schema.
    if (path === '/owners' || path.startsWith('/owners/')) {
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
    if (path === '/animals' || path.startsWith('/animals/')) {
      return record => record.owner?.id !== 'restricted';
    }

    // Allows full access to all calls that don't match any of the above conditions
    return ['read', 'create', 'update', 'delete'];
  }
}
