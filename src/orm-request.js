import { Request } from '@stonyx/rest-server';
import Orm, { createRecord, store } from '@stonyx/orm';
import { pluralize } from '@stonyx/utils/string';

const methodAccessMap = {
  GET: 'read',
  POST: 'create',
  DELETE: 'delete',
  PATCH: 'update',
};

// Helper to detect relationship type from function
function getRelationshipInfo(property) {
  if (typeof property !== 'function') return null;
  const fnStr = property.toString();
  if (fnStr.includes(`getRelationships('belongsTo',`)) {
    return { type: 'belongsTo', isArray: false };
  }
  if (fnStr.includes(`getRelationships('hasMany',`)) {
    return { type: 'hasMany', isArray: true };
  }
  return null;
}

// Helper to introspect model relationships
function getModelRelationships(modelName) {
  const { modelClass } = Orm.instance.getRecordClasses(modelName);
  if (!modelClass) return {};

  const model = new modelClass(modelName);
  const relationships = {};

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
function getBaseUrl(request) {
  const protocol = request.protocol || 'http';
  const host = request.get('host');
  return `${protocol}://${host}`;
}

function getId({ id }) {
  if (isNaN(id)) return id;

  return parseInt(id);
}

function buildResponse(data, includeParam, recordOrRecords, options = {}) {
  const { links, baseUrl } = options;
  const response = { data };

  // Add top-level links
  if (links) {
    response.links = links;
  }

  if (!includeParam) return response;

  const includes = parseInclude(includeParam);
  if (includes.length === 0) return response;

  const includedRecords = collectIncludedRecords(recordOrRecords, includes);
  if (includedRecords.length > 0) {
    response.included = includedRecords.map(record => record.toJSON({ baseUrl }));
  }

  return response;
}

/**
 * Recursively traverse an include path and collect related records
 * @param {Array<Record>} currentRecords - Records to process at current depth
 * @param {Array<string>} includePath - Full path array (e.g., ['owner', 'pets', 'traits'])
 * @param {number} depth - Current depth in the path
 * @param {Map} seen - Deduplication map
 * @param {Array} included - Accumulator for included records
 */
function traverseIncludePath(currentRecords, includePath, depth, seen, included) {
  if (depth >= includePath.length) return; // Reached end of path

  const relationshipName = includePath[depth];
  const nextRecords = [];

  for (const record of currentRecords) {
    if (!record.__relationships) continue;
    if (!(relationshipName in record.__relationships)) continue;

    const relatedRecords = record.__relationships[relationshipName];
    if (!relatedRecords) continue;

    // Handle both belongsTo (single) and hasMany (array)
    const recordsToProcess = Array.isArray(relatedRecords)
      ? relatedRecords
      : [relatedRecords];

    for (const relatedRecord of recordsToProcess) {
      if (!relatedRecord) continue;

      const type = relatedRecord.__model.__name;
      const id = relatedRecord.id;

      // Initialize Set for this type if needed
      if (!seen.has(type)) {
        seen.set(type, new Set());
      }

      // Check if we've already seen this type+id combination
      if (!seen.get(type).has(id)) {
        seen.get(type).add(id);
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

function collectIncludedRecords(data, includes) {
  if (!includes || includes.length === 0) return [];
  if (!data) return [];

  const seen = new Map(); // Map<type, Set<id>> for deduplication
  const included = [];

  // Normalize to array for consistent processing
  const records = Array.isArray(data) ? data : [data];

  // Process each include path
  for (const includePath of includes) {
    traverseIncludePath(records, includePath, 0, seen, included);
  }

  return included;
}

function parseInclude(includeParam) {
  if (!includeParam || typeof includeParam !== 'string') return [];

  return includeParam
    .split(',')
    .map(rel => rel.trim())
    .filter(rel => rel.length > 0)
    .map(rel => rel.split('.')); // Parse nested paths: "owner.pets" → ["owner", "pets"]
}

function parseFields(query) {
  const fields = new Map();
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

function parseFilters(query) {
  const filters = [];
  if (!query) return filters;

  for (const [key, value] of Object.entries(query)) {
    const match = key.match(/^filter\[(.+)\]$/);
    if (match && typeof value === 'string') {
      filters.push({ path: match[1].split('.'), value });
    }
  }

  return filters;
}

function createFilterPredicate(filters) {
  if (filters.length === 0) return null;

  return (record) => filters.every(({ path, value }) => {
    let current = record;

    for (const segment of path) {
      if (current == null) return false;
      current = current[segment];
    }

    return String(current) === value;
  });
}

export default class OrmRequest extends Request {
  constructor({ model, access }) {
    super(...arguments);

    this.access = access;
    const pluralizedModel = pluralize(model);

    const modelRelationships = getModelRelationships(model);

    this.handlers = {
      get: {
        [`/${pluralizedModel}`]: (request, { filter: accessFilter }) => {
          const allRecords = Array.from(store.get(model).values());

          const queryFilters = parseFilters(request.query);
          const queryFilterPredicate = createFilterPredicate(queryFilters);
          const fieldsMap = parseFields(request.query);
          const modelFields = fieldsMap.get(pluralizedModel) || fieldsMap.get(model);

          let recordsToReturn = allRecords;
          if (accessFilter) recordsToReturn = recordsToReturn.filter(accessFilter);
          if (queryFilterPredicate) recordsToReturn = recordsToReturn.filter(queryFilterPredicate);

          const baseUrl = getBaseUrl(request);
          const data = recordsToReturn.map(record => record.toJSON({ fields: modelFields, baseUrl }));

          return buildResponse(data, request.query?.include, recordsToReturn, {
            links: { self: `${baseUrl}/${pluralizedModel}` },
            baseUrl
          });
        },

        [`/${pluralizedModel}/:id`]: (request) => {
          const record = store.get(model, getId(request.params));
          if (!record) return 404;

          const fieldsMap = parseFields(request.query);
          const modelFields = fieldsMap.get(pluralizedModel) || fieldsMap.get(model);

          const baseUrl = getBaseUrl(request);
          return buildResponse(record.toJSON({ fields: modelFields, baseUrl }), request.query?.include, record, {
            links: { self: `${baseUrl}/${pluralizedModel}/${request.params.id}` },
            baseUrl
          });
        },

        // Relationship routes - auto-generated based on model relationships
        ...this._generateRelationshipRoutes(model, pluralizedModel, modelRelationships)
      },

      patch: {
        [`/${pluralizedModel}/:id`]: async ({ body, params }) => {
          const record = store.get(model, getId(params));
          const { attributes } = body?.data || {};

          if (!attributes) return 400; // Bad request

          // Apply updates 1 by 1 to utilize built-in transform logic, ignore id key
          for (const [key, value] of Object.entries(attributes)) {
            if (!record.hasOwnProperty(key)) continue;
            if (key === 'id') continue;

            record[key] = value
          };

          return { data: record.toJSON() };
        }
      },

      post: {
        [`/${pluralizedModel}`]: ({ body, query }) => {
          const { type, attributes } = body?.data || {};

          if (!type) return 400; // Bad request

          const fieldsMap = parseFields(query);
          const modelFields = fieldsMap.get(pluralizedModel) || fieldsMap.get(model);
          // Check for duplicate ID
          if (attributes?.id !== undefined && store.get(model, attributes.id)) return 409; // Conflict

          const record = createRecord(model, attributes, { serialize: false });

          return { data: record.toJSON({ fields: modelFields }) };
        }
      },

      delete: {
        [`/${pluralizedModel}/:id`]: ({ params }) => {
          store.remove(model, getId(params));
        }
      }
    }
  }

  _generateRelationshipRoutes(model, pluralizedModel, modelRelationships) {
    const routes = {};

    for (const [relationshipName, info] of Object.entries(modelRelationships)) {
      // Related resource route: GET /{type}/:id/{relationship}
      routes[`/${pluralizedModel}/:id/${relationshipName}`] = (request) => {
        const record = store.get(model, getId(request.params));
        if (!record) return 404;

        const relatedData = record.__relationships[relationshipName];
        const baseUrl = getBaseUrl(request);

        let data;
        if (info.isArray) {
          // hasMany - return array
          data = (relatedData || []).map(r => r.toJSON({ baseUrl }));
        } else {
          // belongsTo - return single or null
          data = relatedData ? relatedData.toJSON({ baseUrl }) : null;
        }

        return {
          links: { self: `${baseUrl}/${pluralizedModel}/${request.params.id}/${relationshipName}` },
          data
        };
      };

      // Relationship linkage route: GET /{type}/:id/relationships/{relationship}
      routes[`/${pluralizedModel}/:id/relationships/${relationshipName}`] = (request) => {
        const record = store.get(model, getId(request.params));
        if (!record) return 404;

        const relatedData = record.__relationships[relationshipName];
        const baseUrl = getBaseUrl(request);

        let data;
        if (info.isArray) {
          // hasMany - return array of linkage objects
          data = (relatedData || []).map(r => ({ type: r.__model.__name, id: r.id }));
        } else {
          // belongsTo - return single linkage or null
          data = relatedData ? { type: relatedData.__model.__name, id: relatedData.id } : null;
        }

        return {
          links: {
            self: `${baseUrl}/${pluralizedModel}/${request.params.id}/relationships/${relationshipName}`,
            related: `${baseUrl}/${pluralizedModel}/${request.params.id}/${relationshipName}`
          },
          data
        };
      };
    }

    // Catch-all for invalid relationship names on related resource route
    routes[`/${pluralizedModel}/:id/:relationship`] = (request) => {
      const record = store.get(model, getId(request.params));
      if (!record) return 404;

      // If we reach here, relationship doesn't exist (valid ones were registered above)
      return 404;
    };

    // Catch-all for invalid relationship names on relationship linkage route
    routes[`/${pluralizedModel}/:id/relationships/:relationship`] = (request) => {
      const record = store.get(model, getId(request.params));
      if (!record) return 404;

      return 404;
    };

    return routes;
  }

  auth(request, state) {
    const access = this.access(request);

    if (!access) return 403;
    if (Array.isArray(access) && !access.includes(methodAccessMap[request.method])) return 403;
    if (typeof access === 'function') state.filter = access;
  }
}
