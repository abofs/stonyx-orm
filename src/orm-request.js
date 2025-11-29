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

function collectIncludedRecords(data, includes) {
  if (!includes || includes.length === 0) return [];
  if (!data) return [];

  const seen = new Map(); // Map<type, Set<id>> for deduplication
  const included = [];

  // Normalize to array for consistent processing
  const records = Array.isArray(data) ? data : [data];

  for (const record of records) {
    if (!record.__relationships) continue;

    // Only process includes that are valid for this record
    const validIncludes = includes.filter(
      relationshipName => relationshipName in record.__relationships
    );

    for (const relationshipName of validIncludes) {
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
        }
      }
    }
  }

  return included;
}

function parseInclude(includeParam) {
  if (!includeParam || typeof includeParam !== 'string') return [];

  return includeParam
    .split(',')
    .map(rel => rel.trim())
    .filter(rel => rel.length > 0);
}

export default class OrmRequest extends Request {
  constructor({ model, access }) {
    super(...arguments);

    this.access = access;
    const pluralizedModel = pluralize(model);

    this.handlers = {
      get: {
        [`/${pluralizedModel}`]: (request, { filter }) => {
          const allRecords = Array.from(store.get(model).values());
          const recordsToReturn = filter ? allRecords.filter(filter) : allRecords;
          const data = recordsToReturn.map(record => record.toJSON());

          return buildResponse(data, request.query?.include, recordsToReturn);
        },

        [`/${pluralizedModel}/:id`]: (request) => {
          const record = store.get(model, getId(request.params));

          if (!record) return 404; // Record not found

          return buildResponse(record.toJSON(), request.query?.include, record);
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
        [`/${pluralizedModel}`]: ({ body }) => {
          const { attributes } = body?.data || {};

          if (!attributes) return 400; // Bad request

          const record = createRecord(model, attributes, { serialize: false });

          return { data: record.toJSON() };
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
