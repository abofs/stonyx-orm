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
  // Published BEFORE `await waitForModule('rest-server')`, deliberately: that
  // await is the ONLY yield point in this function, and the rest-server module
  // may already be listening by the time it reports ready, so an assignment
  // after it would leave a window in which a route is live and the registry is
  // not.
  //
  // It is NOT before the mount loop for that reason, and the comment here used
  // to say it was. `RestServer.mountRoute` is fully synchronous -- construct,
  // registerCalls(), api.use() -- and nothing between the loop and this
  // function's closing brace yields, so the event loop cannot deliver a request
  // in there and the window that clause described cannot open. Measured:
  // moving this assignment to the last statement of the function leaves the
  // suite at 951 pass / 0 fail. Being ahead of the mount loop is free and
  // harmless; it is not what makes the ordering correct.
  //
  // Assigned unconditionally, including when the try above failed and the map
  // is empty or partial: the mount loop below is driven by this exact object,
  // so at the moment of assignment whatever is reachable through
  // `Orm.instance` is the same set of predicates that is about to enforce.
  // A guard such as `if (Object.keys(accessFunctions).length)` would let the
  // registry go silently missing on a total load failure, and a later consumer
  // would read `undefined` from `getAccess` and have to distinguish "no access
  // class" from "the registry was never published" -- which it cannot. That is
  // the reasoning, and it is REASONING, not something this suite tests: the
  // guarded variant is also 951 pass / 0 fail, AC8 included, because every boot
  // in this suite loads a non-empty access map so the guard never fires. AC8
  // demonstrably cannot catch it. Catching it needs a boot with
  // `orm.paths.access` pointed at an empty directory, which this suite has no
  // harness for.
  //
  // One further limit on "by construction": the mount loop passes `access` BY
  // VALUE into each OrmRequest, so the enforcing set is a snapshot taken here,
  // while `getAccess` reads the map live. The two are the same set at boot and
  // stay the same set only for as long as nobody writes to the public field.
  // The equality is a boot-time fact, not an invariant.
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
