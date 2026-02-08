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
import { createFile, createDirectory, updateFile, readFile, fileExists } from '@stonyx/utils/file';
import path from 'path';

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

  getCollectionKeys() {
    const SchemaClass = Orm.instance.models[`${dbKey}Model`];
    const instance = new SchemaClass();
    const keys = [];

    for (const key of Object.keys(instance)) {
      if (key === '__name' || key === 'id') continue;
      if (typeof instance[key] === 'function') keys.push(key);
    }

    return keys;
  }

  getDirPath() {
    const { rootPath } = config;
    const { file, directory } = config.orm.db;
    const dbDir = path.dirname(path.resolve(`${rootPath}/${file}`));

    return path.join(dbDir, directory);
  }

  async validateMode() {
    const { rootPath } = config;
    const { file, mode } = config.orm.db;
    const collectionKeys = this.getCollectionKeys();
    const dirPath = this.getDirPath();

    if (mode === 'directory') {
      const dbFilePath = path.resolve(`${rootPath}/${file}`);
      const exists = await fileExists(dbFilePath);

      if (exists) {
        const data = await readFile(dbFilePath, { json: true });
        const hasData = collectionKeys.some(key => Array.isArray(data[key]) && data[key].length > 0);

        if (hasData) {
          log.error(`DB mode mismatch: db.json contains data but mode is set to 'directory'. Run migration first:\n\n  node node_modules/@stonyx/orm/scripts/file-to-directory.js\n`);
          process.exit(1);
        }
      }
    } else {
      const dirExists = await fileExists(dirPath);

      if (dirExists) {
        const hasCollectionFiles = (await Promise.all(
          collectionKeys.map(key => fileExists(path.join(dirPath, `${key}.json`)))
        )).some(Boolean);

        if (hasCollectionFiles) {
          log.error(`DB mode mismatch: directory '${config.orm.db.directory}/' contains collection files but mode is set to 'file'. Run migration first:\n\n  node node_modules/@stonyx/orm/scripts/directory-to-file.js\n`);
          process.exit(1);
        }
      }
    }
  }

  async init() {
    const { autosave, saveInterval } = config.orm.db;

    store.set(dbKey, new Map());
    Orm.instance.models[`${dbKey}Model`] = await this.getSchema();

    await this.validateMode();
    this.record = await this.getRecord();

    if (autosave !== 'true') return;

    new Cron().register('save', this.save.bind(this), saveInterval);
  }

  async create() {
    const { rootPath } = config;
    const { file, mode } = config.orm.db;

    if (mode === 'directory') {
      const dirPath = this.getDirPath();
      const collectionKeys = this.getCollectionKeys();

      await createDirectory(dirPath);

      await Promise.all(collectionKeys.map(key =>
        createFile(path.join(dirPath, `${key}.json`), [], { json: true })
      ));

      // Write empty-array skeleton to db.json
      const skeleton = {};
      for (const key of collectionKeys) skeleton[key] = [];

      await createFile(`${rootPath}/${file}`, skeleton, { json: true });

      return skeleton;
    }

    createFile(`${rootPath}/${file}`, {}, { json: true });

    return {};
  }

  async save() {
    const { file, mode } = config.orm.db;
    const jsonData = this.record.format();
    delete jsonData.id; // Don't save id

    if (mode === 'directory') {
      const dirPath = this.getDirPath();
      const collectionKeys = this.getCollectionKeys();

      // Write each collection to its own file in parallel
      await Promise.all(collectionKeys.map(key =>
        updateFile(path.join(dirPath, `${key}.json`), jsonData[key] || [], { json: true })
      ));

      // Write empty-array skeleton to db.json
      const skeleton = {};
      for (const key of collectionKeys) skeleton[key] = [];

      await updateFile(`${config.rootPath}/${file}`, skeleton, { json: true });

      log.db(`DB has been successfully saved to ${config.orm.db.directory}/ directory`);
      return;
    }

    await updateFile(`${config.rootPath}/${file}`, jsonData, { json: true });

    log.db(`DB has been successfully saved to ${file}`);
  }

  async getRecord() {
    const { mode } = config.orm.db;

    if (mode === 'directory') return this.getRecordFromDirectory();

    return this.getRecordFromFile();
  }

  async getRecordFromFile() {
    const { file } = config.orm.db;

    const data = await readFile(file, { json: true, missingFileCallback: this.create.bind(this) });

    return createRecord(dbKey, data, { isDbRecord: true, serialize: false, transform: false });
  }

  async getRecordFromDirectory() {
    const dirPath = this.getDirPath();
    const collectionKeys = this.getCollectionKeys();
    const dirExists = await fileExists(dirPath);

    if (!dirExists) {
      const data = await this.create();
      return createRecord(dbKey, data, { isDbRecord: true, serialize: false, transform: false });
    }

    const assembled = {};

    await Promise.all(collectionKeys.map(async key => {
      const filePath = path.join(dirPath, `${key}.json`);
      const exists = await fileExists(filePath);

      assembled[key] = exists ? await readFile(filePath, { json: true }) : [];
    }));

    return createRecord(dbKey, assembled, { isDbRecord: true, serialize: false, transform: false });
  }
}
