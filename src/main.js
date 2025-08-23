import DB from '@stonyx/orm/db';
import config from 'stonyx/config';
import { forEachFileImport } from '@stonyx/utils/file';
import { kebabCaseToPascalCase, pluralize } from '@stonyx/utils/string';
import baseTransforms from './transforms.js';
import Store from './store.js';

export default class Orm {
  initialized = false;
  
  models = {};
  serializers = {};
  transforms = { ...baseTransforms };
  static relationships = new Map();
  static store = new Store();

  constructor() {
    if (Orm.instance) return Orm.instance;

    const { relationships } = Orm;
    relationships.set('hasMany', new Map());
    relationships.set('belongsTo', new Map());

    Orm.instance = this;
  }

  async init() {
    const { paths } = config.orm;
    const promises = ['Model', 'Serializer', 'Transform'].map(type => {
      const lowerCaseType = type.toLowerCase();
      const path = paths[lowerCaseType];

      if (!path) throw new Error(`Configuration Error: ORM path for "${type}" must be defined.`);

      return forEachFileImport(path, (exported, { name }) => {
        // Transforms keep their original name, everything else gets converted to PascalCase with the type suffix
        const alias = type === 'Transform' ? name : `${kebabCaseToPascalCase(name)}${type}`;

        if (type === 'Model') Orm.store.set(name, new Map());

        return this[pluralize(lowerCaseType)][alias] = exported;
      }, { ignoreAccessFailure: true, rawName: true });
    });

    promises.push(new DB().init());

    await Promise.all(promises);
    
    this.initialized = true;
  }

  getRecordClasses(modelName) {
    const modelClassPrefix = kebabCaseToPascalCase(modelName);
  
    return {
      modelClass: this.models[`${modelClassPrefix}Model`],
      serializerClass: this.serializers[`${modelClassPrefix}Serializer`] || BaseSerializer
    };
  }
}

export const store = Orm.store;
export const relationships = Orm.relationships;
