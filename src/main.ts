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
import type { AccessFunction } from './types/orm-types.js';

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

export interface PersistErrorDetail {
  operation: 'create' | 'update' | 'delete';
  modelName: string;
  recordId: unknown;
  error: Error;
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

  /**
   * Model name -> that model's `access` predicate (abofs/stonyx-orm#202).
   *
   * Populated by `setup-rest-server.ts` at boot, from the access classes under
   * `config.orm.paths.access`, BEFORE any route is mounted -- so it is complete
   * and reachable before the first request can be served. The mapping is
   * one-to-one by construction: setup-rest-server throws if two access classes
   * claim the same model.
   *
   * Keys are model names as declared and stored (kebab-case, e.g.
   * `'phone-number'`), NOT pluralised or mount-prefixed route names.
   *
   * WHY THIS EXISTS AS A FIELD. It used to be a function-local in
   * setup-rest-server that was discarded when that function returned, so at
   * request time there was no way to get from a model name to that model's
   * predicate at all. Each `OrmRequest` held only its OWN model's predicate.
   * That made cross-model authorization -- asking model X's predicate about a
   * request routed to model Y -- inexpressible, which is the capability
   * abofs/stonyx-orm#196 and abofs/stonyx-orm#207 are built on.
   *
   * Empty when the REST server is disabled, or when no access configuration
   * could be loaded. Prefer {@link Orm#getAccess} over indexing this directly.
   */
  accessFiles: Record<string, AccessFunction> = {};

  options!: OrmOptions;
  sqlDb?: SqlDb;
  db?: OrmDB | SqlDb;

  private _persistErrorHandler: ((detail: PersistErrorDetail) => void) | null = null;

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
    // Self-register so log.db works even when @stonyx/orm is in the
    // consumer's `dependencies` (stonyx loader only merges devDependencies).
    const { logColor = 'white', logMethod = 'db' } = config.orm;
    log.defineType(logMethod, logColor);

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
    } else if (config.orm.dynamodb) {
      const { default: DynamoDBDB } = await import('./dynamodb/dynamodb-db.js');
      this.sqlDb = new DynamoDBDB() as SqlDb;
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

  /**
   * Resolve a model's `access` predicate by model name (abofs/stonyx-orm#202).
   *
   * This is the supported way to reach another model's predicate while
   * servicing a request routed to a different model. Call it with the model
   * name and invoke the result with the live request and an explicit context
   * naming THAT model:
   *
   * ```js
   * const predicate = Orm.instance.getAccess('animal');
   * const verdict = predicate?.(request, { model: 'animal', operation: 'read' });
   * ```
   *
   * Passing the context is not optional in practice. A predicate that
   * identifies its collection from the request would otherwise answer about the
   * collection the request is ADDRESSED TO -- owners -- while being asked about
   * animals, and per #202's thesis it answers wrong in the granting direction.
   *
   * OWN PROPERTIES ONLY. A bare `this.accessFiles[modelName]` walks the
   * prototype chain, so `getAccess('constructor')` resolved `Object` and
   * `getAccess('toString')` resolved `Object.prototype.toString` -- both
   * callable, and the documented `predicate?.(request, ctx)` pattern then
   * returned a TRUTHY value (`Object(request)` is the request), bypassing the
   * `undefined`-means-deny contract entirely. Nothing in the ORM calls
   * `getAccess` yet, so it was not exploitable as shipped -- but #207 takes the
   * model name from the REQUEST BODY (`data.relationships.<key>.data.type`),
   * which would have made a one-field body an authorization bypass. Guarded
   * here at the read point rather than by constructing the map with a null
   * prototype, because the field is public and reassignable and the guard has
   * to hold whatever object it is holding.
   *
   * @param modelName - Model name as declared and stored (kebab-case).
   * @returns The predicate, or `undefined` when no predicate could be resolved
   *   for that name. `undefined` is NOT "this model is unrestricted" -- see the
   *   note above. Treat it as deny.
   */
  getAccess(modelName: string): AccessFunction | undefined {
    if (!Object.hasOwn(this.accessFiles, modelName)) return undefined;

    return this.accessFiles[modelName];
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
   * Register a callback to be invoked when a fire-and-forget SQL persist fails.
   * Without a handler, persist errors are logged via log.error (backwards-compatible).
   */
  onPersistError(handler: ((detail: PersistErrorDetail) => void) | null): void {
    this._persistErrorHandler = handler;
  }

  /**
   * Emit a persist error to the registered handler, or fall back to log.error.
   */
  emitPersistError(detail: PersistErrorDetail): void {
    const fallbackLog = () => log.error?.(`[ORM] Failed to persist ${detail.operation} for ${detail.modelName}:${String(detail.recordId)}: ${detail.error.message}`);

    if (this._persistErrorHandler) {
      try {
        this._persistErrorHandler(detail);
      } catch (handlerError) {
        fallbackLog();
        log.error?.(`[ORM] onPersistError handler threw: ${handlerError instanceof Error ? handlerError.message : String(handlerError)}`);
      }
    } else {
      fallbackLog();
    }
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
