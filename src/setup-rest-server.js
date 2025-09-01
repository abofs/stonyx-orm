import { waitForModule } from 'stonyx';
import { store } from '@stonyx/orm';
import OrmRequest from './orm-request.js';
import RestServer from '@stonyx/rest-server';
import { forEachFileImport } from '@stonyx/utils/file';
import { dbKey } from './db.js';
import log from 'stonyx/log';

export default async function(route, accessPath) {
  let accessFiles = {};
  
  try {
    await forEachFileImport(accessPath, accessClass => {
      const accessInstance = new accessClass();

      if (!accessInstance.models) throw new Error(`Access class "${accessClass.name}" must define a "models" list`);
      if (typeof accessInstance.access !== 'function') throw new Error(`Access class "${accessClass.name}" must declare an "access" method`);

      const { models } = accessInstance;
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

  // Configure endpoints for models with access configuration
  for (const [model, access] of Object.entries(accessFiles)) {
    // Remove "/" prefix and name mount point accordingly
    const name = route === '/' ? 'index' : (route[0] === '/' ? route.slice(1) : route);

    await waitForModule('rest-server');
    RestServer.instance.mountRoute(OrmRequest, { name, options: { model, access } }); 
  }

  // Cleanup references
  accessFiles = null;
}
