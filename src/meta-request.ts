import { Request } from '@stonyx/rest-server';
import ModelProperty from './model-property.js';
import Orm from './main.js';
import config from 'stonyx/config';
import { dbKey } from './db.js';

export default class MetaRequest extends Request {
  handlers: Record<string, unknown>;

  constructor(...args: unknown[]) {
    super(...args);

    this.handlers = {
      get: {
        '/meta': () => {
          try {
            const { models } = Orm.instance as Orm;
            const metadata: Record<string, Record<string, unknown>> = {};

            for (const [modelName, modelClass] of Object.entries(models)) {
              const name = modelName.slice(0, -5).toLowerCase();

              if (name === dbKey) continue;

              const model = new (modelClass as new (name: string) => Record<string, unknown>)(modelName);
              const properties: Record<string, unknown> = {};

              // Get regular properties and relationships
              for (const [key, property] of Object.entries(model)) {
                // Skip internal properties
                if (key.startsWith('__')) continue;

                if (property instanceof ModelProperty) {
                  properties[key] = { type: (property as { type: string }).type };
                } else if (typeof property === 'function') {
                  const isBelongsTo = (property as { __relationshipType?: string }).__relationshipType === 'belongsTo';
                  const isHasMany = (property as { __relationshipType?: string }).__relationshipType === 'hasMany';

                  if (isBelongsTo || isHasMany) properties[key] = { [isBelongsTo ? 'belongsTo' : 'hasMany']: name };
                }
              }

              metadata[name] = properties;
            }

            return metadata;
          } catch (error) {
            return { error: error instanceof Error ? error.message : String(error) };
          }
        },
      },
    }
  }

  auth(): number | undefined {
    if (!config.orm.restServer.metaRoute) return 403;
  }
}
