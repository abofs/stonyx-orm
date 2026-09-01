/**
 * REST request handling and access enforcement for @stonyx/orm.
 *
 * ---------------------------------------------------------------------------
 * THE `access()` CONTRACT: `access(request, { model, operation })`
 * ---------------------------------------------------------------------------
 * `auth()` calls your predicate with TWO arguments. The second is the access
 * CONTEXT -- the structural facts about the request, which the framework
 * already holds and which you should read INSTEAD of parsing anything:
 *
 *   context.model     The model this route was mounted for, as a model name:
 *                     kebab-case, exactly as declared under
 *                     `config.orm.paths.model` and keyed in the store --
 *                     `'owner'`, `'animal'`, `'phone-number'`. NOT the
 *                     pluralised, dasherized, mount-prefixed ROUTE name. It is
 *                     read from the OrmRequest instance, fixed at mount time,
 *                     and no request can influence it.
 *
 *   context.operation The operation being authorised. Exactly one of the four
 *                     verbs `'read'`, `'create'`, `'update'`, `'delete'` --
 *                     no second vocabulary ON THIS PATH, and never an HTTP
 *                     method name like `'GET'`. These are the same four
 *                     strings the permission-array return shape is written in
 *                     (`['read', 'create']`), because both come from the one
 *                     `methodAccessMap` below.
 *
 *                     NOT the hook vocabulary. `HookContext.operation`
 *                     (`src/hooks.ts`, documented under "Hook Context Object"
 *                     in the README) carries `'list' | 'get' | 'create' |
 *                     'update' | 'delete'` on an identically-named key of an
 *                     identically-shaped context object, and the access
 *                     vocabulary collapses `list` and `get` into `'read'`. For
 *                     one `GET /animals/1` a hook sees `'get'` and `access()`
 *                     sees `'read'`, so a predicate cannot tell a collection
 *                     read from a record read. `AccessOperation` makes
 *                     `operation === 'get'` a compile error for a TypeScript
 *                     consumer, because a predicate that stops matching falls
 *                     through to the permission array -- the misreading is
 *                     fail-open shaped.
 *
 *                     `undefined` when the dispatched method has no entry in
 *                     that map. Express delivers `HEAD` to the `GET` handler,
 *                     so this is reachable. It is left undefined rather than
 *                     defaulted on purpose -- a fabricated `'read'` would turn
 *                     an unclassified request into an authorised one. Treat
 *                     `undefined` as "not classified" and deny.
 *
 * So a consumer writes `if (model === 'owner' && operation === 'read')`. There
 * is no string to parse, no variant to miss, and no way to fail open through a
 * URL shape nobody anticipated.
 *
 * WHAT THE CONTEXT DOES NOT TELL YOU: WHICH SURFACE. It names the model and
 * the verb, not the route. Measured over the live router, six surfaces produce
 * one identical context:
 *
 *     GET /owners                          { model: 'owner', operation: 'read' }
 *     GET /owners/gina                     { model: 'owner', operation: 'read' }
 *     GET /owners/gina/pets                { model: 'owner', operation: 'read' }
 *     GET /owners/gina/relationships/pets  { model: 'owner', operation: 'read' }
 *     GET /owners/archived                 { model: 'owner', operation: 'read' }
 *     GET /owners/gina?include=pets        { model: 'owner', operation: 'read' }
 *
 * So a rule that depends on the SUB-PATH still needs `request.path` -- which is
 * mount-relative and query-free, and is the one read of argument one the
 * warning below sanctions. This repo's own fixture has such a rule: its
 * `/archived` deny cannot be expressed from the context alone, and a predicate
 * migrated to context-only would silently drop it, turning a deny into an
 * allow.
 *
 * THE RELATED-RESOURCE HALF OF THAT SENTENCE IS NOW OUT OF DATE AND IS
 * CORRECTED HERE RATHER THAN DELETED. Both relationship route families resolve
 * the RELATED model's own access class and ask it
 * `{ model: <related>, operation: 'read', recordId: null }`
 * (abofs/stonyx-orm#232), so those surfaces no longer serve another model's
 * records under `model: 'owner'` unexamined. What the context still gives no
 * signal of is WHICH related record is being asked about -- `recordId` is
 * `null` there and `request.params` names a record of a different model. See
 * `AccessContext.recordId` in ./types/orm-types.ts for the full statement of
 * that limit. `?include=` is still unfiltered and is abofs/stonyx-orm#233 /
 * #235.
 *
 * SUPERSEDED 2026-09-01 BY abofs/stonyx-orm#236/#237, AND KEPT FOR THE
 * CONSTRAINT IT STATES RATHER THAN AS A DESCRIPTION OF THE CODE. The context
 * now also carries `recordId` -- the DECODED route-parameter id, see
 * `AccessContext.recordId` in ./types/orm-types.ts -- so the fixture's
 * `/archived` deny IS expressible from the context alone, and the shipped
 * sample no longer reads `request.path` at all. Retiring this wording WITH the
 * measurement that retires it, rather than by deletion, is
 * abofs/stonyx-orm#238.
 *
 * `record` IS NOT IN THIS CONTEXT, deliberately. `auth()` runs after route
 * matching but BEFORE any handler executes (`@stonyx/rest-server`
 * `src/request.ts:58-60`), so nothing has been fetched yet -- supplying a
 * record would force a pre-fetch on every request, a second store hit and an
 * ordering change in the middle of an authorization path. It is also
 * unnecessary: the FUNCTION return shape already is the per-record hook. Return
 * `(record) => boolean` and the handlers apply it to every record the request
 * touches. Auth-time and record-time are separate decision points.
 *
 * THE SECOND ARGUMENT IS ADDITIVE. JavaScript ignores extra arguments, so an
 * existing `access(request)` predicate keeps working exactly as before. The
 * warning immediately below is therefore still live: `request` is still
 * argument ONE, and reading it is still how predicates fail open.
 *
 * To reach ANOTHER model's predicate -- e.g. to check an animal while servicing
 * an owners route -- use the boot-time registry:
 *
 *     const predicate = Orm.instance.getAccess('animal');
 *     if (!predicate) return deny;
 *     const verdict = predicate(request, { model: 'animal', operation: 'read' });
 *
 * `undefined` means NO PREDICATE COULD BE RESOLVED for that name -- which
 * includes the case where the model has an access class that failed to load,
 * because `setup-rest-server.ts` catches a load failure, warns, and publishes
 * whatever partial map it had. It does NOT mean the model is unrestricted.
 * Treat it as DENY, the same way `operation === undefined` is treated above.
 *
 * PASSING THE CONTEXT MAKES A MODEL-CORRECT ANSWER POSSIBLE. It does not make
 * the answer model-correct on its own -- the resolved predicate has to READ it.
 * Measured against an ARITY-1 predicate, on a request express dispatched to
 * `GET /owners/angela`, asked about ANIMALS:
 *
 *     getAccess('animal')(ownersRequest, { model: 'animal', operation: 'read' })
 *       ->  record => record.id !== 'angela' && record.id !== 'restricted'
 *
 * That is the OWNERS filter, and it returns `true` for animal 21 -- the record
 * hidden on every animal surface. Under a mount that predicate recognises
 * neither way it is worse: it falls through to
 * `['read', 'create', 'update', 'delete']`, a full CRUD grant. Either way the
 * context was supplied and the answer is not the animal answer, and it is wrong
 * in the GRANTING direction, because that predicate is arity-1 and identifies
 * its collection from the request. (Asserted on a live dispatch by AC9 in
 * test/integration/orm-test.ts, against a deliberately arity-1 predicate.)
 *
 * This repo's own sample access class has since been MIGRATED to read the
 * context (abofs/stonyx-orm#222), so `getAccess('animal')` here now answers
 * with the animal filter. That is not true of a consumer tree: an arity-1
 * predicate keeps working -- the second argument is additive -- and the caller
 * has no supported way to tell which kind it got. The boot-time arity warning
 * that surfaces one is abofs/stonyx-orm#221.
 * So: pass the context, and do not treat a resolved predicate's answer as
 * model-specific until that predicate has been migrated to read the context.
 *
 * ---------------------------------------------------------------------------
 * DO NOT RECONSTRUCT THE REQUEST PATH INSIDE `access()`.
 * ---------------------------------------------------------------------------
 * You do not have to. `auth()` below hands your predicate the ACCESS CONTEXT as
 * argument two, and `context.model` already names the collection -- see the
 * contract section above. Argument ONE is still the raw transport artifact, and
 * everything from here to the end of this banner is the record of what happened
 * when predicates worked the collection out from it. IT IS HISTORY, NOT
 * GUIDANCE: do not write any of it into a new predicate. Every attempt to
 * identify the collection by parsing the request target has failed OPEN. Five
 * distinct variants of the same three-line example have now been found, each
 * after the previous was fixed, by five different people:
 *
 *   1. `request.url` is mount-relative under `RestServer.mountRoute`, so a
 *      prefix match against it is ALWAYS false.
 *   2. `request.originalUrl` carries the query string, so an anchored equality
 *      check misses `/owners?filter[age]=30`.
 *   3. The router is a bare `express()` (`caseSensitive: false`) while a
 *      hand-written matcher is case-SENSITIVE, so `GET /OwNeRs/angela` walks
 *      past it. Router-side: abofs/stonyx-rest-server#47.
 *   4. Under a configured `ORM_REST_ROUTE` a hard-coded `/owners` matches
 *      nothing -- environment-specifically, which is worse.
 *   5. HTTP/1.1 permits an ABSOLUTE-FORM request-target. Express routes on
 *      `parseurl(req).pathname`, but `originalUrl` is the raw target, so
 *      `GET http://anything.example/owners/angela` reaches the handler with
 *      `originalUrl === 'http://anything.example/owners/angela'`. A `/owners`
 *      prefix match is false, `access()` falls through to whatever it returns
 *      last, and the record comes back in full. It walks past a hard
 *      `return false` deny the same way.
 *
 * The fix is not a sixth rule, and it is not a better string to match. It is to
 * stop identifying the collection at all: read `context.model`. That is a claim
 * about IDENTIFYING THE COLLECTION, not about the sample as a whole -- the
 * `/archived` SUB-PATH rule is still a string match, and abofs/stonyx-orm#228 is
 * a sixth spelling that gets past it.
 *
 * SUPERSEDED 2026-09-01 BY abofs/stonyx-orm#236/#237: the `/archived` rule is
 * no longer a string match against the request target -- it compares the
 * decoded `recordId` the framework supplies -- and abofs/stonyx-orm#228 is
 * CLOSED. Retirement of this wording: abofs/stonyx-orm#238.
 *
 *   An intermediate revision of the sample read `request.baseUrl` -- the mount
 *   Express ACTUALLY MATCHED. That closed all five variants (no query string,
 *   not mount-relative, unaffected by absolute-form, already carrying the
 *   configured `ORM_REST_ROUTE` prefix), but it was a transport artifact
 *   standing in for a structural fact and the sample no longer does it.
 *   `context.model` IS the structural fact, so variants 1, 2, 4 and 5 are
 *   unconstructible against a migrated predicate rather than handled.
 *
 *   VARIANT 3 SURVIVES, and is deliberately not in that list. It is the general
 *   shape "a hand-written matcher normalises differently from the router", and a
 *   migrated predicate still runs one string comparison for any SUB-PATH rule --
 *   in the shipped sample, the `/archived` deny. That comparison folds case but
 *   does not decode, so `GET /owners/%61rchived` steps past it. See the
 *   normalisation paragraph below and abofs/stonyx-orm#228.
 *
 *   SUPERSEDED 2026-09-01 BY abofs/stonyx-orm#236/#237. Variant 3 lived in that
 *   one string comparison, and the comparison is gone: the sample compares the
 *   decoded `recordId`. Left standing rather than edited because the same
 *   "variant 3 survives" wording sits at four sites -- this header, README.md
 *   twice, and test/sample/access/global-access.ts -- three of which SHIP, so
 *   retiring one of four leaves the shipped copies contradicting each other.
 *   Retiring all four WITH their measurement is abofs/stonyx-orm#238.
 *
 * ONE READ OF ARGUMENT ONE SURVIVES, AND IT MUST: `request.path`. It is
 * mount-relative and query-free, and it is for rules that distinguish SUB-PATHS
 * beneath the mount. The context names which model and which verb, NOT which
 * route, so the sample's `/archived` deny cannot be expressed from the context
 * alone and a context-ONLY rewrite would silently turn that deny into an allow.
 *
 * SUPERSEDED 2026-09-01 BY abofs/stonyx-orm#236/#237: NO read of argument one
 * survives in the shipped sample. `recordId` names WHICH RECORD the route was
 * addressed to, so the `/archived` deny is expressible from the context alone
 * -- and it still must not be dropped; expressible is not optional. Retirement
 * of this wording: abofs/stonyx-orm#238.
 *
 * NORMALISE THE WAY THE ROUTER DOES, AND CASE-FOLDING ALONE IS NOT THAT. The
 * sample lower-cases before comparing, because a matcher stricter than the
 * case-insensitive router can be stepped around. That closes the case gap only.
 * Express sets `request.path` from the RAW, UNDECODED pathname while the router
 * DECODES `:id`, so `GET /owners/%61rchived` reaches a `path === '/archived'`
 * comparison as `/%61rchived` and walks past the deny. That gap is live in the
 * sample and is tracked as abofs/stonyx-orm#228; the `.toLowerCase()` is not a
 * complete normalisation recipe. Compare record ids at their real case.
 *
 * DO NOT FOLLOW THE PARAGRAPH ABOVE. SUPERSEDED 2026-09-01 BY
 * abofs/stonyx-orm#236/#237, and flagged here rather than merely dated because
 * it is an INSTRUCTION, not a stale observation. `.toLowerCase()` on the access
 * path was measured WRONG IN BOTH DIRECTIONS AT ONCE: with a distinct owner
 * seeded at `ARCHIVED`, `GET /owners/ARCHIVED` was a false DENY on the wrong
 * record and `GET /owners/%41RCHIVED` a false ALLOW on that same record. A
 * record id is a VALUE, not a literal route segment, and express's
 * `case sensitive routing` governs literal segments only. Compare
 * `context.recordId` AS IT ARRIVES: do not case-fold it, do not decode it, do
 * not derive it from `request.path`. `AccessContext.recordId` in
 * ./types/orm-types.ts is the contract and says "Do NOT case-fold it"; the same
 * published tarball ships both files, and THIS paragraph is the one that is
 * wrong. Retiring it WITH its measurement is abofs/stonyx-orm#238.
 *
 * `?? ''` is not a defence. It converts an absent request target into an empty
 * string, which matches no collection, which falls through to the permission
 * array -- a total grant. An input you cannot identify must DENY, and that
 * applies to BOTH arguments: since #202 the guard and the read can sit on
 * different objects, and a guard on argument two does not protect a read of
 * argument one. The sample returns `false` for an absent `model` AND for an
 * absent or non-string `request.path`, rather than falling through either way.
 *
 * SUPERSEDED 2026-09-01 BY abofs/stonyx-orm#236/#237 as to WHAT is guarded --
 * the principle is unchanged. The sample no longer reads `request.path`, so it
 * returns `false` for an absent `model` AND for an absent `recordId`
 * (`undefined`, the one spelling `auth()` never produces). Retirement of this
 * wording: abofs/stonyx-orm#238.
 *
 * THE REAL FIX IS abofs/stonyx-orm#202: `access()` should receive the model,
 * the operation and the record. Prefer the array shape (`['read']`) or `false`
 * until #202 lands; the function shape is what requires any matching at all.
 *
 * The enforcement gates in this file (GATE 0/1/2, the create rollback, the
 * per-handler `isDenied` re-checks) are correct independently of that -- they
 * enforce whatever predicate you return. The stopgap is the part where YOU have
 * to work out which predicate to return.
 *
 * AND A PREDICATE IS NOT A GUARANTEE THAT A HIDDEN RECORD CANNOT BE MODIFIED.
 * It is evaluated against the record the route is ADDRESSED TO, on that model
 * only. A write to a DIFFERENT collection can still re-parent a hidden record
 * and de-hide it -- abofs/stonyx-orm#207, which is blocked on #202 and #196.
 * See `### Known limitations` in README.
 */
import { Request } from '@stonyx/rest-server';
import Orm, { store, createRecord, updateRecord } from '@stonyx/orm';
import { camelCaseToKebabCase } from '@stonyx/utils/string';
import { getPluralName } from './plural-registry.js';
import { getBeforeHooks, getAfterHooks } from './hooks.js';
import type { HookContext } from './hooks.js';
import config from 'stonyx/config';
import log from 'stonyx/log';
import type { OrmRecord, AccessContext, AccessFunction, AccessMethod, AccessOperation, LinkageFilter } from './types/orm-types.js';
import { isOrmRecord, NO_FREE_ID_ERROR } from './utils.js';
import { interpretAccess, createLinkageFilter } from './access-verdict.js';

interface OrmRequest$ extends Request {
  protocol?: string;
  method: string;
  params: { [key: string]: string };
  body?: { [key: string]: unknown };
  query?: { [key: string]: string };
  get(header: string): string;
}

interface RelationshipInfo {
  type: 'belongsTo' | 'hasMany';
  isArray: boolean;
}

interface Filter {
  path: string[];
  value: string;
}

interface JsonApiResponse {
  data: unknown;
  links?: { [key: string]: string };
  included?: unknown[];
}

type HandlerFn = (request: OrmRequest$, state: { [key: string]: unknown }) => unknown | Promise<unknown>;

const methodAccessMap: { [key: string]: AccessOperation } = {
  GET: 'read',
  POST: 'create',
  DELETE: 'delete',
  PATCH: 'update',
};

const WRITE_OPERATIONS = new Set(['create', 'update', 'delete']);

// Helper to detect relationship type from function
function getRelationshipInfo(property: unknown): RelationshipInfo | null {
  if (typeof property !== 'function') return null;
  const relType = (property as { __relationshipType?: string }).__relationshipType;
  if (relType === 'belongsTo') {
    return { type: 'belongsTo', isArray: false };
  }
  if (relType === 'hasMany') {
    return { type: 'hasMany', isArray: true };
  }
  return null;
}

// Helper to introspect model relationships
function getModelRelationships(modelName: string): { [key: string]: RelationshipInfo } {
  const { modelClass } = Orm.instance.getRecordClasses(modelName);
  if (!modelClass) return {};

  const model = new (modelClass as new (name: string) => { [key: string]: unknown })(modelName);
  const relationships: { [key: string]: RelationshipInfo } = {};

  for (const [key, property] of Object.entries(model)) {
    if (key.startsWith('__')) continue;
    const info = getRelationshipInfo(property);
    if (info) {
      relationships[key] = info;
    }
  }

  return relationships;
}

// Helper to build base URL from request
function getBaseUrl(request: OrmRequest$): string {
  const protocol = request.protocol || 'http';
  const host = request.get('host');
  return `${protocol}://${host}`;
}

/**
 * The ONE coercion from a caller-supplied id to the key the store holds it
 * under. Every id-bearing surface in this file goes through it, and none has a
 * copy: `getId()` (URL params), `normalizeBodyId()` (JSON body), and the
 * post-create `context.record` lookup in `_withHooks`.
 *
 * WHY IT IS SHARED RATHER THAN DUPLICATED. `getId()` and `normalizeBodyId()`
 * each had their own arithmetic, and they disagreed: `parseInt(id)` versus
 * `parseInt(id, 10)`. On a hex-shaped id that is a two-record difference --
 *
 *   GET  /animals/0x2391          -> record 9105   (getId    -> parseInt('0x2391')     = 9105)
 *   POST /animals {"id":"0x2391"} -> lookup under 0 (normalize -> parseInt('0x2391',10) = 0)
 *                                 -> a MISS, so the duplicate check was skipped and
 *                                    createRecord OVERWROTE 9105 in place, answering 200
 *
 * -- a narrower form of the raw-versus-normalised divergence that the body-id
 * normalisation was added to close, reintroduced by the fix for it. Two
 * coercions that must agree cannot be kept in agreement by review; they have to
 * be one function. Pinned by assertion 43.
 *
 * The third copy was found later and in a quieter place: `_withHooks` populated
 * `context.record` for `create` with `isNaN(id) ? id : parseInt(id)` -- this
 * function's body, inlined verbatim, feeding `store.get`. It was equivalent on
 * every input reachable there, which is exactly what the two that DID diverge
 * looked like until someone tried a hex id.
 *
 * SHARING IT IS NOT THE SAME AS IT BEING RIGHT EVERYWHERE. On a model declaring
 * `id = attr('string')` a numeric-looking id is filed under the STRING key, so
 * this coercion resolves `'9107'` to `9107` and the post-create lookup misses:
 * `context.record` is `undefined` for an after-`create` hook. Inherited -- the
 * inlined copy computed the same thing -- and NOT fixed here, because picking
 * the right coercion needs the model's declared id type, which is the same
 * structural information abofs/stonyx-orm#202 is about. Filed as
 * abofs/stonyx-orm#209 and pinned by assertion 50, so closing it turns a test
 * red rather than passing silently.
 *
 * `parseInt` and not `Number`, deliberately, and the anchor is NOT `getId`.
 * It is `src/transforms.ts:7` -- `number: (value) => parseInt(value as string)`,
 * also radix-less -- because that transform is what actually produces the store
 * KEY a record is filed under. `getId` merely agrees with it. They differ from
 * `Number` on `'1e3'` (1 vs 1000) and `'9105.5'` (9105 vs 9105.5), so switching
 * this function to `Number` would make the lookup key disagree with the landing
 * key on those shapes.
 *
 * THE CHANGE THAT WOULD BREAK THIS: adding a radix to `transforms.number`
 * (`parseInt(value, 10)`). That is a one-word edit in a file with no connection
 * to authorization, it would silently reopen the hex divergence in the other
 * direction, and this comment would still read as correct. Assertion 45 pins
 * the transform's radix-less shape directly, so that edit turns a test red
 * rather than shipping.
 *
 * The reason `parseInt` is safe here is the `isNaN` gate in front of it:
 * `parseInt('9105h')` is `9105`, and truncating a partially-valid id into a
 * DIFFERENT VALID key is exactly how a collision lookup gets skipped. The gate
 * rejects it as a string instead, so nothing is ever truncated. That gate, not
 * the parser, is the load-bearing half -- assertion 43 pins it.
 */
function coerceId(id: string): string | number {
  if (isNaN(id as unknown as number)) return id;

  return parseInt(id);
}

function getId(params: { id?: string; [key: string]: unknown }): string | number {
  const id = params.id;
  if (!id) return '';

  return coerceId(id);
}

/**
 * Normalise a caller-supplied BODY id to the key the store will hold it under.
 *
 * `getId()` above is params-shaped: it takes `{ id?: string }` off the URL,
 * where the value is always a string and a falsy one means "no id". A JSON body
 * id is neither -- it can arrive as a number, and `0` is a legitimate id that
 * `getId()` would flatten to `''`.
 *
 * WHY THIS EXISTS AT ALL. createHandler used to look the collision up with the
 * RAW body value while every other surface normalised through `getId()`. The
 * store is a Map keyed by the coerced value, so `store.find(model, '21')` misses
 * the entry held under `21` and the duplicate check is skipped by typing the id
 * as a string. On `dev` that silently overwrote the colliding record and
 * answered 200; combined with the denied-create rollback added for #190 it
 * became an unauthenticated DELETE of any id. Normalising here is half of that
 * fix -- see the rollback in createHandler for the other half.
 *
 * It shares `coerceId` with `getId` so the two surfaces cannot drift apart
 * again, and differs from `getId` in exactly ONE place, below.
 */
function normalizeBodyId(id: string | number): string | number {
  // Non-strings pass through untouched: a JSON body id can arrive as a number,
  // and `getId`'s falsy-flatten must NOT apply to it -- `0` is a legitimate id
  // and `getId` would turn it into `''`. (assertion 30 sweeps id `0`.)
  if (typeof id !== 'string') return id;

  // THE ONE DIVERGENCE FROM `getId`, and it mirrors rather than contradicts it:
  // `getId` maps a falsy param to `''`, and `''` is the only string a body can
  // carry that means "no id" -- `createRecord` treats it as absent and assigns a
  // server id. Coercing it instead would make it address a real slot, because
  // `parseInt('')` is `NaN` and a record CAN be held under `NaN` (a truthy but
  // non-numeric id such as `'   '` survives `assignRecordId`'s falsy guard and
  // then NaNs in the id transform). So `POST {"id":""}` would answer 409 against
  // an unrelated record it never named. Pinned by assertion 44.
  //
  // Note what is deliberately NOT special-cased here any more: whitespace.
  // `id.trim() === ''` used to short-circuit `'   '` as well, which made the
  // body surface DISAGREE with the URL surface -- `getId({id:'   '})` is `NaN`,
  // so `'   '` addresses the NaN slot on every other route while the collision
  // lookup missed it. Same class of bug as the hex divergence above.
  if (id === '') return id;

  return coerceId(id);
}

function buildResponse(
  data: unknown,
  includeParam: string | undefined,
  recordOrRecords: OrmRecord | OrmRecord[],
  options: { links?: { [key: string]: string }; baseUrl?: string; linkage?: LinkageFilter } = {}
): JsonApiResponse {
  const { links, baseUrl, linkage } = options;
  const response: JsonApiResponse = { data };

  // Add top-level links
  if (links) {
    response.links = links;
  }

  if (!includeParam) return response;

  const includes = parseInclude(includeParam);
  if (includes.length === 0) return response;

  const includedRecords = collectIncludedRecords(recordOrRecords, includes);
  if (includedRecords.length > 0) {
    // LINKAGE, NOT MEMBERSHIP -- and the distinction is the whole reason this
    // line is one story's and the line above it is another's
    // (abofs/stonyx-orm#235 and #233 respectively).
    //
    //   - WHICH RESOURCES REACH THIS ARRAY is decided by
    //     `collectIncludedRecords` on the line above. That is MEMBERSHIP, it is
    //     #233's, and it is deliberately untouched here: a hidden owner is
    //     still a member of `included` after this change. Pinned green by
    //     `[GUARD] #235 X1` so that #235 cannot close #233 incidentally.
    //   - WHAT A RECORD ALREADY IN THIS ARRAY MAY NAME in its own
    //     `relationships.*.data` is LINKAGE -- the same question #234 answers
    //     for the primary document -- and that is what the `linkage` option
    //     below decides. Before it, `GET /animals/1?include=owner,owner.pets`
    //     filtered the primary document's `owner.data` to `null` and then
    //     handed back eight PERMITTED animals in `included` each naming
    //     `{"type":"owner","id":"angela"}` -- angela's whole `pets` set,
    //     `[1, 3, 7, 10, 11, 15, 17, 20]`. `included` itself is NINE
    //     resources there: those eight animals plus the hidden owner, whose
    //     membership is #233's and not an animal. Neither #233 nor #234
    //     closes that.
    //
    // THE FILTER IS THE CALLER'S, PASSED IN, NOT BUILT HERE. Both call sites
    // already hold one for the primary document, and sharing it is what keeps
    // the per-type verdict cache and the per-(type, id) decision cache alive
    // across the primary document AND the sideload -- one verdict resolution
    // per type for the whole response, pinned by `[GUARD] #235 C1`. Building a
    // fresh filter here would resolve the consumer's `access()` once per
    // included record instead.
    //
    // `linkage` IS OPTIONAL IN THE TYPE AND IS NOT OPTIONAL IN PRACTICE.
    // Stating it precisely because the opposite claim stood here in an earlier
    // draft of this change: BOTH of this function's callers supply a filter
    // (`getCollectionHandler` and `getSingleHandler`, the only two), so the
    // `undefined` branch has no live caller in this module today. It is
    // optional so that omitting it degrades to the PRE-#234 document rather
    // than to a denial -- `Record.toJSON` reads an ABSENT option as "no verdict
    // was supplied" and emits linkage in full.
    //
    // WHAT IT MUST NEVER BE HANDED IS A NON-FUNCTION. `toJSON` does NOT read a
    // non-function as absent: `Object.prototype.toString.call(linkage)` must be
    // `'[object Function]'`, and anything else -- `null`, an `AsyncFunction`,
    // and INCLUDING the primitive `true` -- DENIES every relationship on the
    // document and logs once. `toJSON({ linkage: true })` emits `null` linkage.
    // So do not "simplify" this to a boolean, and do not make it default to
    // `true`: both spellings look like "allow everything" and mean the exact
    // opposite (abofs/stonyx-orm#224).
    response.included = includedRecords.map(record => record.toJSON?.({ baseUrl, linkage }));
  }

  return response;
}

/**
 * Recursively traverse an include path and collect related records
 */
function traverseIncludePath(
  currentRecords: OrmRecord[],
  includePath: string[],
  depth: number,
  seen: Map<string, Set<string | number>>,
  included: OrmRecord[]
): void {
  if (depth >= includePath.length) return; // Reached end of path

  const relationshipName = includePath[depth];
  const nextRecords: OrmRecord[] = [];

  for (const record of currentRecords) {
    if (!record.__relationships) continue;
    if (!(relationshipName in record.__relationships)) continue;

    const relatedRecords = record.__relationships[relationshipName];
    if (!relatedRecords) continue;

    // Handle both belongsTo (single) and hasMany (array)
    const recordsToProcess: OrmRecord[] = Array.isArray(relatedRecords)
      ? relatedRecords.filter(isOrmRecord)
      : isOrmRecord(relatedRecords) ? [relatedRecords] : [];

    for (const relatedRecord of recordsToProcess) {
      if (!relatedRecord) continue;

      if (!relatedRecord.__model) continue;
      const type = relatedRecord.__model.__name;
      const id = relatedRecord.id as string | number;

      // Initialize Set for this type if needed
      let seenIds = seen.get(type);
      if (!seenIds) {
        seenIds = new Set();
        seen.set(type, seenIds);
      }

      // Check if we've already seen this type+id combination
      if (!seenIds.has(id)) {
        seenIds.add(id);
        included.push(relatedRecord);
        nextRecords.push(relatedRecord); // Prepare for next depth level
      } else if (depth < includePath.length - 1) {
        // Even if we've seen this record, we might need it for deeper traversal
        nextRecords.push(relatedRecord);
      }
    }
  }

  // If there are more segments in the path, recursively process
  if (depth < includePath.length - 1 && nextRecords.length > 0) {
    traverseIncludePath(nextRecords, includePath, depth + 1, seen, included);
  }
}

function collectIncludedRecords(data: OrmRecord | OrmRecord[], includes: string[][]): OrmRecord[] {
  if (!includes || includes.length === 0) return [];
  if (!data) return [];

  const seen = new Map<string, Set<string | number>>(); // Map<type, Set<id>> for deduplication
  const included: OrmRecord[] = [];

  // Normalize to array for consistent processing
  const records: OrmRecord[] = Array.isArray(data) ? data : [data];

  // Process each include path
  for (const includePath of includes) {
    traverseIncludePath(records, includePath, 0, seen, included);
  }

  return included;
}

function parseInclude(includeParam: string | undefined): string[][] {
  if (!includeParam || typeof includeParam !== 'string') return [];

  return includeParam
    .split(',')
    .map(rel => rel.trim())
    .filter(rel => rel.length > 0)
    .map(rel => rel.split('.')); // Parse nested paths: "owner.pets" -> ["owner", "pets"]
}

function parseFields(query: { [key: string]: string } | undefined): Map<string, Set<string>> {
  const fields = new Map<string, Set<string>>();
  if (!query) return fields;

  for (const [key, value] of Object.entries(query)) {
    const match = key.match(/^fields\[(\w+)\]$/);
    if (match && typeof value === 'string') {
      const modelName = match[1];
      const fieldNames = value.split(',').map(f => f.trim()).filter(f => f);
      fields.set(modelName, new Set(fieldNames));
    }
  }

  return fields;
}

function parseFilters(query: { [key: string]: string } | undefined): Filter[] {
  const filters: Filter[] = [];
  if (!query) return filters;

  for (const [key, value] of Object.entries(query)) {
    const match = key.match(/^filter\[(.+)\]$/);
    if (match && typeof value === 'string') {
      filters.push({ path: match[1].split('.'), value });
    }
  }

  return filters;
}

function createFilterPredicate(filters: Filter[]): ((record: { [key: string]: unknown }) => boolean) | null {
  if (filters.length === 0) return null;

  return (record: { [key: string]: unknown }) => filters.every(({ path, value }) => {
    let current: unknown = record;

    for (const segment of path) {
      if (current == null) return false;
      current = (current as { [key: string]: unknown })[segment];
    }

    return String(current) === value;
  });
}

/**
 * A function-style `access` return is a per-record predicate, and it is only
 * meaningful if every surface that can hand a record to a caller consults it.
 * Before #190 exactly one of seven did.
 *
 * Enforcement is deliberately post-fetch. `access` returns an opaque JS
 * predicate and `store.findAll(model, conditions)` accepts only an equality
 * conditions object that the SQL drivers translate to a WHERE clause, so
 * query-layer enforcement would require a breaking change to the published
 * `access` contract. That belongs in #197, not in a security patch. Six of the
 * seven surfaces fetch by primary key anyway, so this costs exactly one row.
 */
function isDenied(filter: unknown, record: unknown): boolean {
  if (typeof filter !== 'function') return false;

  // A predicate that throws is treated as a denial. Unguarded, a throw escapes
  // to express's default handler, which answers 500 (with a stack trace outside
  // NODE_ENV=production) while a missing id still answers 404 -- so a
  // record-dependent throw re-separates "hidden" from "does not exist" and
  // hands back the oracle this whole change exists to close.
  try {
    return !(filter as (record: unknown) => boolean)(record);
  } catch (error) {
    // Denied, but not silently. A consumer predicate that throws on every
    // record turns the whole collection into a 404 wall, and with no
    // diagnostic that is indistinguishable from an empty database. `stonyx/log`
    // is the module convention (see setup-rest-server.ts); optional-call
    // because a consumer may not have configured the log types.
    log.error?.(`[@stonyx/orm] access filter threw for model -- denying. ${error instanceof Error ? error.message : String(error)}`);

    return true;
  }
}

export default class OrmRequest extends Request {
  model: string;
  access: AccessFunction;
  handlers: { [key: string]: { [key: string]: HandlerFn } };

  constructor({ model, access }: { model: string; access: AccessFunction }) {
    super(...arguments as unknown as unknown[]);

    this.model = model;
    this.access = access;
    const pluralizedModel = getPluralName(model);

    const modelRelationships = getModelRelationships(model);

    // Define raw handlers first
    const getCollectionHandler: HandlerFn = async (request, { filter: accessFilter }) => {
      const allRecords = (await store.findAll(model)).filter(isOrmRecord);

      const queryFilters = parseFilters(request.query);
      const queryFilterPredicate = createFilterPredicate(queryFilters);
      const fieldsMap = parseFields(request.query);
      const modelFields = fieldsMap.get(pluralizedModel) || fieldsMap.get(model);

      let recordsToReturn = allRecords;
      if (accessFilter) recordsToReturn = recordsToReturn.filter(accessFilter as (record: OrmRecord) => boolean);
      if (queryFilterPredicate) recordsToReturn = recordsToReturn.filter(queryFilterPredicate as (record: OrmRecord) => boolean);

      const baseUrl = getBaseUrl(request);

      // ONE filter per REQUEST, not one per record: it carries the per-type
      // verdict cache and the per-(type, id) decision cache, and both are
      // worthless if it is rebuilt inside the map. Measured on this exact
      // surface with no `include=`: 48 linkage entries collapse to 7 distinct
      // (type, id) pairs.
      const linkage = createLinkageFilter(request);
      const data = recordsToReturn.map(record => record.toJSON?.({ fields: modelFields, baseUrl, linkage }));

      return buildResponse(data, request.query?.include, recordsToReturn, {
        links: { self: `${baseUrl}/${pluralizedModel}` },
        baseUrl,
        // THE SAME filter object the primary documents above were serialized
        // with, deliberately: it carries the caches, and rebuilding one here
        // would re-resolve every type (abofs/stonyx-orm#235).
        linkage
      });
    };

    const getSingleHandler: HandlerFn = async (request, { filter }) => {
      const record = await store.find(model, getId(request.params)) as OrmRecord | undefined;
      if (!record) return 404;
      // 404, never 403: the status for "exists but filtered out" must be
      // identical to "does not exist", or the fix trades an authorization
      // bypass for a narrower existence oracle.
      if (isDenied(filter, record)) return 404;

      const fieldsMap = parseFields(request.query);
      const modelFields = fieldsMap.get(pluralizedModel) || fieldsMap.get(model);

      const baseUrl = getBaseUrl(request);
      const linkage = createLinkageFilter(request);

      // `buildResponse` IS given the filter now (abofs/stonyx-orm#235), and it
      // is the SAME object the primary document is serialized with -- one
      // verdict per type for the whole response, sideload included.
      //
      // The boundary that remains, so the next reader does not have to derive
      // it: this closes what a record already in `included` may NAME. WHETHER a
      // resource appears in `included` at all is MEMBERSHIP and it is
      // abofs/stonyx-orm#233's -- a hidden owner is still a member here.
      // Neither question closes the other.
      return buildResponse(record.toJSON?.({ fields: modelFields, baseUrl, linkage }), request.query?.include, record, {
        links: { self: `${baseUrl}/${pluralizedModel}/${request.params.id}` },
        baseUrl,
        linkage
      });
    };

    const createHandler: HandlerFn = async (request, { filter }) => {
      // BOUND, not destructured (abofs/stonyx-orm#235). `HandlerFn` has always
      // delivered the request as argument one; this handler simply discarded
      // the binding, which is why its response document named ids every read
      // surface withholds. `createLinkageFilter` needs the live request and
      // there is no signature change involved in giving it one.
      const { body, query } = request;
      const { type, id, attributes, relationships: rels } = (body?.data || {}) as {
        type?: string;
        id?: string | number;
        attributes?: { [key: string]: unknown };
        relationships?: { [key: string]: { data?: { id?: string | number } } };
      };

      if (!type) return 400; // Bad request

      const fieldsMap = parseFields(query);
      const modelFields = fieldsMap.get(pluralizedModel) || fieldsMap.get(model);

      // GATE 0 -- the POST existence oracle.
      //
      // The duplicate check runs before the filter and `store.find` sees hidden
      // records, so POST leaks existence through its STATUS. A previous revision
      // filtered the collision status (403 when the colliding record is denied,
      // 409 when it is visible) and that is NOT sufficient, because the status
      // of a create is a third outcome. With a payload the caller is permitted
      // to create -- the normative case for a per-tenant filter, and the case an
      // attacker picks -- all three are distinguishable in ONE request per id:
      //
      //   POST /animals {id:22,   owner:'gina'} -> 403   a HIDDEN record has this id
      //   POST /animals {id:9500, owner:'gina'} -> 200   this id is FREE
      //   POST /animals {id:8,    owner:'gina'} -> 409   a VISIBLE record has this id
      //
      // Filtering only the collision status narrows that to callers who cannot
      // create a record they are allowed to see. It does not close it.
      //
      // It cannot be closed while a caller both chooses the id and learns
      // whether the create succeeded: a successful create must answer
      // differently from a refused one. So when a per-record filter is in force
      // the caller does not get to choose the id at all. The refusal is
      // UNCONDITIONAL and happens BEFORE any store lookup, so no status, and no
      // lookup cost, can depend on whether that id exists. 403 -- the same
      // status as a denied create -- so the two cannot be separated either.
      //
      // BOTH HALVES OF THAT ARE PINNED, because both were once asserted here and
      // pinned by nothing:
      //
      //   status  -- assertion 22 sweeps payload x id x id-type, plus `null`.
      //   latency -- assertion 41 asserts NO `store.find` is issued on this
      //              path. Moving the refusal to after a lookup and returning
      //              the same 403 left the suite green while re-opening a
      //              hit-versus-miss timing difference on every id-bearing POST,
      //              which is what would turn #197 from a ~0.06ms post-fetch
      //              residual into a live timing oracle on create.
      //
      // AND THE GUARANTEE IS ONLY AS WIDE AS THE CHANNELS IT COVERS. It reads on
      // the `id` member of the resource object, so it holds only while that is
      // the ONLY way a caller id can reach `createRecord`. It was not: the
      // relationships loop below re-admitted one under `key === "id"` and the
      // gate never fired. Both strips -- `attributes.id` and `relationships.id`
      // -- are therefore part of THIS gate, not tidiness, and assertion 39 pins
      // them. Adding a third channel without a strip re-opens the oracle.
      //
      // Scoped to function-style `access` because that is exactly the population
      // the oracle exists for: with no per-record filter there are no hidden
      // records, and 409 discloses nothing GET /:id does not already.
      //
      // RESIDUALS, stated rather than implied.
      //
      //   - a caller can still learn that a collection HAS a per-record filter
      //     (403 rather than 409/200 for an id-bearing POST). That discloses a
      //     configuration fact, not a record.
      //   - this gate is about ids arriving on THIS model's create route. It
      //     says nothing about a write to ANOTHER collection: a `POST /owners`
      //     carrying `relationships: {pets: {data: {id: 21}}}` -- or
      //     `attributes: {pets: [21, 22]}`, which never enters the
      //     relationships loop at all -- re-parents hidden animal 21 onto an
      //     owner the caller may write, which changes the very field the
      //     animals predicate reads and DE-HIDES it. Blocking that needs animal
      //     21 checked against the ANIMAL model's predicate while servicing an
      //     OWNERS route, i.e. cross-model access resolution: abofs/stonyx-orm
      //     #207, blocked on #202 (`access` receives the model structurally)
      //     and #196 (setup-rest-server discards the model->predicate map at
      //     boot). NOT closed here, and no comment in this file may say it is.
      //
      // See README `### Known limitations`.
      if (id !== undefined) {
        if (typeof filter === 'function') return 403; // Forbidden

        // `normalizeBodyId`, not the raw value: a string-typed id misses the
        // store's numeric key, which skipped this check entirely.
        const existing = await store.find(model, normalizeBodyId(id));
        if (existing) return 409; // Conflict
      }

      const { id: _ignoredId, ...sanitizedAttributes } = attributes || {};

      // Extract relationship IDs from JSON:API relationships object.
      //
      // `key` comes VERBATIM from the request body, so `id` is stripped here for
      // exactly the same reason it is stripped from `attributes` on the line
      // above -- and it must be, or GATE 0 is walked around by moving one field:
      //
      //   POST /animals {"id":21, ...}                    -> 403  GATE 0 fires
      //   POST /animals {"relationships":{"id":{"data":{"id":21}}},
      //                  "attributes":{"owner":"gina"}}   -> 200  BYPASS
      //
      // Top-level `id` stayed `undefined`, so GATE 0 never fired and the
      // collision lookup never ran; `createRecord` took its last-entry-wins
      // branch, overwrote hidden record 21 in place and reset its `owner` to a
      // value the caller chose -- de-hiding it permanently. That is #190 itself,
      // on the create surface. Pinned by assertion 39.
      //
      // The `id` member of the resource object is now the ONLY channel a caller
      // id can arrive on FOR THIS MODEL'S OWN CREATE ROUTE, which is what makes
      // GATE 0's guarantee checkable rather than merely asserted. It is not a
      // statement about the record's reachability in general -- a relationship
      // write on another collection reaches it without ever touching this
      // handler (abofs/stonyx-orm#207). INHERITED from `dev`, which carries this
      // loop verbatim; the general form -- the loop accepts any key, not just
      // `id`, so a body key that is not a declared relationship is still
      // mass-assigned -- is abofs/stonyx-orm#204.
      if (rels) {
        for (const [key, value] of Object.entries(rels)) {
          if (key === 'id') continue;

          const relData = value?.data;
          if (relData && relData.id !== undefined) {
            (sanitizedAttributes as { [key: string]: unknown })[key] = relData.id;
          }
        }
      }

      const recordAttributes = id !== undefined ? { id, ...sanitizedAttributes } : sanitizedAttributes;

      // Slot count BEFORE the write. `createRecord` writes to the store before
      // the predicate can run, and the rollback below must be able to prove the
      // slot it removes is one THIS REQUEST created. Identity alone cannot
      // prove it: when `assignRecordId` lands on an occupied id, `createRecord`
      // mutates the existing OrmRecord IN PLACE, so `store.get(...) === record`
      // is true for a record the request did not create. The map's size is the
      // only O(1) signal that distinguishes an insert from an overwrite.
      const slotsBefore = store.get(model)?.size ?? 0;

      // THE ONE `createRecord` FAILURE THIS ROUTE ANSWERS RATHER THAN
      // PROPAGATES, and it is narrow on purpose.
      //
      // `assignRecordId` throws when it cannot derive a free store key for a
      // server-assigned id. Unguarded that rejection is auto-forwarded -- there
      // is no catch here, none in @stonyx/rest-server's dispatcher
      // (dist/request.js:41-70), and express 5 hands it to its default error
      // handler, which serialises the STACK, with absolute install paths and the
      // internal module graph, to an unauthenticated caller outside
      // NODE_ENV=production. That is the hazard :553-558 already names in this
      // file, and every sibling refusal in this handler returns an integer
      // status instead. So this one returns 409, matching the client-duplicate
      // refusal at :713: the caller asked for a record and the collection has no
      // id to give it.
      //
      // MATCHED ON THE SHARED PREFIX, not on a literal, and NOT by catching
      // everything: `createRecord` also throws for "ORM is not ready", a
      // read-only view and an unregistered model store, and turning any of those
      // into a 409 would report a configuration fault as a conflict. Anything
      // else is re-thrown unchanged.
      let created;

      try {
        created = createRecord(model, recordAttributes as { [key: string]: unknown }, { serialize: false, _skipAutoPersist: true });
      } catch (error) {
        if (!(error instanceof Error) || !error.message.startsWith(NO_FREE_ID_ERROR)) throw error;

        // Not silently. A collection that can no longer assign an id is a
        // configuration fault (a non-injective id transform), and a bare 409
        // with no diagnostic is indistinguishable from an ordinary duplicate.
        log.error?.(`[@stonyx/orm] ${error.message}`);

        return 409; // Conflict
      }

      const record = isOrmRecord(created) ? created : null;
      if (!record) return 500;

      const createdNewSlot = (store.get(model)?.size ?? 0) > slotsBefore;

      // 403 here, NOT 404. The oracle argument does not apply to create: there
      // is no pre-existing record whose existence could leak, the caller
      // supplied the attributes, and 404 on a mounted collection route is
      // indistinguishable from "model not mounted" -- a genuinely different
      // failure a developer needs to diagnose.
      //
      // The rollback is not optional. createRecord writes to the store BEFORE
      // the predicate can run, so returning 403 alone would leave the record
      // behind: a worse bug than the bypass being fixed.
      if (isDenied(filter, record)) {
        // ROLL BACK BY IDENTITY, NEVER BY ID. `store.remove(model, record.id)`
        // on its own is a write primitive keyed by a value the caller may have
        // supplied: with the raw-id collision bypass above, a denied
        // `POST {"id":"21"}` answered 403 and DELETED hidden record 21 -- an
        // unauthenticated deletion primitive across the whole id space, created
        // by adding a rollback to a lookup that could be skipped.
        //
        // Both conditions are required and neither implies the other:
        //   createdNewSlot -- the store grew, so this request inserted rather
        //                     than overwrote. SURVIVOR AS OF #203, AND THAT IS
        //                     WHAT THIS NOTE IS FOR. It used to be killable:
        //                     `assignRecordId` returned last-INSERTED + 1, so a
        //                     server-assigned id could land on an occupied slot,
        //                     `createRecord` updated in place, and removing this
        //                     half turned access-filter-enforcement-test.ts
        //                     assertion 31 red. #203 closed that: the
        //                     server-assigned path now walks past occupied keys,
        //                     so no create reaching here can overwrite. Measured
        //                     -- delete `createdNewSlot &&` below: `dev` gives
        //                     55 pass / 1 fail with assertion 31 RED, this tree
        //                     gives 56 pass / 0 fail, GREEN.
        //                     KEPT ANYWAY, AND NOT FOR THE OLD REASON. Without
        //                     it a denied create becomes `store.remove` on a key
        //                     the caller may have influenced, which :815-820
        //                     records as having been an unauthenticated deletion
        //                     primitive across the whole id space. BECOMES
        //                     KILLABLE AGAIN the moment any caller-supplied id
        //                     can reach `createRecord` from this handler --
        //                     which is exactly what has-many.ts:65 and
        //                     belongs-to.ts:45 already do for ANOTHER model's
        //                     store (abofs/stonyx-orm#207), and what a third
        //                     un-stripped id channel would do for this one
        //                     (#204). Do not delete it on the strength of #203
        //                     being closed; that is the reasoning :862-867 warns
        //                     about, one level up.
        //   identity       -- the slot still holds the object we just created,
        //                     so nothing between createRecord and here replaced
        //                     it. Deleting this half SURVIVES the suite, and it
        //                     is kept anyway. WHY IT IS REDUNDANT: there is no
        //                     `await` anywhere between `slotsBefore` and
        //                     `store.remove` -- the whole window is synchronous,
        //                     so it is atomic under Node's event loop; before-
        //                     `create` hooks run BEFORE the handler
        //                     (`_withHooks` runs its hook loop ahead of
        //                     `await handler(...)`), and a consumer predicate
        //                     inside `isDenied` runs AFTER `createdNewSlot` is
        //                     computed and cannot flip it. That is a property of
        //                     THIS function, not of GATE 0 -- an earlier note
        //                     credited GATE 0, which was both wrong (a caller id
        //                     reached createRecord through the relationships
        //                     loop, #204) and the wrong kind of reason: a guard
        //                     justified on code sixty lines upstream gets
        //                     silently re-armed when that code moves.
        //                     SO IT BECOMES REACHABLE IF AN `await` IS
        //                     INTRODUCED HERE, which is the change a future
        //                     editor would actually make. Stated here rather
        //                     than by reference: `docs/` is not in `files`, so
        //                     a pointer into it resolves to nothing for anyone
        //                     who installed this package. README carries the
        //                     consumer-facing half.
        if (createdNewSlot && store.get(model, record.id as string | number) === record) {
          store.remove(model, record.id as string | number, { _skipAutoPersist: true });
        }

        return 403;
      }

      // The filter is built HERE, per invocation, and never hoisted into the
      // OrmRequest constructor where the other per-mount values live: a verdict
      // cached across requests answers a second caller with the first caller's
      // authorization (src/access-verdict.ts says so at the constructor an
      // implementer would reach for).
      //
      // AND IT IS BUILT AFTER `createRecord`, AFTER THE ROLLBACK WINDOW AND
      // AFTER `isDenied`, so the record is in its final form at the call. The
      // filter is lazy per type and per (type, id), so it cannot observe a
      // pre-write state even if it were built earlier.
      //
      // `fields` is passed here and NOT in `updateHandler`: the two handlers
      // are asymmetric on purpose (`updateHandler` has no `fieldsMap` in
      // scope), and a single copy-pasted wiring would drop it from one of them.
      return { data: record.toJSON?.({ fields: modelFields, linkage: createLinkageFilter(request) }) };
    };

    const updateHandler: HandlerFn = async (request, { filter }) => {
      // Bound rather than destructured, for the reason given in
      // `createHandler` above (abofs/stonyx-orm#235). `PATCH /animals/1`
      // returned 200 naming angela seconds after `GET /animals/1` returned
      // `owner.data: null` for the same record -- one HTTP verb apart.
      const { body, params } = request;
      const found = await store.find(model, getId(params));
      if (!found || !isOrmRecord(found)) return 404;
      // Checked BEFORE any attribute is applied. 404 rather than 403 for the
      // same reason as GET /:id -- 403 would disclose both that the record
      // exists and that this caller specifically is excluded.
      //
      // NOT redundant behind GATE 1, and not defence in depth either: GATE 1's
      // verdict is computed BEFORE the before-hook loop runs, and a before-hook
      // is a published extension point that can change the answer -- by
      // mutating the record, or against a predicate that closes over
      // per-request state. This is the only re-evaluation after that window.
      // Pinned by assertion 32; deleting it turns a 404 into an applied update.
      if (isDenied(filter, found)) return 404;
      const record = found;
      const { attributes, relationships: rels } = (body?.data || {}) as {
        attributes?: { [key: string]: unknown };
        relationships?: { [key: string]: { data?: { id?: string | number } } };
      };

      if (!attributes && !rels) return 400; // Bad request

      // Apply attribute updates 1 by 1 to utilize built-in transform logic, ignore id key
      if (attributes) {
        for (const [key, value] of Object.entries(attributes)) {
          if (!Object.hasOwn(record, key)) continue;
          if (key === 'id') continue;

          record[key] = value
        };
      }

      // Apply relationship updates via updateRecord to properly resolve references
      if (rels) {
        const relUpdates: { [key: string]: unknown } = {};
        for (const [key, value] of Object.entries(rels)) {
          // The same missing key filter as createHandler's, and as the
          // attribute loop directly above -- which already had it, while this
          // loop did not. A PATCH carrying
          // `relationships:{"id":{"data":{"id":9101}}}` reached `updateRecord`
          // and RE-KEYED the record: the object held under store key 9102 then
          // reported id 9101, so a visible record claimed a hidden record's
          // identity on every surface that reads `record.id` rather than the map
          // key. Gated by GATE 1 on the addressed record, so it is store
          // corruption rather than a filter bypass -- but it is the same one-line
          // omission two handlers apart. Pinned by assertion 40; INHERITED from
          // `dev`; abofs/stonyx-orm#204.
          if (key === 'id') continue;

          const relData = value?.data;
          if (relData && relData.id !== undefined) {
            relUpdates[key] = relData.id;
          }
        }
        if (Object.keys(relUpdates).length > 0) {
          updateRecord(record as never, relUpdates, { _skipAutoPersist: true });
        }
      }

      // No `fields` and no `baseUrl`, both unchanged: `updateHandler` has no
      // `fieldsMap` in scope, and adding `baseUrl` would put `links` on a
      // document that has never carried them -- an unrelated behaviour change.
      // #224 AC6's "emits `data: []` WITH links" is a statement about the READ
      // surfaces; on these two handlers a filtered relationship and a
      // genuinely-empty one are both a bare `{ data }`, which is what makes
      // them indistinguishable here too.
      return { data: record.toJSON?.({ linkage: createLinkageFilter(request) }) };
    };

    const deleteHandler: HandlerFn = async ({ params }, { filter }) => {
      // Coerced ONCE. `getId(params)` was evaluated twice here -- once to find
      // the record and once to remove it -- and a coercion evaluated repeatedly
      // is a coercion that can be edited in one place and not the other, which
      // is the defect `coerceId` exists to prevent.
      const recordId = getId(params);
      const record = await store.find(model, recordId) as OrmRecord | undefined;

      // BEHAVIOUR CHANGE (#190): a DELETE of a record that never existed
      // returned 204 before this change. It now returns 404, matching the
      // denied case below. This is deliberate and load-bearing -- if a denied
      // delete returned 404 while a missing one returned 204, the pair would be
      // a perfect existence oracle and the whole fix would be worthless.
      // Returning 204 for a denied delete was rejected instead: it falsely
      // reports success for a request that changed nothing.
      if (!record) return 404;
      // Re-evaluated after the before-hook loop, exactly as in updateHandler --
      // GATE 1 decided before the hooks ran. Pinned by assertion 33; deleting it
      // turns a 404 into a destroyed record.
      if (isDenied(filter, record)) return 404;

      // Removed by the id of the record actually fetched, not by re-deriving it
      // from the params a second time: the record the filter tested and the
      // record removed are then provably the same one.
      store.remove(model, record.id as string | number, { _skipAutoPersist: true });
      return 204;
    };

    // Wrap handlers with hooks
    const isView = Orm.instance?.isView?.(model);

    this.handlers = {
      get: {
        '/': this._withHooks('list', getCollectionHandler),
        '/:id': this._withHooks('get', getSingleHandler),
        ...this._generateRelationshipRoutes(model, pluralizedModel, modelRelationships)
      },
    };

    // Views are read-only -- no write endpoints
    if (!isView) {
      this.handlers.patch = {
        '/:id': this._withHooks('update', updateHandler)
      };
      this.handlers.post = {
        '/': this._withHooks('create', createHandler)
      };
      this.handlers.delete = {
        '/:id': this._withHooks('delete', deleteHandler)
      };
    }
  }

  // Wraps a handler with before/after hook execution.
  //
  // ===========================================================================
  // TWO AUTHORIZATION GATES, AND EVERY EXECUTOR SITS BEHIND ONE OF THEM (#190)
  //
  // The defect this function was fixed for is NOT "a delete persists past a
  // 404". It is that _withHooks has SEVERAL executors downstream of the
  // handler, and originally the handler's response gated none of them. Three
  // exist today:
  //
  //   1. sqlDb.persist          -- issues real SQL against the backing store
  //   2. the after-hook pipeline -- the PUBLISHED consumer extension point;
  //                                a cascade delete, a webhook, a search-index
  //                                purge. `context.recordId` and
  //                                `context.oldState` are populated for it.
  //   3. Orm.db.save()          -- a full serialize-and-write of the store
  //
  // Gating them one at a time is how this keeps regressing, so the rule is:
  // compute denial ONCE at each point where it becomes knowable, and keep every
  // executor downstream of a gate. If you add a fourth executor to this
  // function, it goes below GATE 2 or it is a security bug.
  //
  // GATE 1 (pre-handler) is required because before-hooks and `context.oldState`
  // run/are built BEFORE the handler can consult the filter. Without it a denied
  // DELETE still handed the hidden record's full contents to consumer code.
  // GATE 2 (post-handler) covers everything the handler's status can reach.
  // ===========================================================================
  private _withHooks(operation: string, handler: HandlerFn): HandlerFn {
    return async (request: OrmRequest$, state: { [key: string]: unknown }) => {
      // `|| {}` so this function behaves like the relationship routes below,
      // which declare `state` with a `= {}` default. It is unkillable through
      // the rest-server dispatcher, which always passes `getState(req)`; it is
      // listed as such in the guards-redundant-by-construction table rather
      // than left silently unkillable, and it defends the WHOLE function (the
      // context, the snapshot and the handler call all read `callState`) rather
      // than one destructure that the next line would throw past anyway.
      const callState = (state || {}) as { [key: string]: unknown };

      // ---------------------------------------------------------------------
      // THE AUTHORIZATION SNAPSHOT. Read ONCE, here, before any consumer code
      // can run.
      //
      // `callState` is the object `auth()` planted the filter in, and it is
      // also handed to every before-hook as `context.state` -- a published,
      // WRITABLE extension point. So `state.filter` is an INPUT to the
      // authorization decision, not only an output channel, and re-reading it
      // after the hook loop lets a consumer hook disarm the filter:
      //
      //   beforeHook('get', 'animal', ctx => { delete ctx.state.filter })
      //     -> GET /animals/21 turned 404 into 200
      //     -> GET /animals    turned 20 records into 22
      //
      // GATE 1 already used this snapshot, so writes held; the READ handlers
      // re-destructured `filter` from the live bag and did not. Everything
      // downstream now reads `filter` from here, and the handler is handed
      // `handlerState` below -- never `callState`.
      // ---------------------------------------------------------------------
      const { filter } = callState as { filter?: unknown };

      // Build context object for hooks
      const context: HookContext = {
        model: this.model,
        operation,
        request,
        params: request.params,
        body: request.body,
        query: request.query,
        // Deliberately the LIVE object: `redirect` and `pipe` are read back off
        // it by @stonyx/rest-server after the handler returns, so hooks must be
        // able to write to it. What must not happen is the authorization
        // decision reading it back, which is what the snapshot above prevents.
        state: callState,
      };

      // Capture old state for operations that modify data
      if (operation === 'update' || operation === 'delete') {
        const existingRecord = await store.find(this.model, getId(request.params)) as OrmRecord | undefined;

        // GATE 1 -- pre-handler. This record fetch already happened for
        // oldState, so the check is free.
        //
        // Returning here rather than letting updateHandler/deleteHandler
        // produce the same 404 is the point: everything between here and there
        // is an executor the caller is not authorized to reach.
        //   - context.oldState is a deep copy of the HIDDEN RECORD'S CONTENTS.
        //     Building it and handing it to a before-hook discloses exactly what
        //     the filter exists to hide.
        //   - context.recordId is populated for delete BEFORE the handler runs,
        //     which is the same shape as the sqlDb landmine one layer up:
        //     `afterHook('delete', ctx => cascadeDelete(ctx.recordId))` destroys
        //     children behind a correct 404.
        //   - a before-hook may return a value and short-circuit, which would
        //     otherwise return a response without the filter ever executing.
        //
        // 404, not 403, for the same reason as getSingleHandler: the status for
        // "exists but filtered out" must equal "does not exist".
        if (existingRecord && isDenied(filter, existingRecord)) return 404;

        if (existingRecord) {
          // Deep copy the record's data to preserve old state
          context.oldState = JSON.parse(JSON.stringify(existingRecord.__data || existingRecord));
        }
        if (operation === 'delete') {
          context.recordId = getId(request.params);
        }
      }

      // Run before hooks sequentially (can halt by returning a value)
      for (const hook of getBeforeHooks(operation, this.model)) {
        const result = await hook(context);
        if (result !== undefined) {
          // Hook returned a value - halt operation and return result
          return result;
        }
      }

      // Execute main handler
      // The handler receives the SNAPSHOT, never the live bag. `filter` is
      // assigned LAST so it wins over anything a before-hook wrote to
      // `callState.filter` -- including a `delete`, which the spread would
      // otherwise carry through as an absent key. Every other key a hook adds
      // is still visible to the handler; only the authorization input is
      // pinned.
      const handlerState = { ...callState, filter };
      const response = await handler(request, handlerState);

      // Set context.record for update BEFORE persist so SQL drivers can read it
      if (operation === 'update' && (response as JsonApiResponse)?.data) {
        context.record = store.get(this.model, getId(request.params));
      }

      // GATE 2 -- post-handler. A denied or failed handler returns a bare status
      // integer, and no executor below may run for one.
      //
      // `>= 400` deliberately covers every failure status, not just the
      // authorization ones: a 400 (POST with no `type`) and a 409 (duplicate id)
      // are equally requests in which nothing happened, and a persist or a
      // cascade hook for one of them is just as wrong.
      // `Number.isInteger` is a TYPE guard, not a behaviour guard, and it is
      // unkillable TODAY: the only non-integer a handler in this file can
      // return is a `{ data, links }` object, and `{} >= 400` is `false` by JS
      // coercion, so dropping it changes no reachable outcome. It is kept
      // because `>=` coerces rather than rejects, and the shapes it coerces
      // are not obvious -- `[500] >= 400` is TRUE, so a handler that one day
      // returned an array would have every response read as a denial. Listed
      // as an equivalent mutant rather than left to read as coverage; it
      // becomes killable the moment a handler returns anything array-like or
      // numeric-string-like.
      const denied = Number.isInteger(response) && (response as number) >= 400;

      // EXECUTOR 1 -- SQL persistence, for all write operations.
      //
      // `response` is passed to sqlDb.persist below, but it is dropped at the
      // driver boundary: _persistDelete(modelName, context) never receives it
      // and guards only on context.recordId -- which _withHooks set above,
      // BEFORE the handler ran. Without this gate a correct 404 still issues
      // DELETE FROM ... WHERE id = ? on every SQL backend.
      //
      // No file-backed test can observe that, because Orm.instance.sqlDb is
      // null in file/directory mode. See the stubbed-sqlDb assertions in
      // test/unit/access-filter-enforcement-test.ts.
      const sqlDb = Orm.instance.sqlDb;
      if (sqlDb && WRITE_OPERATIONS.has(operation) && !denied) {
        await sqlDb.persist(operation, this.model, context, response);
      }

      // Add response and relevant records to context
      context.response = response;

      if (operation === 'get' && (response as JsonApiResponse)?.data && !Array.isArray((response as JsonApiResponse).data)) {
        context.record = await store.find(this.model, getId(request.params));
      } else if (operation === 'list' && (response as JsonApiResponse)?.data) {
        context.records = await store.findAll(this.model);
      } else if (operation === 'create' && (response as JsonApiResponse)?.data && ((response as { data: { id?: unknown } }).data.id)) {
        // For create, get the record from store using the ID from the response
        const responseData = (response as { data: { id: string | number } }).data;
        // `normalizeBodyId`, not a copy of its body. This line WAS
        // `isNaN(id) ? id : parseInt(id)` -- `coerceId` inlined verbatim, a
        // third coercion feeding a store lookup, sitting under a docblock that
        // said neither surface had a copy. Equivalent on every input that can
        // reach this truthy-guarded branch (`21`->`21`, `'21'`->`21`,
        // `'angela'`->`'angela'`; `''` and `0` cannot reach it), so this is a
        // de-duplication rather than a behaviour change -- and that is the
        // point: the two that disagreed were equivalent on every input anyone
        // checked, too.
        context.record = store.get(this.model, normalizeBodyId(responseData.id) as string | number);
      } else if (operation === 'delete') {
        // For delete, the record may no longer exist, but we have oldState
        context.recordId = getId(request.params);
      }

      // EXECUTOR 2 -- the after-hook pipeline. This is the published consumer
      // extension point (`afterHook` is exported from @stonyx/orm and from
      // ./hooks), so it is the executor with the widest possible blast radius:
      // a cascade delete, a webhook, a token revocation, a search-index purge.
      //
      // BEHAVIOUR CHANGE (#190): after-hooks no longer fire for a request that
      // failed. Previously `afterHook('delete', ...)` ran with a populated
      // context.recordId on a 404, so a consumer cascade destroyed children for
      // a request that deleted nothing. Firing a hook named "after<operation>"
      // for an operation that did not occur is a booby trap, and the denied case
      // is unreachable-before-#190 while the missing case is inherited debt --
      // both are closed by the same gate. `context.response` therefore only ever
      // carries a success status into a hook.
      if (!denied) {
        for (const hook of getAfterHooks(operation, this.model)) {
          await hook(context);
        }
      }

      // EXECUTOR 3 -- file/directory autosave. Ungated this let an
      // unauthenticated caller force a full serialize-and-write of the entire
      // store on every DELETE of any id, with no record touched: amplification
      // rather than corruption, but the same root cause and the same fix.
      if (config.orm.db.autosave === 'onUpdate' && WRITE_OPERATIONS.has(operation) && !denied) {
        await (Orm.db as { save(): Promise<void> }).save();
      }

      return response;
    };
  }

  private _generateRelationshipRoutes(
    model: string,
    pluralizedModel: string,
    modelRelationships: { [key: string]: RelationshipInfo }
  ): { [key: string]: HandlerFn } {
    const routes: { [key: string]: HandlerFn } = {};

    for (const [relationshipName, info] of Object.entries(modelRelationships)) {
      // Dasherize the relationship name for URL paths (e.g., accessLinks -> access-links)
      const dasherizedName = camelCaseToKebabCase(relationshipName);

      // Related resource route: GET /:id/{relationship}
      //
      // These generated routes are not wrapped by _withHooks, which is why they
      // were the least obvious two of the seven unguarded surfaces in #190.
      // They are still dispatched by @stonyx/rest-server as
      // `handler(req, getState(req))`, so `state` -- and therefore the filter
      // planted by auth() -- has always been available here; it was simply
      // never declared or read.
      routes[`/:id/${dasherizedName}`] = async (request: OrmRequest$, { filter }: { [key: string]: unknown } = {}) => {
        const record = await store.find(model, getId(request.params)) as OrmRecord | undefined;
        if (!record) return 404;
        // Filtering the PARENT: a caller who may not see the record may not see
        // what it is related to either.
        if (isDenied(filter, record)) return 404;

        const relatedData = record.__relationships[relationshipName];
        const baseUrl = getBaseUrl(request);

        // ONE FILTER, TWO JOBS, AND abofs/stonyx-orm#232 IS THE SECOND ONE.
        //
        // As LINKAGE (#234) it decides which ids the emitted documents may NAME
        // in their own `relationships.*.data`. As MEMBERSHIP (this issue) it
        // decides whether the related record is served here AT ALL -- the
        // related resource is PRIMARY data on this route, so there is no
        // linkage-consistency question to answer separately.
        //
        // Until #232 this route filtered only the PARENT, so a record its own
        // model's predicate hides was served in full from another model's
        // route, at ZERO query parameters. Measured on dev @ 8dda5d6:
        //
        //     GET /owners/angela          -> 404
        //     GET /animals/1/owner        -> 200, owner:angela, full attributes
        //     GET /traits/2/tag           -> 200, a model NO access class
        //                                    claims, on a collection that has
        //                                    no mounted route at all
        //
        // ARGUMENT ONE IS THE LIVE REQUEST, NOT A DERIVED ONE. A fabricated
        // request addressing the RELATED resource was the original design and
        // it is dropped: #241 removed the shipped fixture's read of argument
        // one, so a fabricated value changes nothing it could observe.
        // `createLinkageFilter` is also a published public export
        // (src/index.ts) whose resolution granularity is per TYPE; supplying a
        // per-RECORD request would mean widening it, which takes a consumer
        // `access()` from ~2 calls to ~7 on a plain `GET /animals`. That is a
        // separate, consumer-visible story.
        //
        // GUARDED BY OWN-PROPERTY IDENTITY, NOT BY THE #234 AC13 PIN. That pin
        // (test/unit/linkage-verdict-test.ts, `strictEqual(seen[0].request,
        // READ_REQUEST)`) calls `createLinkageFilter` DIRECTLY, so it pins the
        // function's pass-through and constrains no call site -- an earlier
        // revision of this comment cited it for this decision and was wrong.
        // `Object.create(request)` here measured 1015 / 0 with nothing red.
        // test/integration/orm-test.ts, `#232 AC9`, now asserts that the object
        // the predicate is handed OWNS `params` (`Object.hasOwn`) and has
        // nothing request-shaped behind it on the prototype chain. A derived
        // request inherits `params` -- so it satisfies every value assertion
        // there -- and reds on those two. Measured: with the derived request in
        // place, 1014 / 1, and that one is this guard.
        //
        // THE RESIDUAL THAT FOLLOWS FROM THAT IS DISCLOSED, NOT PAPERED OVER.
        // `recordId` is `null` here and the request names a record of a
        // DIFFERENT model, so a consumer predicate can express a model-level or
        // a request-level deny for a related resource, but NOT a per-record
        // one. README.md and docs/usage-patterns.md say so; a ledger assertion
        // in test/unit/relationship-route-access-test.ts keeps them saying it.
        const linkage = createLinkageFilter(request);

        // FAIL CLOSED ON A RECORD WHOSE TYPE CANNOT BE NAMED. `isLinkable` is
        // keyed on the model name; without one there is no predicate to ask,
        // and an unidentifiable input must never be the permissive path.
        const isLinkable = (r: OrmRecord) => {
          const type = (r as { __model?: { __name?: string } }).__model?.__name;

          return typeof type === 'string' && type !== '' && linkage(type, r);
        };

        let data: unknown;
        if (info.isArray) {
          // hasMany - return array, MINUS the members this caller may not see.
          // Dropped, never errored: the result is byte-identical to a genuinely
          // empty relationship, so this route is not an existence oracle.
          const related = Array.isArray(relatedData) ? relatedData.filter(isOrmRecord) : [];
          data = related.filter(isLinkable).map(r => r.toJSON?.({ baseUrl, linkage }));
        } else {
          // belongsTo - return single or null. A DENIED target is `data: null`,
          // BYTE-IDENTICAL to a relationship that is genuinely empty, for the
          // same reason the hasMany branch above drops rather than errors: this
          // route must not be an existence oracle for the RELATED record.
          //
          // THE OTHER SPELLING WAS 404 AND IT WAS MEASURED AS A DISCLOSURE.
          // Unauthenticated, zero query parameters, one request each, on `tag`
          // -- the model with no route mounted at all, which is exactly what
          // #240 AC5 exists to protect:
          //
          //     GET /traits/1/tag  [ABSENT]  -> 200  application/json  len 68
          //     GET /traits/2/tag  [DENIED]  -> 404  text/plain        len  9
          //
          // and `GET /traits/1` and `GET /traits/2` both report
          // `relationships.tag = {"data":null}` byte-identical modulo the id,
          // because #234 closed THAT oracle deliberately. A 404 here would let
          // a caller ask which of those two nulls was a denial. Under
          // `data: null` the pair closes completely: 200/200, same
          // content-type, same content-length, bodies identical modulo the
          // parent id the caller put in the URL. It opens nothing -- `links`
          // are entirely parent-derived, there is no `meta` and no counts.
          //
          // This is also what README.md's module-wide rule already demanded:
          // every status on a record route must be identical for filtered-out
          // and does-not-exist. The route now CONFORMS to that rule rather than
          // carving an exception out of it.
          if (!isOrmRecord(relatedData)) data = null;
          else if (!isLinkable(relatedData)) data = null;
          else data = relatedData.toJSON?.({ baseUrl, linkage });
        }

        return {
          links: { self: `${baseUrl}/${pluralizedModel}/${request.params.id}/${dasherizedName}` },
          data
        };
      };

      // Relationship linkage route: GET /:id/relationships/{relationship}
      //
      // NO `linkage` FILTER FROM abofs/stonyx-orm#235, AND THAT IS A SCOPE
      // BOUNDARY RATHER THAN AN OVERSIGHT -- abofs/stonyx-orm#232 OWNS THIS
      // ROUTE, and PR #247 is IN FLIGHT against it in this same sprint. If you
      // are reading this after #247 landed, the filtering below is #232's and
      // this note records why it was never #235's to add.
      //
      // The three sites #235 does own -- `buildResponse`'s `included`, and the
      // two write handlers, `POST /:models` and `PATCH /:models/:id` -- all
      // reach the filter through `record.toJSON()`, which is where the
      // `linkage` OPTION is applied.
      //
      // The related-resource branch above ALSO passes a `linkage` filter, and
      // it is NOT one of those three: it is abofs/stonyx-orm#234's code and
      // predates this change. `git diff 8dda5d6..HEAD -- src/orm-request.ts`
      // leaves that branch byte-unchanged.
      //
      // This branch builds its `{ type, id }` objects BY
      // HAND and never calls `toJSON` at all, so the `linkage` option cannot
      // reach it -- whatever this route filters, it has to filter itself, which
      // is precisely why doing so is a separate change with a separate owner.
      //
      // It is also a DIFFERENT QUESTION. Everywhere #235 touches, linkage is
      // metadata ABOUT a document. Here the linkage IS the primary data, so
      // dropping an entry is a MEMBERSHIP decision about what this route
      // serves -- the same class as abofs/stonyx-orm#233 and #196, not the
      // class #234/#235 close. That is why it is absent from #224 §2a's
      // seven-site inventory.
      //
      // MEASURED, so the next person does not re-derive it. Against this
      // branch's baseline of 1011/0, wiring `createLinkageFilter` into the
      // belongsTo branch below takes the suite to 1009/2, reddening
      // `[GUARD] #235 X2` and the
      // `GET /animals/:id/relationships/owner returns relationship linkage`
      // test -- the latter is #232's own reproduction, not a regression.
      //
      // THE BASELINE IS QUOTED WITH THE RESULT BECAUSE AN EARLIER REVISION OF
      // THIS COMMENT SAID 993/2 AND SHIPPED IT. This file lands in consumers'
      // `node_modules`, so a wrong number here is a wrong number in the
      // published package. 993+2 = 995 is the DEV baseline, carried over from
      // a branch on which `[GUARD] #235 X2` does not exist. A pass/fail pair
      // with no baseline beside it cannot be checked by reading, which is how
      // it survived three artifacts and a review; the qualitative claim was
      // right the whole time and only the count was wrong.
      //
      // `[GUARD] #235 X2` in test/integration/orm-test.ts pins the OWNERSHIP
      // BOUNDARY here rather than this route's current answer, so that it
      // survives #247 landing. Read its comment before changing it.
      routes[`/:id/relationships/${dasherizedName}`] = async (request: OrmRequest$, { filter }: { [key: string]: unknown } = {}) => {
        const record = await store.find(model, getId(request.params)) as OrmRecord | undefined;
        if (!record) return 404;
        if (isDenied(filter, record)) return 404;

        const relatedData = record.__relationships[relationshipName];
        const baseUrl = getBaseUrl(request);

        // THE ONE READ SURFACE THAT DOES NOT GO THROUGH `toJSON()`. It builds
        // `{ type, id }` BY HAND, which is why #234's linkage filter never
        // reached it and why this half belongs to abofs/stonyx-orm#232 rather
        // than to #234: on this route the linkage IS the primary data of an
        // opt-in request, so filtering it changes the route's MEMBERSHIP
        // semantics, not the ids named inside somebody else's document.
        //
        // DELIBERATELY NOT STATED AS A COUNT. README.md's Consumer Contracts
        // section enumerates the surfaces on which the framework resolves a
        // verdict and hands it to `toJSON()`, and that enumeration GROWS --
        // abofs/stonyx-orm#235 adds the two write handlers and the `included`
        // records. This route is not on that list under any count, because it
        // never calls `toJSON()`: whatever it filters, it filters here. A
        // number written into this comment would be false the next time that
        // list changes, and the README already carries the enumeration.
        //
        // Same filter, same argument-one decision, same residual as
        // `/:id/{relationship}` above -- read the block there.
        const linkage = createLinkageFilter(request);
        const isLinkable = (r: OrmRecord) => {
          const type = (r as { __model?: { __name?: string } }).__model?.__name;

          return typeof type === 'string' && type !== '' && linkage(type, r);
        };

        let data: unknown;
        if (info.isArray) {
          // hasMany - return array of linkage objects
          const related = Array.isArray(relatedData) ? relatedData.filter(isOrmRecord) : [];
          data = related
            .filter((r): r is OrmRecord & { __model: { __name: string } } => Boolean(r.__model))
            .filter(isLinkable)
            .map(r => ({ type: r.__model.__name, id: r.id }));
        } else {
          // belongsTo - return single linkage or null. A DENIED target is
          // `data: null`, indistinguishable from a genuinely empty one -- see
          // the measured oracle in the `/:id/{relationship}` block above.
          if (isOrmRecord(relatedData) && relatedData.__model && isLinkable(relatedData)) {
            data = { type: relatedData.__model.__name, id: relatedData.id };
          } else {
            data = null;
          }
        }

        return {
          links: {
            self: `${baseUrl}/${pluralizedModel}/${request.params.id}/relationships/${dasherizedName}`,
            related: `${baseUrl}/${pluralizedModel}/${request.params.id}/${dasherizedName}`
          },
          data
        };
      };
    }

    // Catch-alls for invalid relationship names. Every valid relationship was
    // registered above, so reaching either of these means the relationship does
    // not exist and the answer is 404 regardless of the record.
    //
    // These deliberately carry NO access check and no store lookup. An earlier
    // revision of #190 added `if (isDenied(filter, record)) return 404` here for
    // symmetry with the seven real surfaces, but both branches returned 404, so
    // the guard was unobservable by construction -- a mutation deleting it
    // survived the entire suite because no test that could distinguish it can
    // exist. Unkillable code in an authorization diff reads as coverage and is
    // not, so it is gone; skipping the lookup also removes the timing difference
    // between an existing and a missing parent.
    //
    // IF THIS ROUTE EVER RETURNS ANYTHING OTHER THAN A CONSTANT 404, it becomes
    // the eighth surface and must filter the parent first, exactly like
    // `/:id/{relationship}` above.
    routes[`/:id/:relationship`] = async () => 404;
    routes[`/:id/relationships/:relationship`] = async () => 404;

    return routes;
  }

  auth(request: OrmRequest$, state: { [key: string]: unknown }): number | undefined {
    // A consumer `access()` that throws is a DENIAL, matching `isDenied` one
    // layer down. Unguarded it propagates to express's default handler, which
    // answers 500 -- and the documented sample itself can throw
    // (`request.originalUrl.split(...)` when originalUrl is absent), so the
    // failure mode is reachable by following the docs.
    // -------------------------------------------------------------------------
    // #202 -- hand the consumer the STRUCTURAL facts, not just the transport.
    //
    // Both members are already in hand here. `model` is `this.model`, the name
    // setup-rest-server mounted this route for; `operation` is the SAME
    // `methodAccessMap` lookup the permission-array branch at the bottom of
    // this method performs, so the predicate form and the array form cannot
    // answer differently about the same request.
    //
    // NEITHER IS DERIVED FROM THE REQUEST TARGET, and that is the whole point.
    // Deriving `model` here from `request.baseUrl` (or from the mounted route
    // name, or from `getPluralName(this.model)`) would move all five fail-open
    // variants listed in this file's header OUT of the consumer and INTO the
    // framework, where every consumer inherits them at once. `this.model` is
    // assigned once at mount time and no request can influence it.
    //
    // `operation` is left UNDEFINED for a method with no entry in
    // `methodAccessMap`, rather than defaulted. Express delivers HEAD to the
    // GET handler, so an unmapped method really does reach this line; a
    // `?? 'read'` here would hand the consumer a fabricated authorisation fact
    // and turn an unclassified request into an authorised one. Undefined is
    // the honest answer.
    //
    // `record` is deliberately absent -- see `AccessContext` in
    // src/types/orm-types.ts. Nothing is fetched at this point and adding a
    // lookup here would put a store read in the middle of an authorization
    // path. The function return shape below IS the per-record hook.
    //
    // -------------------------------------------------------------------------
    // #236 -- `recordId`, the DECODED route-parameter id, for the same reason.
    //
    // WHICH RECORD is the third structural fact the framework already holds and
    // the consumer was left to re-derive, and re-deriving it failed OPEN. The
    // documented sample compared `request.path` -- the RAW, undecoded pathname
    // -- against a literal `/archived`, while the router DECODES `:id`. So
    // `GET /owners/%61rchived` walked past the deny and was dispatched as the
    // record `archived`: 200 with the record in full, and DELETE answered 204
    // with the record destroyed, unauthenticated. Four spellings measured, all
    // four through; 255 non-canonical spellings of that 8-character id decode
    // to the same key, so this was never a deny-list of one.
    //
    // TWO CONSUMER-SIDE NORMALISATIONS WERE MEASURED WRONG IN OPPOSITE
    // DIRECTIONS, which is the argument for doing it once, here.
    // `.toLowerCase()` case-folds a route-parameter VALUE on the axis that
    // governs literal SEGMENTS: with a distinct owner seeded at `ARCHIVED`,
    // `GET /owners/ARCHIVED` was a false DENY on the wrong record and
    // `GET /owners/%41RCHIVED` a false ALLOW on that same one.
    // `decodeURIComponent(request.path)` decodes THEN splits while the router
    // splits THEN decodes, so it over-denied `/owners/archived%2fx` -- 403 for
    // a genuinely distinct record. Failing closed there was luck, not design.
    //
    // `getId(request.params)` AND NOT `request.params.id`, for exactly the
    // reason `operation` is a `methodAccessMap` lookup: it is the SAME single
    // coercion the store lookup one layer down performs, so the predicate and
    // the dispatch cannot disagree about which record a request addresses.
    // The raw string would reintroduce that divergence on hex-shaped ids --
    // `GET /animals/0x2391` looks up record `9105`.
    //
    // NOTHING HERE PARSES THE REQUEST TARGET EITHER. `request.params` is what
    // the router matched, so a mount prefix, an absolute-form target, a query
    // string or a case-varied mount cannot move this value -- the same
    // guarantee `model` carries, by the same means.
    //
    // `null` and not `undefined` on a collection route, so the KEY IS ALWAYS
    // PRESENT -- the rule `operation`'s own docblock already establishes. A
    // context reaching a predicate WITHOUT the key therefore did not come from
    // here; it was hand-assembled by a caller resolving the predicate through
    // `Orm.instance.getAccess()`, and that absence stays deniable only because
    // `auth()` never produces it.
    // -------------------------------------------------------------------------
    const context: AccessContext = {
      model: this.model,
      operation: methodAccessMap[request.method],
      recordId: request.params && 'id' in request.params ? getId(request.params) : null,
    };

    let access: AccessMethod;
    try {
      access = this.access(request, context);
    } catch (error) {
      // Same reasoning as `isDenied`: fail closed, but say so. An `access()`
      // that throws denies EVERY request to the collection, and a silent 403
      // wall is the hardest possible thing to diagnose from the outside.
      log.error?.(`[@stonyx/orm] access() threw for model "${this.model}" -- denying. ${error instanceof Error ? error.message : String(error)}`);

      return 403; // Forbidden
    }

    // THE READING OF THE RETURN SHAPE LIVES IN ONE PLACE (#234).
    //
    // It used to be inline here, and it was the only copy, which was fine while
    // `auth()` was the only thing that had to ask. It is not any more: the
    // linkage path has to ask model X's predicate about model X's records while
    // servicing a request routed to model Y, and a second inline copy of these
    // six branches would be a second authorization vocabulary -- one that can
    // drift, and that reviewers would have to notice had drifted. The branch
    // order in `interpretAccess` is this block, moved, not rewritten.
    const verdict = interpretAccess(access, methodAccessMap[request.method]);

    if (!verdict.granted) return 403;

    // The function return shape is the per-record hook, and `state` is the
    // whole transport for it: @stonyx/rest-server memoises one state object per
    // request and hands the same one to `auth()` and to the handler.
    if (verdict.filter) state.filter = verdict.filter;

    return undefined;
  }
}
