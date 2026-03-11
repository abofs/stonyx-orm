import { waitForModule } from 'stonyx';
import { store } from '@stonyx/orm';
import OrmRequest from './orm-request.js';
import MetaRequest from './meta-request.js';
import RestServer from '@stonyx/rest-server';
import { forEachFileImport } from '@stonyx/utils/file';
import { dbKey } from './db.js';
import { getPluralName } from './plural-registry.js';
import log from 'stonyx/log';

export default async function(route, accessPath, metaRoute) {
  let accessFiles = {};
  
  try {
    await forEachFileImport(accessPath, accessClass => {
      const accessInstance = new accessClass();
      const { models } = accessInstance;

      if (!models) throw new Error(`Access class "${accessClass.name}" must define a "models" list`);

      if (models.length === 0) return; // No models to assign access to
      if (typeof accessInstance.access !== 'function') throw new Error(`Access class "${accessClass.name}" must declare an "access" method`);

      const availableModels = Array.from(store.data.keys());

      for (const model of models === '*' ? availableModels : models) {
        if (model === dbKey) continue;
        if (!store.data.has(model)) throw new Error(`Unable to define access for Invalid Model "${model}". Model does not exist`);
        if (accessFiles[model]) throw new Error(`Access for model "${model}" has already been defined by another access class.`);

        accessFiles[model] = accessInstance.access;
      }
    });
  } catch (error) {
    log.error(error.message);
    log.warn('You must define a valid access configuration file in order to access ORM generated REST endpoints.');
  }

  await waitForModule('rest-server');

  // Remove "/" prefix and name mount point accordingly
  const name = route === '/' ? 'index' : (route[0] === '/' ? route.slice(1) : route);

  // Configure endpoints for models with access configuration
  for (const [model, access] of Object.entries(accessFiles)) {
    const pluralizedModel = getPluralName(model);
    const modelName = name === 'index' ? pluralizedModel : `${name}/${pluralizedModel}`;
    RestServer.instance.mountRoute(OrmRequest, { name: modelName, options: { model, access } });
  }

  // Mount the meta route when metaRoute config is enabled
  if (metaRoute) {
    log.warn('SECURITY RISK! - Meta route is enabled via metaRoute config. This feature is intended for development purposes only!');

    RestServer.instance.mountRoute(MetaRequest, { name });
  }

  // Cleanup references
  accessFiles = null;
}
