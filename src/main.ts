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
import { registerPluralName } from './plural-registry.js';
import setupRestServer from './setup-rest-server.js';
import baseTransforms from './transforms.js';
import Store from './store.js';
import Serializer from './serializer.js';
import { setup } from '@stonyx/events';
import type { OrmRecord } from './types/orm-types.js';
import { isOrmRecord } from './utils.js';

interface OrmOptions {
  dbType?: string;
}

export interface SqlDb {
  init(): Promise<unknown>;
  startup(): Promise<void>;
  shutdown(): Promise<void>;
  persist(operation: string, model: string, context: unknown, response: unknown): Promise<void>;
  findRecord(modelName: string, id: unknown): Promise<unknown>;
  findAll(modelName: string, conditions?: Record<string, unknown>): Promise<unknown[]>;
}

export interface OrmDB {
  record: unknown;
  save(): Promise<void>;
  init(): Promise<void>;
}

const defaultOptions: OrmOptions = {
  dbType: 'json'
}

export default class Orm {
  static initialized: boolean = false;
  static relationships: Map<string, Map<string, unknown>> = new Map();
  static store: Store = new Store();
  static instance: Orm;
  static ready: unknown[];

  models: Record<string, unknown> = {};
  serializers: Record<string, unknown> = {};
  views: Record<string, unknown> = {};
  transforms: Record<string, (value: unknown) => unknown> = { ...baseTransforms };
  warnings: Set<string> = new Set();
  options!: OrmOptions;
  sqlDb?: SqlDb;
  db?: OrmDB | SqlDb;

  constructor(options: OrmOptions = {}) {
    if (Orm.instance) return Orm.instance;

    const { relationships } = Orm;

    // Declare relationship maps
    for (const key of ['hasMany', 'belongsTo', 'global', 'pending', 'pendingBelongsTo']) {
      relationships.set(key, new Map());
    }

    this.options = { ...defaultOptions, ...options };

    Orm.instance = this;
  }

  async init(): Promise<void> {
    const { paths, restServer } = config.orm;

    const promises: Promise<unknown>[] = ['Model', 'Serializer', 'Transform'].map(type => {
      const lowerCaseType = type.toLowerCase();
      const path = paths[lowerCaseType];

      if (!path) throw new Error(`Configuration Error: ORM path for "${type}" must be defined.`);

      return forEachFileImport(path, (exported: unknown, { name }: { name: string }) => {
        // Transforms keep their original name, everything else gets converted to PascalCase with the type suffix
        const alias = type === 'Transform' ? name : `${kebabCaseToPascalCase(name)}${type}`;

        if (type === 'Model') {
          Orm.store.set(name, new Map());
          registerPluralName(name, exported as { pluralName?: string });
        }

        const collection = this[pluralize(lowerCaseType) as keyof this] as Record<string, unknown>;
        return collection[alias] = exported;
      }, { ignoreAccessFailure: true, rawName: true, recursive: true, recursiveNaming: true });
    });

    // Wait for imports before db & rest server setup
    await Promise.all(promises);

    // Discover views from paths.view (separate from model/serializer/transform)
    if (paths.view) {
      await forEachFileImport(paths.view, (exported: unknown, { name }: { name: string }) => {
        const alias = `${kebabCaseToPascalCase(name)}View`;
        Orm.store.set(name, new Map());
        registerPluralName(name, exported as { pluralName?: string });
        this.views[alias] = exported;
      }, { ignoreAccessFailure: true, rawName: true, recursive: true, recursiveNaming: true });
    }

    // Setup event names for hooks after models are loaded
    const eventNames: string[] = [];
    const operations = ['list', 'get', 'create', 'update', 'delete'];
    const viewOperations = ['list', 'get'];
    const timings = ['before', 'after'];

    for (const modelName of Orm.store.data.keys()) {
      const isView = this.isView(modelName);
      const ops = isView ? viewOperations : operations;

      for (const timing of timings) {
        for (const operation of ops) {
          eventNames.push(`${timing}:${operation}:${modelName}`);
        }
      }
    }

    setup(eventNames);

    if (config.orm.timescale) {
      const { default: TimescaleDB } = await import('./timescale/timescale-db.js');
      this.sqlDb = new TimescaleDB() as SqlDb;
      this.db = this.sqlDb;
      promises.push(this.sqlDb.init());
    } else if (config.orm.postgres) {
      const { default: PostgresDB } = await import('./postgres/postgres-db.js');
      this.sqlDb = new PostgresDB() as SqlDb;
      this.db = this.sqlDb;
      promises.push(this.sqlDb.init());
    } else if (config.orm.mysql) {
      const { default: MysqlDB } = await import('./mysql/mysql-db.js');
      this.sqlDb = new MysqlDB() as SqlDb;
      this.db = this.sqlDb;
      promises.push(this.sqlDb.init());
    } else if (this.options.dbType !== 'none') {
      const db = new DB();
      this.db = db;

      promises.push(db.init());
    }

    if (restServer.enabled === 'true') {
      promises.push(setupRestServer(restServer.route, paths.access, restServer.metaRoute));
    }

    // Wire up memory resolver so store.find() can check model memory flags
    Orm.store._memoryResolver = (modelName: string): boolean => {
      const { modelClass } = this.getRecordClasses(modelName);
      return (modelClass as { memory?: boolean })?.memory === true;
    };

    // Wire up SQL adapter reference for on-demand queries from store.find()/findAll()
    if (this.sqlDb) {
      Orm.store._sqlDb = this.sqlDb;
    }

    Orm.ready = await Promise.all(promises);
    Orm.initialized = true;
  }

  async startup(): Promise<void> {
    if (this.sqlDb) await this.sqlDb.startup();
  }

  async shutdown(): Promise<void> {
    if (this.sqlDb) await this.sqlDb.shutdown();
  }

  static get db(): OrmDB | SqlDb {
    if (!Orm.initialized) throw new Error('ORM has not been initialized yet');

    if (!Orm.instance.db) throw new Error('ORM database has not been initialized');
    return Orm.instance.db;
  }

  getRecordClasses(modelName: string): { modelClass: unknown; serializerClass: unknown } {
    const modelClassPrefix = kebabCaseToPascalCase(modelName);

    // Check views first, then models
    const viewClass = this.views[`${modelClassPrefix}View`];
    if (viewClass) {
      return {
        modelClass: viewClass,
        serializerClass: this.serializers[`${modelClassPrefix}Serializer`] || Serializer
      };
    }

    return {
      modelClass: this.models[`${modelClassPrefix}Model`],
      serializerClass: this.serializers[`${modelClassPrefix}Serializer`] || Serializer
    };
  }

  isView(modelName: string): boolean {
    const modelClassPrefix = kebabCaseToPascalCase(modelName);
    return !!this.views[`${modelClassPrefix}View`];
  }

  /**
   * Programmatic create — writes to memory AND persists to SQL database.
   * Use instead of createRecord() when records must be persisted to PostgreSQL/TimescaleDB.
   */
  static async create(modelName: string, data: Record<string, unknown> = {}): Promise<OrmRecord> {
    if (!Orm.initialized) throw new Error('ORM is not ready');

    const { createRecord } = await import('./manage-record.js');
    const record = createRecord(modelName, data, { serialize: false }) as unknown as OrmRecord;

    if (Orm.instance.sqlDb) {
      const response: { data: { id: unknown } } = { data: { id: record.id } };
      await Orm.instance.sqlDb.persist('create', modelName, { rawData: data }, response);
    }

    return record;
  }

  /**
   * Programmatic update — updates in memory AND persists to SQL database.
   * Captures old state for diff-based UPDATE queries.
   */
  static async update(modelName: string, id: string | number, data: Record<string, unknown>): Promise<OrmRecord> {
    if (!Orm.initialized) throw new Error('ORM is not ready');

    const record = Orm.store.get(modelName, id);
    if (!record || !isOrmRecord(record)) throw new Error(`Record ${modelName}:${id} not found`);

    const oldState = JSON.parse(JSON.stringify(record.__data));

    // Apply attribute updates directly, matching the REST handler pattern
    for (const [key, value] of Object.entries(data)) {
      if (key === 'id') continue;
      record[key] = value;
    }

    if (Orm.instance.sqlDb) {
      await Orm.instance.sqlDb.persist('update', modelName, { record, oldState }, {});
    }

    return record;
  }

  /**
   * Programmatic delete — removes from SQL database AND memory store.
   * SQL delete runs first to ensure consistency on failure.
   */
  static async remove(modelName: string, id: string | number): Promise<void> {
    if (!Orm.initialized) throw new Error('ORM is not ready');

    if (Orm.instance.sqlDb) {
      await Orm.instance.sqlDb.persist('delete', modelName, { recordId: id }, {});
    }

    Orm.store.remove(modelName, id);
  }

  // Queue warnings to avoid the same error from being logged in the same iteration
  warn(message: string): void {
    this.warnings.add(message);

    setTimeout(() => {
      this.warnings.forEach(warning => log.warn?.(warning));
      this.warnings.clear();
    }, 0);
  }
}

export const store = Orm.store;
export const relationships = Orm.relationships;
