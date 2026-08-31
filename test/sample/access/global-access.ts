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
    const { originalUrl: url } = request; // destructure originalUrl from express request object

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
    if (url.startsWith('/owners')) {
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
    // inert. The `?? record.owner` fallback covers the create path, where the
    // predicate can see a raw attribute value before the relationship resolves.
    if (url.startsWith('/animals')) {
      return record => (record.owner?.id ?? record.owner) !== 'restricted';
    }

    // Allows full access to all calls that don't match any of the above conditions
    return ['read', 'create', 'update', 'delete'];
  }
}
