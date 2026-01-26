import { Request } from '@stonyx/rest-server';
import Orm from '@stonyx/orm';
import config from 'stonyx/config';
import { dbKey } from './db.js';

export default class MetaRequest extends Request {
  constructor() {
    super(...arguments);
    
    this.handlers = {
      get: {
        '/meta': () => {
          try {
            const { models } = Orm.instance;
            const metadata = {};

            for (const [modelName, modelClass] of Object.entries(models)) {
              const name = modelName.slice(0, -5).toLowerCase();

              if (name === dbKey) continue;

              const model = new modelClass(modelName);
              const properties = {};

              // Get regular properties and relationships
              for (const [key, property] of Object.entries(model)) {
                // Skip internal properties
                if (key.startsWith('__')) continue;

                if (property?.constructor?.name === 'ModelProperty') {
                  properties[key] = { type: property.type };
                } else if (typeof property === 'function') {
                  const isBelongsTo = property.toString().includes(`getRelationships('belongsTo',`);
                  const isHasMany = property.toString().includes(`getRelationships('hasMany',`);

                  if (isBelongsTo || isHasMany) properties[key] = { [isBelongsTo ? 'belongsTo' : 'hasMany']: name };
                }
              }

              metadata[name] = properties;
            }

            return metadata;            
          } catch (error) {
            return { error: error.message };
          }
        },
      },
    }
  }

  auth() {
    if (!config.orm.restServer.metaRoute) return 403;
  }
}
