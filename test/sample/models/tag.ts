/**
 * abofs/stonyx-orm#240, FIXTURE 2 — A MODEL CLAIMED BY NO ACCESS CLASS.
 *
 * `tag` is absent from `GlobalAccess.models`, so `setup-rest-server` mounts NO
 * route for it: `GET /tags` and `GET /tags/{id}` are both 404, and
 * `Orm.instance.getAccess('tag')` is `undefined`. It is a collection the
 * consumer deliberately never exposed.
 *
 * That makes it the MOST severe member of the relationship-access family, not
 * the least: before abofs/stonyx-orm#232 its records were reachable in full
 * through `GET /traits/{id}/tag` and `GET /traits/{id}/relationships/tag`, at
 * ZERO query parameters, on a model with no REST surface of its own.
 *
 * THREE CONSTRAINTS, EACH MEASURED, EACH THE REASON THIS FILE LOOKS AS IT DOES:
 *
 *   1. KEPT OUT OF `test/sample/db-schema.ts`. Adding `tags = hasMany('tag')`
 *      there costs 6 reds across two files, one of them the exact-key schema
 *      pin in `file stores expected schema structure`
 *      (test/integration/orm-test.ts). Named rather than numbered: the number
 *      was wrong twice -- it read `:41`, the test header was `:42` at the merge
 *      base, and this pull request's own `before`-hook insertion moved it to
 *      `:53` at the head. Out of the schema it costs 0.
 *      The consequence is real and is pinned rather than worked around: an
 *      unclaimed model is NOT PERSISTED with the sample db, so a `belongsTo`
 *      to it does not survive a db round-trip. That silence -- served normally,
 *      gone on restart, no signal anywhere -- is a framework defect rather than
 *      a property of this fixture, and it is owned by abofs/stonyx-orm#248.
 *   2. ATTACHED TO `trait`, NOT TO `animal`. `animal.tags = hasMany('tag')`
 *      reds three assertions in `test/unit/linkage-verdict-test.ts` that pin an
 *      animal document byte-for-byte (#234 AC5, AC5b, AC10). `trait.tag` is the
 *      cheaper attachment point and reaches the same surfaces.
 *   3. NOT CONSTRUCTED AS A SECOND ACCESS CLASS DECLARING `models: []`. That
 *      is the symmetric-looking construction and it walks into
 *      abofs/stonyx-orm#225's unvalidated early return in
 *      `setup-rest-server.ts:32`, which returns BEFORE the
 *      `typeof accessInstance.access !== 'function'` check, mounts nothing and
 *      produces no boot signal. `#240` AC3's route clauses exist to catch
 *      exactly that, because its registry clauses would pass.
 */
import { Model, attr } from '@stonyx/orm';

export default class TagModel extends Model {
  id = attr('string'); // Override the default number id, matching `category`
  label = attr('string');
}
