/**
 * REST request handling and access enforcement for @stonyx/orm.
 *
 * ---------------------------------------------------------------------------
 * DO NOT RECONSTRUCT THE REQUEST PATH INSIDE `access()`.
 * ---------------------------------------------------------------------------
 * `auth()` below hands your `access(request)` a raw transport artifact and asks
 * you to work out which collection it addresses. Every attempt to do that by
 * parsing the request target has failed OPEN. Five distinct variants of the
 * same three-line example have now been found, each after the previous was
 * fixed, by five different people:
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
 * The fix is not a sixth rule. It is to stop parsing:
 *
 *   `request.baseUrl` is the mount Express ACTUALLY MATCHED when it dispatched
 *   the request. It carries no query string, it is not mount-relative, it is
 *   unaffected by absolute-form, and it already includes the configured
 *   `ORM_REST_ROUTE` prefix -- so there is nothing to derive and nothing to
 *   join. Compare it lower-cased (the router matched case-insensitively) and
 *   fail CLOSED when it is absent. Use `request.path` -- mount-relative and
 *   query-free -- if you need to distinguish sub-paths.
 *
 * `?? ''` is not a defence. It converts an absent request target into an empty
 * string, which matches no collection, which falls through to the permission
 * array -- a total grant. An input you cannot identify must DENY.
 *
 * THAT IS STILL A STOPGAP. `baseUrl` closes all five variants, but it is a
 * transport artifact being asked to stand in for a structural fact.
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
import type { OrmRecord, AccessContext, AccessFunction, AccessMethod } from './types/orm-types.js';
import { isOrmRecord } from './utils.js';

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

const methodAccessMap: { [key: string]: string } = {
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
  options: { links?: { [key: string]: string }; baseUrl?: string } = {}
): JsonApiResponse {
  const { links, baseUrl } = options;
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
    response.included = includedRecords.map(record => record.toJSON?.({ baseUrl }));
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
      const data = recordsToReturn.map(record => record.toJSON?.({ fields: modelFields, baseUrl }));

      return buildResponse(data, request.query?.include, recordsToReturn, {
        links: { self: `${baseUrl}/${pluralizedModel}` },
        baseUrl
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
      return buildResponse(record.toJSON?.({ fields: modelFields, baseUrl }), request.query?.include, record, {
        links: { self: `${baseUrl}/${pluralizedModel}/${request.params.id}` },
        baseUrl
      });
    };

    const createHandler: HandlerFn = async ({ body, query }, { filter }) => {
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

      const created = createRecord(model, recordAttributes as { [key: string]: unknown }, { serialize: false, _skipAutoPersist: true });
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
        //                     than overwrote. Guards `assignRecordId` picking an
        //                     id that is already taken (it returns
        //                     last-INSERTED + 1, not max + 1, so a store whose
        //                     insertion order is not ascending collides) -- see
        //                     abofs/stonyx-orm#203.
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

      return { data: record.toJSON?.({ fields: modelFields }) };
    };

    const updateHandler: HandlerFn = async ({ body, params }, { filter }) => {
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

      return { data: record.toJSON?.() };
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

        let data: unknown;
        if (info.isArray) {
          // hasMany - return array
          const related = Array.isArray(relatedData) ? relatedData.filter(isOrmRecord) : [];
          data = related.map(r => r.toJSON?.({ baseUrl }));
        } else {
          // belongsTo - return single or null
          data = isOrmRecord(relatedData) ? relatedData.toJSON?.({ baseUrl }) : null;
        }

        return {
          links: { self: `${baseUrl}/${pluralizedModel}/${request.params.id}/${dasherizedName}` },
          data
        };
      };

      // Relationship linkage route: GET /:id/relationships/{relationship}
      routes[`/:id/relationships/${dasherizedName}`] = async (request: OrmRequest$, { filter }: { [key: string]: unknown } = {}) => {
        const record = await store.find(model, getId(request.params)) as OrmRecord | undefined;
        if (!record) return 404;
        if (isDenied(filter, record)) return 404;

        const relatedData = record.__relationships[relationshipName];
        const baseUrl = getBaseUrl(request);

        let data: unknown;
        if (info.isArray) {
          // hasMany - return array of linkage objects
          const related = Array.isArray(relatedData) ? relatedData.filter(isOrmRecord) : [];
          data = related
            .filter((r): r is OrmRecord & { __model: { __name: string } } => Boolean(r.__model))
            .map(r => ({ type: r.__model.__name, id: r.id }));
        } else {
          // belongsTo - return single linkage or null
          if (isOrmRecord(relatedData) && relatedData.__model) {
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
    // -------------------------------------------------------------------------
    const context: AccessContext = {
      model: this.model,
      operation: methodAccessMap[request.method],
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

    if (!access) return 403;
    if (typeof access === 'function') {
      state.filter = access;
      return undefined;
    }
    if (access === true) return undefined;

    // `AccessMethod` declares `string` legal and it fell through every branch
    // above, returning undefined -- i.e. FULL CRUD, no filter. `return 'read'`
    // is the natural reading of a type that lists `string` first, and it
    // granted DELETE. A bare string is one permission, not a grant of all four.
    const permitted = typeof access === 'string' ? [access] : access;

    // Anything that is not a permission array by this point -- an object, a
    // number, a Symbol -- is a consumer mistake, and the only safe reading of a
    // shape the contract does not define is a denial. Fail CLOSED.
    if (!Array.isArray(permitted)) return 403;
    if (!permitted.includes(methodAccessMap[request.method])) return 403;

    return undefined;
  }
}
