import { Request } from '@stonyx/rest-server';
import Orm, { store, createRecord, updateRecord } from '@stonyx/orm';
import { camelCaseToKebabCase } from '@stonyx/utils/string';
import { getPluralName } from './plural-registry.js';
import { getBeforeHooks, getAfterHooks } from './hooks.js';
import type { HookContext } from './hooks.js';
import config from 'stonyx/config';
import type { OrmRecord } from './types/orm-types.js';
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

type AccessMethod = string | boolean | string[] | ((record: unknown) => boolean);
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

function getId(params: { id?: string; [key: string]: unknown }): string | number {
  const id = params.id;
  if (!id) return '';
  if (isNaN(id as unknown as number)) return id;

  return parseInt(id);
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

  return !(filter as (record: unknown) => boolean)(record);
}

export default class OrmRequest extends Request {
  model: string;
  access: (request: unknown) => AccessMethod;
  handlers: { [key: string]: { [key: string]: HandlerFn } };

  constructor({ model, access }: { model: string; access: (request: unknown) => AccessMethod }) {
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

      // Check for duplicate ID
      if (id !== undefined && await store.find(model, id)) return 409; // Conflict

      const { id: _ignoredId, ...sanitizedAttributes } = attributes || {};

      // Extract relationship IDs from JSON:API relationships object
      if (rels) {
        for (const [key, value] of Object.entries(rels)) {
          const relData = value?.data;
          if (relData && relData.id !== undefined) {
            (sanitizedAttributes as { [key: string]: unknown })[key] = relData.id;
          }
        }
      }

      const recordAttributes = id !== undefined ? { id, ...sanitizedAttributes } : sanitizedAttributes;
      const created = createRecord(model, recordAttributes as { [key: string]: unknown }, { serialize: false, _skipAutoPersist: true });
      const record = isOrmRecord(created) ? created : null;
      if (!record) return 500;

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
        store.remove(model, record.id as string | number, { _skipAutoPersist: true });
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
      const record = await store.find(model, getId(params));

      // BEHAVIOUR CHANGE (#190): a DELETE of a record that never existed
      // returned 204 before this change. It now returns 404, matching the
      // denied case below. This is deliberate and load-bearing -- if a denied
      // delete returned 404 while a missing one returned 204, the pair would be
      // a perfect existence oracle and the whole fix would be worthless.
      // Returning 204 for a denied delete was rejected instead: it falsely
      // reports success for a request that changed nothing.
      if (!record) return 404;
      if (isDenied(filter, record)) return 404;

      store.remove(model, getId(params), { _skipAutoPersist: true });
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

  // Wraps a handler with before/after hook execution
  private _withHooks(operation: string, handler: HandlerFn): HandlerFn {
    return async (request: OrmRequest$, state: { [key: string]: unknown }) => {
      // Build context object for hooks
      const context: HookContext = {
        model: this.model,
        operation,
        request,
        params: request.params,
        body: request.body,
        query: request.query,
        state,
      };

      // Capture old state for operations that modify data
      if (operation === 'update' || operation === 'delete') {
        const existingRecord = await store.find(this.model, getId(request.params)) as OrmRecord | undefined;
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
      const response = await handler(request, state);

      // Set context.record for update BEFORE persist so SQL drivers can read it
      if (operation === 'update' && (response as JsonApiResponse)?.data) {
        context.record = store.get(this.model, getId(request.params));
      }

      // Persist to SQL database for all write operations (create/update/delete)
      //
      // A denied or failed handler returns a bare status integer and MUST NOT
      // reach persist. `response` is passed to sqlDb.persist below, but it is
      // dropped at the driver boundary: _persistDelete(modelName, context) never
      // receives it and guards only on context.recordId -- which _withHooks set
      // above, BEFORE the handler ran. Without this gate a correct 404 still
      // issues DELETE FROM ... WHERE id = ? on every SQL backend.
      //
      // No file-backed test can observe that, because Orm.instance.sqlDb is
      // null in file/directory mode. See the stubbed-sqlDb assertions in
      // test/unit/access-filter-enforcement-test.ts.
      const denied = Number.isInteger(response) && (response as number) >= 400;
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
        const recordId = isNaN(responseData.id as unknown as number) ? responseData.id : parseInt(responseData.id as string);
        context.record = store.get(this.model, recordId);
      } else if (operation === 'delete') {
        // For delete, the record may no longer exist, but we have oldState
        context.recordId = getId(request.params);
      }

      // Run after hooks sequentially
      for (const hook of getAfterHooks(operation, this.model)) {
        await hook(context);
      }

      // Auto-save DB after write operations when configured
      if (config.orm.db.autosave === 'onUpdate' && WRITE_OPERATIONS.has(operation)) {
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

    // Catch-all for invalid relationship names on related resource route
    routes[`/:id/:relationship`] = async (request: OrmRequest$, { filter }: { [key: string]: unknown } = {}) => {
      const record = await store.find(model, getId(request.params));
      if (!record) return 404;
      if (isDenied(filter, record)) return 404;

      // If we reach here, relationship doesn't exist (valid ones were registered above)
      return 404;
    };

    // Catch-all for invalid relationship names on relationship linkage route
    routes[`/:id/relationships/:relationship`] = async (request: OrmRequest$, { filter }: { [key: string]: unknown } = {}) => {
      const record = await store.find(model, getId(request.params));
      if (!record) return 404;
      if (isDenied(filter, record)) return 404;

      return 404;
    };

    return routes;
  }

  auth(request: OrmRequest$, state: { [key: string]: unknown }): number | undefined {
    const access = this.access(request);

    if (!access) return 403;
    if (Array.isArray(access) && !access.includes(methodAccessMap[request.method])) return 403;
    if (typeof access === 'function') state.filter = access;
    return undefined;
  }
}
