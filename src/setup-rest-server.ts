import { waitForModule } from 'stonyx';
import Orm, { store } from '@stonyx/orm';
import OrmRequest from './orm-request.js';
import MetaRequest from './meta-request.js';
import RestServer from '@stonyx/rest-server';
import { forEachFileImport } from '@stonyx/utils/file';
import { dbKey } from './db.js';
import { getPluralName } from './plural-registry.js';
import log from 'stonyx/log';
import type { AccessFunction } from './types/orm-types.js';

interface AccessInstance {
  models: string[] | '*';
  /**
   * The consumer predicate. Called as `access(request, { model, operation })`
   * -- the second argument is additive (abofs/stonyx-orm#202), so a predicate
   * declared with a single parameter is still valid and still works.
   */
  access: AccessFunction;
}

export default async function(route: string, accessPath: string, metaRoute: boolean): Promise<void> {
  const accessFunctions: Record<string, AccessFunction> = {};

  try {
    await forEachFileImport(accessPath, (accessClass: unknown) => {
      const accessInstance = new (accessClass as new () => AccessInstance)();
      const { models } = accessInstance;

      if (!models) throw new Error(`Access class "${(accessClass as { name: string }).name}" must define a "models" list`);

      if (models.length === 0) return; // No models to assign access to
      if (typeof accessInstance.access !== 'function') throw new Error(`Access class "${(accessClass as { name: string }).name}" must declare an "access" method`);

      const availableModels = Array.from(store.data.keys());

      for (const model of models === '*' ? availableModels : models) {
        if (model === dbKey) continue;
        if (!store.data.has(model)) throw new Error(`Unable to define access for Invalid Model "${model}". Model does not exist`);
        if (accessFunctions![model]) throw new Error(`Access for model "${model}" has already been defined by another access class.`);

        accessFunctions![model] = accessInstance.access;
      }
    });
  } catch (error) {
    log.error?.(error instanceof Error ? error.message : String(error));
    log.warn?.('You must define a valid access configuration file in order to access ORM generated REST endpoints.');
  }

  // -------------------------------------------------------------------------
  // #202 -- the registry has to survive this function.
  //
  // `accessFunctions` used to be a function-local that was discarded at the return
  // below, so the only thing that ever saw it was the mount loop. Each mounted
  // OrmRequest then held its OWN model's predicate and nothing held the map, so
  // at request time there was no route from a model NAME to that model's
  // predicate -- which is what abofs/stonyx-orm#196 and #207 need in order to
  // ask model X's predicate about a request routed to model Y.
  //
  // Published BEFORE `waitForModule('rest-server')` and before the mount loop,
  // deliberately. That module may already be listening by the time it reports
  // ready, so assigning after the mounts would leave a window in which a route
  // exists and the registry does not.
  //
  // Assigned unconditionally, including when the try above failed and the map
  // is empty or partial: the mount loop below is driven by this exact object,
  // so whatever is reachable through `Orm.instance` is by construction the same
  // set of predicates that is actually enforcing. A guard here that skipped the
  // assignment would let the registry go silently missing, which is precisely
  // the failure #202's AC8 exists to catch.
  Orm.instance.accessFunctions = accessFunctions;

  await waitForModule('rest-server');

  // Remove "/" prefix and name mount point accordingly
  const name = route === '/' ? 'index' : (route[0] === '/' ? route.slice(1) : route);

  // Configure endpoints for models and views with access configuration
  for (const [model, access] of Object.entries(accessFunctions!)) {
    const pluralizedModel = getPluralName(model);
    const modelName = name === 'index' ? pluralizedModel : `${name}/${pluralizedModel}`;
    RestServer.instance.mountRoute(OrmRequest, { name: modelName, options: { model, access } });
  }

  // Mount the meta route when metaRoute config is enabled
  if (metaRoute) {
    log.warn?.('SECURITY RISK! - Meta route is enabled via metaRoute config. This feature is intended for development purposes only!');

    RestServer.instance.mountRoute(MetaRequest, { name });
  }
}
