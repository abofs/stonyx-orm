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

import DB from "@stonyx/orm/db";
import config from "stonyx/config";
import BaseModel from "./model.js";
import BaseSerializer from "./serializer.js";
import ModelProperty from "./model-property.js";
import Record from "./record.js";
import { makeArray } from "@stonyx/utils/object";
import { forEachFileImport } from "@stonyx/utils/file";
import { kebabCaseToPascalCase, pluralize } from "@stonyx/utils/string";
import baseTransforms from "./transforms.js";

export default class Orm {
  ready = this.loadDependencies();
  initialized = false;
  
  models = {};
  serializers = {};
  transforms = { ...baseTransforms };

  constructor() {
    if (Orm.instance) return Orm.instance;
    Orm.instance = this;
  }

  async loadDependencies() {
    const { paths } = config.orm;

    await Promise.all(['Model', 'Serializer', 'Transform'].map(type => {
      const lowerCaseType = type.toLowerCase();
      const path = paths[lowerCaseType];
      if (!path) throw new Error(`Configuration Error: ORM path for "${type}" must be defined.`);

      return forEachFileImport(path, (exported, { name }) => {
        // Transforms keep their original name, everything else gets converted to PascalCase with the type suffix
        const alias = type === 'Transform' ? name : `${kebabCaseToPascalCase(name)}${type}`;

        return this[pluralize(lowerCaseType)][alias] = exported;
      }, { ignoreAccessFailure: true, rawName: true });
    }));

    await new DB().init();
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

export { BaseModel, BaseSerializer };

export function attr() {
  return new ModelProperty(...arguments);
}

export function belongsTo(modelName) {
  return rawData => createRecord(modelName, rawData);
}

export function hasMany(modelName) {
  return rawData => makeArray(rawData).map(elementData => createRecord(modelName, elementData));
}

export function createRecord(modelName, rawData={}) {
  if (!Orm.instance.initialized) throw new Error("ORM is not ready");

  const { modelClass, serializerClass } = Orm.instance.getRecordClasses(modelName);

  if (!modelClass) throw new Error(`A model named "${modelName}" does not exist`);

  const model = new modelClass(modelName);
  const serializer = new serializerClass(model);
  const record = new Record(model, serializer);

  record.serialize(rawData);
  return record;
}
