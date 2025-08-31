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

    this.handlers = {
      get: {
        [`/${model}`]: (_request, { filter }) => {
          const records = Array.from(store.get(model).values()).map(record => record.serialize());
          const response = filter ? records.filter(filter) : records;

          return { [ pluralize(model) ]: response };
        },

        [`/${model}/:id`]: ({ params }) => {
          const record = store.get(model, getId(params));

          if (!record) return 404; // Record not found

          return { [model]: record.serialize() };
        }
      },

      patch: {
        [`/${model}/:id`]: ({ body, params }) => {
          const record = store.get(model, getId(params));

          // Apply updates 1 by 1 to utilize built-in transform logic, ignore id key
          Object.entries(body).forEach(([key, value]) => {
            if (key !== 'id') record[key] = value
          }); 

          return { [model]: record.serialize() };
        }
      },

      post: {
        [`/${model}`]: ({ body }) => {
          const record = createRecord(model, body, { serialize: false });

          return { [model]: record.serialize() };
        }
      },

      delete: {
        [`/${model}/:id`]: ({ params }) => {
          store.remove(model, getId(params));
        }
      },
    }
  }

  auth(request, state) {
    const access = this.access(request);

    if (!access) return 403;
    if (Array.isArray(access) && !access.includes(methodAccessMap[request.method])) return 403;
    if (typeof access === 'function') state.filter = access;
  }
}
