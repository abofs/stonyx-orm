import { Request } from '@stonyx/rest-server';
import { createRecord, store } from '@stonyx/orm';
import { pluralize } from '@stonyx/utils/string';

const methodAccessMap = {
  GET: 'read',
  POST: 'create',
  DELETE: 'delete',
  PATCH: 'update',
};

function getId({ id }) {
  if (isNaN(id)) return id;

  return parseInt(id);
}

function buildResponse(data, includeParam, recordOrRecords) {
  const response = { data };

  if (!includeParam) return response;

  const includes = parseInclude(includeParam);
  if (includes.length === 0) return response;

  const includedRecords = collectIncludedRecords(recordOrRecords, includes);
  if (includedRecords.length > 0) {
    response.included = includedRecords.map(record => record.toJSON());
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

          const data = recordsToReturn.map(record => record.toJSON({ fields: modelFields }));
          return buildResponse(data, request.query?.include, recordsToReturn);
        },

        [`/${pluralizedModel}/:id`]: (request) => {
          const record = store.get(model, getId(request.params));
          if (!record) return 404;

          const fieldsMap = parseFields(request.query);
          const modelFields = fieldsMap.get(pluralizedModel) || fieldsMap.get(model);

          return buildResponse(record.toJSON({ fields: modelFields }), request.query?.include, record);
        }
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

  auth(request, state) {
    const access = this.access(request);

    if (!access) return 403;
    if (Array.isArray(access) && !access.includes(methodAccessMap[request.method])) return 403;
    if (typeof access === 'function') state.filter = access;
  }
}
