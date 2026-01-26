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

import Cron from '@stonyx/cron';
import config from 'stonyx/config';
import log from 'stonyx/log';
import Orm, { createRecord, store } from '@stonyx/orm';
import { createFile, updateFile, readFile } from '@stonyx/utils/file';

export const dbKey = '__db';

export default class DB {
  constructor() {
    if (DB.instance) return DB.instance;
    
    DB.instance = this;
  }

  async getSchema() {
    const { rootPath } = config;
    const { file, schema } = config.orm.db;

    if (!file) throw new Error('Configuration Error: ORM DB file path must be defined.');

    return (await import(`${rootPath}/${schema}`)).default;
  }

  async init() {
    const { autosave, saveInterval } = config.orm.db;
    
    store.set(dbKey, new Map());
    Orm.instance.models[`${dbKey}Model`] = await this.getSchema();

    this.record = await this.getRecord();

    if (autosave !== 'true') return;

    new Cron().register('save', this.save.bind(this), saveInterval);
  }

  async create() {
    const { rootPath } = config;
    const { file } = config.orm.db;

    createFile(`${rootPath}/${file}`, {}, { json: true });

    return {};
  }
  
  async save() {
    const { file } = config.orm.db;
    const jsonData = this.record.format();
    delete jsonData.id; // Don't save id

    await updateFile(`${config.rootPath}/${file}`, jsonData, { json: true });

    log.db(`DB has been successfully saved to ${file}`);
  }

  async getRecord() {
    const { file } = config.orm.db;

    const data = await readFile(file, { json: true, missingFileCallback: this.create.bind(this) });

    return createRecord(dbKey, data, { isDbRecord: true, serialize: false, transform: false });
  }
}
