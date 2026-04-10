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
import Orm, { store, createRecord } from '@stonyx/orm';
import { createFile, createDirectory, updateFile, readFile, fileExists } from '@stonyx/utils/file';
import path from 'path';

export const dbKey = '__db';

interface DBConfig {
  rootPath: string;
  orm: {
    db: {
      file: string;
      schema: string;
      mode: string;
      directory: string;
      autosave: string;
      saveInterval: unknown;
    };
  };
}

interface DBRecord {
  format(): Record<string, unknown>;
  [key: string]: unknown;
}

export default class DB {
  static instance: DB;
  record!: DBRecord;

  constructor() {
    if (DB.instance) return DB.instance;

    DB.instance = this;
  }

  async getSchema(): Promise<unknown> {
    const { rootPath } = config as unknown as DBConfig;
    const { file, schema } = (config as unknown as DBConfig).orm.db;

    if (!file) throw new Error('Configuration Error: ORM DB file path must be defined.');

    return (await import(`${rootPath}/${schema}`)).default;
  }

  getCollectionKeys(): string[] {
    const SchemaClass = (Orm.instance as Orm).models[`${dbKey}Model`] as new () => Record<string, unknown>;
    const instance = new SchemaClass();
    const keys: string[] = [];

    for (const key of Object.keys(instance)) {
      if (key === '__name' || key === 'id') continue;
      if (typeof instance[key] === 'function') keys.push(key);
    }

    return keys;
  }

  getDirPath(): string {
    const { rootPath } = config as unknown as DBConfig;
    const { file, directory } = (config as unknown as DBConfig).orm.db;
    const dbDir = path.dirname(path.resolve(`${rootPath}/${file}`));

    return path.join(dbDir, directory);
  }

  async validateMode(): Promise<void> {
    const { rootPath } = config as unknown as DBConfig;
    const { file, mode } = (config as unknown as DBConfig).orm.db;
    const collectionKeys = this.getCollectionKeys();
    const dirPath = this.getDirPath();

    if (mode === 'directory') {
      const dbFilePath = path.resolve(`${rootPath}/${file}`);
      const exists = await fileExists(dbFilePath);

      if (exists) {
        const data = await readFile(dbFilePath, { json: true }) as Record<string, unknown[]>;
        const hasData = collectionKeys.some(key => Array.isArray(data[key]) && data[key].length > 0);

        if (hasData) {
          log.error!(`DB mode mismatch: db.json contains data but mode is set to 'directory'. Run migration first:\n\n  stonyx db:migrate-to-directory\n`);
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
          log.error!(`DB mode mismatch: directory '${(config as unknown as DBConfig).orm.db.directory}/' contains collection files but mode is set to 'file'. Run migration first:\n\n  stonyx db:migrate-to-file\n`);
          process.exit(1);
        }
      }
    }
  }

  async init(): Promise<void> {
    const { autosave, saveInterval } = (config as unknown as DBConfig).orm.db;

    store.set(dbKey, new Map());
    (Orm.instance as Orm).models[`${dbKey}Model`] = await this.getSchema();

    await this.validateMode();
    this.record = await this.getRecord();

    if (autosave !== 'true') return;

    new Cron().register('save', this.save.bind(this), saveInterval);
  }

  async create(): Promise<Record<string, unknown>> {
    const { rootPath } = config as unknown as DBConfig;
    const { file, mode } = (config as unknown as DBConfig).orm.db;

    if (mode === 'directory') {
      const dirPath = this.getDirPath();
      const collectionKeys = this.getCollectionKeys();

      await createDirectory(dirPath);

      await Promise.all(collectionKeys.map(key =>
        createFile(path.join(dirPath, `${key}.json`), [], { json: true })
      ));

      // Write empty-array skeleton to db.json
      const skeleton: Record<string, unknown[]> = {};
      for (const key of collectionKeys) skeleton[key] = [];

      await createFile(`${rootPath}/${file}`, skeleton, { json: true });

      return skeleton;
    }

    createFile(`${rootPath}/${file}`, {}, { json: true });

    return {};
  }

  async save(): Promise<void> {
    const { file, mode } = (config as unknown as DBConfig).orm.db;
    const jsonData = this.record.format() as Record<string, unknown>;
    delete jsonData.id; // Don't save id

    if (mode === 'directory') {
      const dirPath = this.getDirPath();
      const collectionKeys = this.getCollectionKeys();

      // Write each collection to its own file in parallel
      // Use createFile for new files, updateFile for existing ones
      await Promise.all(collectionKeys.map(async key => {
        const filePath = path.join(dirPath, `${key}.json`);
        const exists = await fileExists(filePath);
        const data = jsonData[key] || [];

        if (exists) await updateFile(filePath, data, { json: true });
        else await createFile(filePath, data, { json: true });
      }));

      // Write empty-array skeleton to db.json
      const skeleton: Record<string, unknown[]> = {};
      for (const key of collectionKeys) skeleton[key] = [];

      const dbFilePath = `${(config as unknown as DBConfig).rootPath}/${file}`;
      const dbFileExists = await fileExists(dbFilePath);

      if (dbFileExists) await updateFile(dbFilePath, skeleton, { json: true });
      else await createFile(dbFilePath, skeleton, { json: true });

      log.db!(`DB has been successfully saved to ${(config as unknown as DBConfig).orm.db.directory}/ directory`);
      return;
    }

    await updateFile(`${(config as unknown as DBConfig).rootPath}/${file}`, jsonData, { json: true });

    log.db!(`DB has been successfully saved to ${file}`);
  }

  async getRecord(): Promise<DBRecord> {
    const { mode } = (config as unknown as DBConfig).orm.db;

    if (mode === 'directory') return this.getRecordFromDirectory();

    return this.getRecordFromFile();
  }

  async getRecordFromFile(): Promise<DBRecord> {
    const { file } = (config as unknown as DBConfig).orm.db;

    const data = await readFile(file, { json: true, missingFileCallback: this.create.bind(this) });

    return createRecord(dbKey, data as Record<string, unknown>, { isDbRecord: true, serialize: false, transform: false }) as unknown as DBRecord;
  }

  async getRecordFromDirectory(): Promise<DBRecord> {
    const dirPath = this.getDirPath();
    const collectionKeys = this.getCollectionKeys();
    const dirExists = await fileExists(dirPath);

    if (!dirExists) {
      const data = await this.create();
      return createRecord(dbKey, data, { isDbRecord: true, serialize: false, transform: false }) as unknown as DBRecord;
    }

    const assembled: Record<string, unknown> = {};

    await Promise.all(collectionKeys.map(async key => {
      const filePath = path.join(dirPath, `${key}.json`);
      const exists = await fileExists(filePath);

      assembled[key] = exists ? await readFile(filePath, { json: true }) : [];
    }));

    return createRecord(dbKey, assembled, { isDbRecord: true, serialize: false, transform: false }) as unknown as DBRecord;
  }
}
