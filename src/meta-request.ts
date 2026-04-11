import { Request } from '@stonyx/rest-server';
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

                if ((property as { constructor?: { name?: string } })?.constructor?.name === 'ModelProperty') {
                  properties[key] = { type: (property as { type: string }).type };
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
            return { error: (error as Error).message };
          }
        },
      },
    }
  }

  auth(): number | undefined {
    if (!(config as Record<string, unknown> & { orm: { restServer: { metaRoute: unknown } } }).orm.restServer.metaRoute) return 403;
  }
}
