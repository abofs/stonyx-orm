import type { AggregateProperty } from '../aggregates.js';

export interface OrmDbConfig {
  file: string;
  schema: string;
  mode: string;
  directory: string;
  autosave: string;
  saveInterval: string | number;
}

export interface OrmMysqlConfig {
  host: string;
  port?: number;
  user: string;
  password: string;
  database: string;
  connectionLimit?: number;
  migrationsDir?: string;
  migrationsTable?: string;
  autoMigrate?: boolean;
  [key: string]: unknown;
}

export interface OrmPostgresConfig {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
  connectionLimit?: number;
  migrationsDir?: string;
  migrationsTable?: string;
  autoMigrate?: boolean;
  [key: string]: unknown;
}

export interface OrmPaths {
  model: string;
  serializer: string;
  transform: string;
  view?: string;
  access?: string;
  [key: string]: string | undefined;
}

export interface OrmRestServerConfig {
  enabled: string;
  route: string;
  metaRoute: boolean;
}

export interface OrmDynamoDBConfig {
  region?: string;
  endpoint?: string;
  tablePrefix?: string;
  [key: string]: unknown;
}

export interface OrmSection {
  db: OrmDbConfig;
  paths: OrmPaths;
  restServer: OrmRestServerConfig;
  mysql?: OrmMysqlConfig;
  postgres?: OrmPostgresConfig;
  timescale?: OrmPostgresConfig;
  dynamodb?: OrmDynamoDBConfig;
  logColor?: string;
  logMethod?: string;
  [key: string]: unknown;
}

export interface OrmConfig {
  rootPath: string;
  orm: OrmSection;
  [key: string]: unknown;
}

export interface SourceRecord {
  __model: { __name: string; [key: string]: unknown };
  __data?: Record<string, unknown>;
  __relationships?: Record<string, unknown>;
  id: string | number;
  [key: string]: unknown;
}

export interface OrmRecord {
  id: string | number;
  __model?: { __name: string };
  __data: Record<string, unknown> & { id?: string | number; __pendingSqlId?: boolean };
  __relationships: Record<string, unknown>;
  toJSON?(options?: { fields?: Set<string>; baseUrl?: string }): Record<string, unknown>;
  [key: string]: unknown;
}

export interface ForeignKeyDef {
  references: string;
  column: string;
}

export interface HypertableConfig {
  timeColumn: string;
  chunkInterval?: string;
  compress?: {
    segmentBy?: string;
    orderBy?: string;
    after?: string;
  };
}

export interface ModelSchema {
  table: string;
  idType: string;
  columns: Record<string, string>;
  foreignKeys: Record<string, ForeignKeyDef>;
  relationships: {
    belongsTo: Record<string, string | null>;
    hasMany: Record<string, string | null>;
  };
  vectorColumns?: Record<string, number>;
  hypertable?: HypertableConfig;
  memory: boolean;
}

export interface ViewSchema {
  viewName: string;
  source: string;
  groupBy?: string;
  columns: Record<string, string>;
  foreignKeys: Record<string, ForeignKeyDef>;
  aggregates: Record<string, AggregateProperty>;
  relationships: {
    belongsTo: Record<string, string | null>;
    hasMany: Record<string, string | null>;
  };
  isView: boolean;
  memory: boolean;
}

/**
 * Typed relationship registry maps.
 * Each key in Orm.relationships stores a different nested Map structure.
 */
/** Relationship registry map types — source → target → recordId → value */
export type HasManyMap = Map<string, Map<string, Map<unknown, unknown[]>>>;
export type BelongsToMap = Map<string, Map<string, Map<unknown, unknown>>>;
export type GlobalMap = Map<string, unknown[][]>;
export type PendingMap = Map<string, Map<unknown, unknown[][]>>;
export type PendingBelongsToMap = Map<string, Map<unknown, unknown[]>>;

export interface RelationshipMaps {
  hasMany: HasManyMap;
  belongsTo: BelongsToMap;
  global: GlobalMap;
  pending: PendingMap;
  pendingBelongsTo: PendingBelongsToMap;
}

export interface SnapshotEntry {
  table?: string;
  idType?: string;
  columns?: Record<string, string>;
  foreignKeys?: Record<string, ForeignKeyDef>;
  vectorColumns?: Record<string, number>;
  hypertable?: HypertableConfig;
  isView?: boolean;
  viewName?: string;
  source?: string;
  viewQuery?: string;
}

/**
 * The shapes a consumer `access()` predicate may return.
 *
 * - `false` (or any falsy value) -- deny, 403.
 * - `true` -- allow, with no per-record filter.
 * - a permission string or array of them, drawn from the same four verbs as
 *   {@link AccessContext.operation}. A BARE STRING IS ONE PERMISSION, not a
 *   grant of all four.
 * - a `(record) => boolean` predicate -- allow, and filter every record the
 *   request touches through it.
 *
 * Anything else fails CLOSED. See `src/orm-request.ts` `auth()`.
 */
export type AccessMethod = string | boolean | string[] | ((record: unknown) => boolean);

/**
 * The closed vocabulary `AccessContext.operation` is drawn from
 * (abofs/stonyx-orm#202).
 *
 * A literal union rather than `string`, so the guarantee the prose makes is the
 * one the compiler enforces: a consumer who writes `operation === 'GET'` or
 * `operation === 'get'` -- the hook vocabulary, see below -- gets a compile
 * error instead of a comparison that never matches. A predicate that stops
 * matching falls through to the permission array, so the misreading is
 * fail-open shaped.
 *
 * In-repo precedent: `PersistErrorDetail.operation` in `src/main.ts`.
 */
export type AccessOperation = 'read' | 'create' | 'update' | 'delete';

/**
 * The structural facts about the request being authorised, handed to a consumer
 * `access()` predicate as its SECOND argument (abofs/stonyx-orm#202).
 *
 * These are the facts the framework already holds at authorisation time. Before
 * #202 a consumer had to reconstruct both of them by string-matching a URL, and
 * five independent fail-open variants of that reconstruction were found in one
 * three-line documented example -- each one wrong in the direction that GRANTS
 * access. Read these instead; there is nothing to parse and no variant to miss.
 *
 * `record` is deliberately NOT a member. `auth()` runs after route matching but
 * before any handler executes (`@stonyx/rest-server` `src/request.ts:58-60`),
 * so nothing has been fetched yet -- carrying a record here would force a
 * pre-fetch on every request. It is also unnecessary: the `(record) => boolean`
 * return shape of {@link AccessMethod} already IS the per-record hook, applied
 * by the handlers. Auth-time and record-time are separate decision points.
 */
export interface AccessContext {
  /**
   * The model this route was mounted for, e.g. `'owner'` or `'phone-number'`.
   *
   * Model names are kebab-case, as declared under `config.orm.paths.model` and
   * keyed in the store -- NOT the pluralised, mount-prefixed route name. It is
   * read from the `OrmRequest` instance and is never derived from the request
   * target, so a mount prefix, a case-varied path, a query string or an
   * absolute-form request-target cannot change it.
   */
  model: string;

  /**
   * The operation being authorised. Exactly one of the four {@link
   * AccessOperation} verbs, or `undefined`. These are exactly the values of
   * `methodAccessMap` in `src/orm-request.ts`, which is also what the
   * permission-array return shape is matched against -- so the two forms cannot
   * disagree.
   *
   * NOT the hook vocabulary. `HookContext.operation` (`src/hooks.ts`) carries
   * `'list' | 'get' | 'create' | 'update' | 'delete'` on an identically-named
   * key of an identically-shaped context object, and the access vocabulary
   * collapses `list` and `get` into `'read'`. For one `GET /animals/1` a hook
   * sees `'get'` and `access()` sees `'read'`. "No second vocabulary" is a
   * statement about the ACCESS path only.
   *
   * `undefined` when the dispatched method has no entry in that map. Express
   * delivers `HEAD` to the `GET` handler, so this is reachable. It is left
   * undefined rather than defaulted on purpose: a fabricated `'read'` would
   * turn an unclassified request into an authorised one.
   *
   * The KEY is required even though the value may be undefined: `auth()` always
   * sets it, and a context that simply omitted it would be indistinguishable
   * from one that classified the request and found nothing.
   */
  operation: AccessOperation | undefined;

  /**
   * The record this route was addressed to, as the store key -- or `null` on a
   * collection route, which is addressed to no record (abofs/stonyx-orm#236).
   *
   * IT IS ALREADY DECODED, AND THAT IS THE WHOLE POINT. Express decodes route
   * PARAMETERS while leaving `request.path` raw, so a consumer comparing
   * `request.path` against a literal compares an undecoded string against a
   * decoded dispatch. `GET /owners/%61rchived` reached such a comparison as
   * `/%61rchived`, walked past a `/archived` deny, and was dispatched as the
   * record `archived` -- 200 with the record in full, and `DELETE` destroyed
   * it, unauthenticated. 255 non-canonical spellings of an 8-character id
   * decode to the same key, so a deny-list of spellings is the wrong shape.
   *
   * SO DO NOT NORMALISE THIS, AND DO NOT NORMALISE ANYTHING ELSE INSTEAD:
   *
   * - Do NOT decode it. Express decodes exactly ONCE, which is what a route
   *   parameter means. `GET /owners/%2561rchived` is the legitimate id
   *   `%61rchived`, not a second-order spelling of `archived`; a predicate that
   *   decoded until stable would deny a record it was never asked about.
   * - Do NOT case-fold it. A record id is a VALUE, not a literal route segment,
   *   and express's `case sensitive routing` governs literal segments only.
   *   With a distinct owner seeded at `ARCHIVED`, `.toLowerCase()` was measured
   *   wrong in BOTH directions at once: `GET /owners/ARCHIVED` 403 (a false
   *   deny, on the wrong record) and `GET /owners/%41RCHIVED` 200 (a false
   *   allow, on that same record).
   * - Do NOT derive it from `request.path` or the request target. Decoding the
   *   whole path decodes THEN splits, while the router splits THEN decodes, so
   *   `/owners/archived%2fx` -- a genuinely distinct record whose id is
   *   `archived/x` -- was measured over-denied 403.
   *
   * IT IS `getId(request.params)`, BYTE FOR BYTE -- the same single coercion
   * the store lookup uses, exactly as `operation` is the same `methodAccessMap`
   * lookup the permission-array branch uses. The predicate and the dispatch
   * therefore cannot disagree about which record a request addresses. Handing
   * over the raw `request.params.id` instead would reintroduce that divergence
   * on hex-shaped ids: `GET /animals/0x2391` looks up record `9105`.
   *
   * It inherits abofs/stonyx-orm#209 along with that coercion -- on a model
   * declaring `id = attr('string')`, `'9107'` arrives here as the number
   * `9107`. That is consistency WITH THE LOOKUP, which is the property this key
   * exists to buy; it is not a defect to repair here.
   *
   * `null`, not `undefined`, on a collection route -- and the KEY IS ALWAYS
   * PRESENT, the same rule `operation` states above. `auth()` always sets it,
   * so a context arriving WITHOUT the key did not come from `auth()`: it was
   * hand-assembled by a caller resolving the predicate through
   * `Orm.instance.getAccess()`. That absence stays a distinguishable, deniable
   * signal only because the framework never produces it.
   *
   * IT IS THE ONE KEY THE HOOK VOCABULARY DOES *NOT* DISAGREE WITH.
   * `HookContext.recordId` (`src/hooks.ts`) is an identically-named key on an
   * identically-shaped context object, which is the exact configuration that
   * makes `operation` fail-open shaped -- a hook sees `'get'` where `access()`
   * sees `'read'`. Here they AGREE, and not by coincidence: `_withHooks` sets
   * `context.recordId = getId(request.params)`, the same single coercion this
   * key is built from. They differ in ONE way and it is the absence spelling --
   * `HookContext.recordId` is optional and `undefined` when unset, while this
   * key is always present and `null` on a collection route. A predicate must
   * not read `undefined` here as "collection".
   *
   * IT NAMES WHICH RECORD, NOT WHICH SURFACE. `GET /owners/gina`,
   * `GET /owners/gina/pets` and `GET /owners/gina/relationships/pets` all
   * carry `recordId: 'gina'`; the related-resource gap is abofs/stonyx-orm#196
   * and is untouched by this key.
   */
  recordId: string | number | null;
}

/**
 * A consumer `access()` predicate.
 *
 * The second argument is ADDITIVE: JavaScript ignores extra arguments, so every
 * pre-#202 single-argument predicate keeps working untouched. Changing the
 * FIRST argument instead would have been the breaking form, and a predicate
 * that can no longer identify its collection falls through to a full CRUD
 * grant -- so the "safer" breaking change would have converted every unmigrated
 * predicate into a fail-open.
 *
 * `context` is nonetheless REQUIRED in the type, and that costs back-compat
 * nothing. TypeScript already lets a fewer-parameter implementation satisfy a
 * more-parameter signature, so an arity-1 predicate assigns to this type
 * cleanly -- measured under `--strict`. What the `?` bought was the opposite of
 * safety: it silently permitted `getAccess('animal')?.(request)` at the CALL
 * site, i.e. exactly the omission {@link AccessContext} exists to prevent, and
 * that call gets the model-wrong answer. Required, a caller that drops the
 * context gets `TS2554: Expected 2 arguments, but got 1`.
 */
export type AccessFunction = (request: unknown, context: AccessContext) => AccessMethod;
