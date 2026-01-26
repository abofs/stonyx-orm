/*
 * Copyright 2025 Stone Costa
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import DB from './db.js';
import config from 'stonyx/config';
import log from 'stonyx/log';
import { forEachFileImport } from '@stonyx/utils/file';
import { kebabCaseToPascalCase, pluralize } from '@stonyx/utils/string';
import setupRestServer from './setup-rest-server.js';
import baseTransforms from './transforms.js';
import Store from './store.js';
import Serializer from './serializer.js';

const defaultOptions = {
  dbType: 'json'
}

export default class Orm {
  static initialized = false;
  static relationships = new Map();
  static store = new Store();
  
  models = {};
  serializers = {};
  transforms = { ...baseTransforms };
  warnings = new Set();

  constructor(options={}) {
    if (Orm.instance) return Orm.instance;

    const { relationships } = Orm;

    // Declare relationship maps
    for (const key of ['hasMany', 'belongsTo', 'global', 'pending', 'pendingBelongsTo']) {
      relationships.set(key, new Map());
    }

    this.options = { ...defaultOptions, ...options };

    Orm.instance = this;
  }

  async init() {
    const { paths, restServer } = config.orm;
    const promises = ['Model', 'Serializer', 'Transform'].map(type => {
      const lowerCaseType = type.toLowerCase();
      const path = paths[lowerCaseType];

      if (!path) throw new Error(`Configuration Error: ORM path for "${type}" must be defined.`);

      return forEachFileImport(path, (exported, { name }) => {
        // Transforms keep their original name, everything else gets converted to PascalCase with the type suffix
        const alias = type === 'Transform' ? name : `${kebabCaseToPascalCase(name)}${type}`;

        if (type === 'Model') Orm.store.set(name, new Map());

        return this[pluralize(lowerCaseType)][alias] = exported;
      }, { ignoreAccessFailure: true, rawName: true, recursive: true, recursiveNaming: true });
    });

    // Wait for imports before db & rest server setup
    await Promise.all(promises);

    if (this.options.dbType !== 'none') {
      const db = new DB();
      this.db = db;
      
      promises.push(db.init());
    }

    if (restServer.enabled === 'true') {
      promises.push(setupRestServer(restServer.route, paths.access, restServer.metaRoute));
    }

    Orm.ready = await Promise.all(promises);
    Orm.initialized = true;
  }

  static get db() {
    if (!Orm.initialized) throw new Error('ORM has not been initialized yet');

    return Orm.instance.db;
  }

  getRecordClasses(modelName) {
    const modelClassPrefix = kebabCaseToPascalCase(modelName);
  
    return {
      modelClass: this.models[`${modelClassPrefix}Model`],
      serializerClass: this.serializers[`${modelClassPrefix}Serializer`] || Serializer
    };
  }

  // Queue warnings to avoid the same error from being logged in the same iteration
  warn(message) {
    this.warnings.add(message);

    setTimeout(() => {
      this.warnings.forEach(warning => log.warn(warning));
      this.warnings.clear();
    }, 0);
  }
}

export const store = Orm.store;
export const relationships = Orm.relationships;