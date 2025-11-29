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

export default class OrmRequest extends Request {
  constructor({ model, access }) {
    super(...arguments);

    this.access = access;
    const pluralizedModel = pluralize(model);

    this.handlers = {
      get: {
        [`/${pluralizedModel}`]: (_request, { filter }) => {
          const records = Array.from(store.get(model).values()).map(record => record.toJSON());
          const response = filter ? records.filter(filter) : records;

          return { data: response };
        },

        [`/${pluralizedModel}/:id`]: ({ params }) => {
          const record = store.get(model, getId(params));

          if (!record) return 404; // Record not found

          return { data: record.toJSON() };
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
