import { waitForModule } from 'stonyx';
import Orm from '@stonyx/orm';
import OrmRequest from './orm-request.js';
import RestServer from '@stonyx/rest-server';
import { forEachFileImport } from '@stonyx/utils/file';
import { kebabCaseToPascalCase } from '@stonyx/utils/string';

export default async function(route, accessPath) {
  let accessFiles = {};
  
  await forEachFileImport(accessPath, accessClass => {
    const accessInstance = new accessClass();

    if (!accessInstance.models) throw new Error(`Access class "${accessClass.name}" must define a "models" list`);
    if (typeof accessInstance.access !== 'function') throw new Error(`Access class "${accessClass.name}" must declare an "access" method`);

    for (const model of accessInstance.models) {
      if (!Orm.instance.models[`${kebabCaseToPascalCase(model)}Model`]) throw new Error(`Unable to define access for Invalid Model "${model}". Model does not exist`);
      if (accessFiles[model]) throw new Error(`Access for model "${model}" has already been defined by another access class.`);

      accessFiles[model] = accessInstance.access;
    }
  });  

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
