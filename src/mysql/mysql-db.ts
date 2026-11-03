import { getPool, closePool } from './connection.js';
import type { MysqlConfig } from './connection.js';
import { ensureMigrationsTable, getAppliedMigrations, getMigrationFiles, applyMigration, parseMigrationFile } from './migration-runner.js';
import { introspectModels, introspectViews, getTopologicalOrder, schemasToSnapshot } from './schema-introspector.js';
import type { ModelSchema, ViewSchema, SnapshotEntry } from './schema-introspector.js';
import { loadLatestSnapshot, detectSchemaDrift } from './migration-generator.js';
import { buildInsert, buildInsertMany, buildUpdate, buildDelete, buildSelect } from './query-builder.js';
import { store } from '@stonyx/orm';
import { createRecord } from '../manage-record.js';
import { confirm } from '@stonyx/utils/prompt';
import { readFile } from '@stonyx/utils/file';
import { getPluralName } from '../plural-registry.js';
import { isDbError } from '../utils.js';
import config from 'stonyx/config';
import log from 'stonyx/log';
import path from 'path';
import type { Pool } from 'mysql2/promise';
import type { OrmRecord } from '../types/orm-types.js';

interface PersistContext {
  record?: OrmRecord;
  recordId?: unknown;
  oldState?: Record<string, unknown>;
  rawData?: Record<string, unknown>;
}

interface PersistResponse {
  data?: { id?: unknown };
}

interface ExecuteResult {
  insertId?: number;
}

interface QueuedWrite {
  operation: string;
  modelName: string;
  context: PersistContext;
  response: PersistResponse;
  resolve: () => void;
  reject: (error: unknown) => void;
}

interface PreparedCreate {
  write: QueuedWrite;
  modelName: string;
  record: OrmRecord;
  row: Record<string, unknown>;
  isPendingId: boolean;
}

type ExitEmitter = Pick<NodeJS.Process, 'once' | 'removeListener'>;

const MYSQL_MAX_PLACEHOLDERS = 65535;
const DEFAULT_WRITE_BATCH_SIZE = 500;
const DEFAULT_WRITE_QUEUE_LIMIT = 10000;

export class WriteQueueFullError extends Error {
  constructor(limit: number) {
    super(`MysqlDB write queue is full (${limit} queued writes, writeQueueLimit); the write was rejected`);
    this.name = 'WriteQueueFullError';
  }
}

export class WriteQueueClosedError extends Error {
  constructor() {
    super('MysqlDB is shutting down; the write was rejected');
    this.name = 'WriteQueueClosedError';
  }
}

interface OrmStore {
  get(key: string): Map<number | string, unknown> | undefined;
  get(key: string, id: number | string): unknown;
  _memoryResolver?: (modelName: string) => boolean;
  data?: Map<string, Map<number | string, unknown>>;
}

interface MysqlDBDeps {
  getPool: typeof getPool;
  closePool: typeof closePool;
  ensureMigrationsTable: typeof ensureMigrationsTable;
  getAppliedMigrations: typeof getAppliedMigrations;
  getMigrationFiles: typeof getMigrationFiles;
  applyMigration: typeof applyMigration;
  parseMigrationFile: typeof parseMigrationFile;
  introspectModels: typeof introspectModels;
  introspectViews: typeof introspectViews;
  getTopologicalOrder: typeof getTopologicalOrder;
  schemasToSnapshot: typeof schemasToSnapshot;
  loadLatestSnapshot: typeof loadLatestSnapshot;
  detectSchemaDrift: typeof detectSchemaDrift;
  buildInsert: typeof buildInsert;
  buildInsertMany: typeof buildInsertMany;
  buildUpdate: typeof buildUpdate;
  buildDelete: typeof buildDelete;
  buildSelect: typeof buildSelect;
  createRecord: typeof createRecord;
  store: OrmStore;
  confirm: typeof confirm;
  readFile: typeof readFile;
  getPluralName: typeof getPluralName;
  config: typeof config;
  log: Record<string, ((...args: unknown[]) => void) | undefined>;
  path: typeof path;
  process: ExitEmitter;
}

const defaultDeps: MysqlDBDeps = {
  getPool, closePool, ensureMigrationsTable, getAppliedMigrations,
  getMigrationFiles, applyMigration, parseMigrationFile,
  introspectModels, introspectViews, getTopologicalOrder, schemasToSnapshot,
  loadLatestSnapshot, detectSchemaDrift,
  buildInsert, buildInsertMany, buildUpdate, buildDelete, buildSelect,
  createRecord, store: store as OrmStore, confirm, readFile, getPluralName,
  config, log, path, process
};

export default class MysqlDB {
  static instance: MysqlDB | undefined;

  deps!: MysqlDBDeps;
  pool!: Pool | null;
  mysqlConfig!: MysqlConfig;

  private _queuedWrites: QueuedWrite[] = [];
  private _inFlightWrites = new Set<QueuedWrite>();
  private _drainingWrites: Promise<void> | null = null;
  private _acceptingWrites = true;
  private _exitReport: (() => void) | null = null;

  constructor(deps: Partial<MysqlDBDeps> = {}) {
    if (MysqlDB.instance) return MysqlDB.instance;
    MysqlDB.instance = this;

    this.deps = { ...defaultDeps, ...deps } as MysqlDBDeps;
    this.pool = null;
    const mysqlConfig = this.deps.config.orm.mysql;
    if (!mysqlConfig) throw new Error('MySQL configuration (config.orm.mysql) is required');
    this.mysqlConfig = mysqlConfig;
  }

  private requirePool(): Pool {
    if (!this.pool) throw new Error('MysqlDB pool not initialized — call init() first');
    return this.pool;
  }

  async init(): Promise<void> {
    this.pool = await this.deps.getPool(this.mysqlConfig);
    await this.deps.ensureMigrationsTable(this.pool, this.mysqlConfig.migrationsTable);
    await this.loadMemoryRecords();
    this._acceptingWrites = true;
    this._registerExitReport();
  }

  get writeBatchSize(): number {
    return Number(this.mysqlConfig?.writeBatchSize) || DEFAULT_WRITE_BATCH_SIZE;
  }

  get writeQueueLimit(): number {
    return Number(this.mysqlConfig?.writeQueueLimit) || DEFAULT_WRITE_QUEUE_LIMIT;
  }

  get pendingWriteCount(): number {
    return this._inFlightWrites.size + this._queuedWrites.length;
  }

  async startup(): Promise<void> {
    if (!this.mysqlConfig.migrationsDir) throw new Error('MySQL migrationsDir is required in config');
    const migrationsPath = this.deps.path.resolve(this.deps.config.rootPath, this.mysqlConfig.migrationsDir);

    // Check for pending migrations
    const applied = await this.deps.getAppliedMigrations(this.requirePool(), this.mysqlConfig.migrationsTable);
    const files = await this.deps.getMigrationFiles(migrationsPath);
    const pending = files.filter(f => !applied.includes(f));

    if (pending.length > 0) {
      this.deps.log.db?.(`${pending.length} pending migration(s) found.`);

      let shouldApply: boolean;
      if (this.mysqlConfig.autoMigrate === true) {
        shouldApply = true;
      } else if (this.mysqlConfig.autoMigrate === false) {
        shouldApply = false;
        this.deps.log.warn?.(`autoMigrate is false — skipping ${pending.length} pending migration(s).`);
      } else {
        shouldApply = await this.deps.confirm(`${pending.length} pending migration(s) found. Apply now?`);
      }

      if (shouldApply) {
        for (const filename of pending) {
          const content = await this.deps.readFile(this.deps.path.join(migrationsPath, filename)) as string;
          const { up } = this.deps.parseMigrationFile(content);

          await this.deps.applyMigration(this.requirePool(), filename, up, this.mysqlConfig.migrationsTable);
          this.deps.log.db?.(`Applied migration: ${filename}`);
        }

        // Reload records after applying migrations
        await this.loadMemoryRecords();
      } else {
        this.deps.log.warn?.('Skipping pending migrations. Schema may be outdated.');
      }
    } else if (files.length === 0) {
      const schemas = this.deps.introspectModels();
      const modelCount = Object.keys(schemas).length;

      if (modelCount > 0) {
        let shouldGenerate: boolean;
        if (this.mysqlConfig.autoMigrate === true) {
          shouldGenerate = true;
        } else if (this.mysqlConfig.autoMigrate === false) {
          shouldGenerate = false;
          this.deps.log.warn?.(`autoMigrate is false — skipping initial migration generation for ${modelCount} model(s).`);
        } else {
          shouldGenerate = await this.deps.confirm(
            `No migrations found but ${modelCount} model(s) detected. Generate and apply initial migration?`
          );
        }

        if (shouldGenerate) {
          const { generateMigration } = await import('./migration-generator.js');
          const result = await generateMigration('initial_setup');

          if (result) {
            const { up } = this.deps.parseMigrationFile(result.content);
            await this.deps.applyMigration(this.requirePool(), result.filename, up, this.mysqlConfig.migrationsTable);
            this.deps.log.db?.(`Applied migration: ${result.filename}`);
            await this.loadMemoryRecords();
          }
        } else {
          this.deps.log.warn?.('Skipping initial migration. Tables may not exist.');
        }
      }
    }

    // Check for schema drift
    const schemas = this.deps.introspectModels();
    if (!this.mysqlConfig.migrationsDir) throw new Error('MySQL migrationsDir is required in config');
    const snapshot = await this.deps.loadLatestSnapshot(this.deps.path.resolve(this.deps.config.rootPath, this.mysqlConfig.migrationsDir)) as Record<string, SnapshotEntry>;

    if (Object.keys(snapshot).length > 0) {
      const drift = this.deps.detectSchemaDrift(schemas, snapshot);

      if (drift.hasChanges) {
        this.deps.log.warn?.('Schema drift detected: models have changed since the last migration.');
        this.deps.log.warn?.('Run `stonyx db:generate-migration` to create a new migration.');
      }
    }
  }

  async shutdown(): Promise<void> {
    this._acceptingWrites = false;
    while (this._drainingWrites) await this._drainingWrites;
    this._unregisterExitReport();
    await this.deps.closePool();
    this.pool = null;
  }

  private _registerExitReport(): void {
    if (this._exitReport) return;
    this._exitReport = () => this._reportUnpersistedWrites();
    this.deps.process.once('exit', this._exitReport);
  }

  private _unregisterExitReport(): void {
    if (!this._exitReport) return;
    this.deps.process.removeListener('exit', this._exitReport);
    this._exitReport = null;
  }

  private _reportUnpersistedWrites(): void {
    const lostWrites = [...this._inFlightWrites, ...this._queuedWrites];
    if (lostWrites.length === 0) return;

    const lostByModel = new Map<string, number>();
    for (const { modelName } of lostWrites) lostByModel.set(modelName, (lostByModel.get(modelName) ?? 0) + 1);
    const breakdown = [...lostByModel].map(([modelName, count]) => `${modelName}: ${count}`).join(', ');

    this.deps.log.error?.(`[MysqlDB] Process exiting with ${lostWrites.length} queued write(s) not persisted; they are lost (${breakdown})`);
  }

  async save(): Promise<void> {
    // No-op: MySQL persists data immediately via persist()
  }

  /**
   * Loads only models with memory: true into the in-memory store on startup.
   * Models with memory: false are skipped — accessed on-demand via find()/findAll().
   */
  async loadMemoryRecords(): Promise<void> {
    const schemas = this.deps.introspectModels();
    const order = this.deps.getTopologicalOrder(schemas);
    const Orm = (await import('@stonyx/orm')).default;

    for (const modelName of order) {
      // Check the model's memory flag — skip non-memory models
      const { modelClass } = Orm.instance.getRecordClasses(modelName) as { modelClass?: { memory?: boolean } };
      if (modelClass?.memory === false) {
        this.deps.log.db?.(`Skipping memory load for '${modelName}' (memory: false)`);
        continue;
      }

      const schema = schemas[modelName];
      const { sql, values } = this.deps.buildSelect(schema.table);

      try {
        const result = await this.requirePool().execute(sql, values);
        const rows = result[0] as Record<string, unknown>[];

        for (const row of rows) {
          const rawData = this._rowToRawData(row, schema);
          this.deps.createRecord(modelName, rawData, { isDbRecord: true, serialize: false, transform: false });
        }
      } catch (error) {
        // Table may not exist yet (pre-migration) — skip gracefully
        if (isDbError(error) && error.code === 'ER_NO_SUCH_TABLE') {
          this.deps.log.db?.(`Table '${schema.table}' does not exist yet. Skipping load for '${modelName}'.`);
          continue;
        }

        throw error;
      }
    }

    // Load views with memory: true
    const viewSchemas = this.deps.introspectViews();

    for (const [viewName, viewSchema] of Object.entries(viewSchemas)) {
      const { modelClass: viewClass } = Orm.instance.getRecordClasses(viewName) as { modelClass?: { memory?: boolean } };
      if (viewClass?.memory !== true) {
        this.deps.log.db?.(`Skipping memory load for view '${viewName}' (memory: false)`);
        continue;
      }

      const schema = { table: viewSchema.viewName, columns: viewSchema.columns || {}, foreignKeys: viewSchema.foreignKeys || {} };
      const { sql, values } = this.deps.buildSelect(schema.table);

      try {
        const result = await this.requirePool().execute(sql, values);
        const rows = result[0] as Record<string, unknown>[];

        for (const row of rows) {
          const rawData = this._rowToRawData(row, schema);
          this.deps.createRecord(viewName, rawData, { isDbRecord: true, serialize: false, transform: false });
        }
      } catch (error) {
        if (isDbError(error) && error.code === 'ER_NO_SUCH_TABLE') {
          this.deps.log.db?.(`View '${viewSchema.viewName}' does not exist yet. Skipping load for '${viewName}'.`);
          continue;
        }
        throw error;
      }
    }
  }

  /**
   * @deprecated Use loadMemoryRecords() instead. Kept for backward compatibility.
   */
  async loadAllRecords(): Promise<void> {
    return this.loadMemoryRecords();
  }

  /**
   * Find a single record by ID from MySQL.
   * Does NOT cache the result in the store for memory: false models.
   */
  async findRecord(modelName: string, id: string | number): Promise<OrmRecord | undefined> {
    const schemas = this.deps.introspectModels();
    let schema: { table: string; columns: Record<string, string>; foreignKeys: Record<string, unknown> } | undefined = schemas[modelName];

    // Check views if not found in models
    if (!schema) {
      const viewSchemas = this.deps.introspectViews();
      const viewSchema = viewSchemas[modelName];
      if (viewSchema) {
        schema = { table: viewSchema.viewName, columns: viewSchema.columns || {}, foreignKeys: viewSchema.foreignKeys || {} };
      }
    }

    if (!schema) return undefined;

    const { sql, values } = this.deps.buildSelect(schema.table, { id });

    try {
      const result = await this.requirePool().execute(sql, values);
      const rows = result[0] as Record<string, unknown>[];

      if (rows.length === 0) return undefined;

      const rawData = this._rowToRawData(rows[0], schema);
      const record = this.deps.createRecord(modelName, rawData, { isDbRecord: true, serialize: false, transform: false }) as unknown as OrmRecord;

      // Don't let memory:false records accumulate in the store
      // The caller keeps the reference; the store doesn't retain it
      this._evictIfNotMemory(modelName, record);

      return record;
    } catch (error) {
      if (isDbError(error) && error.code === 'ER_NO_SUCH_TABLE') return undefined;
      throw error;
    }
  }

  /**
   * Find all records of a model from MySQL, with optional conditions.
   */
  async findAll(modelName: string, conditions?: Record<string, unknown>): Promise<OrmRecord[]> {
    const schemas = this.deps.introspectModels();
    let schema: { table: string; columns: Record<string, string>; foreignKeys: Record<string, unknown> } | undefined = schemas[modelName];

    // Check views if not found in models
    if (!schema) {
      const viewSchemas = this.deps.introspectViews();
      const viewSchema = viewSchemas[modelName];
      if (viewSchema) {
        schema = { table: viewSchema.viewName, columns: viewSchema.columns || {}, foreignKeys: viewSchema.foreignKeys || {} };
      }
    }

    if (!schema) return [];

    const resolvedSchema = schema;
    const { sql, values } = this.deps.buildSelect(resolvedSchema.table, conditions);

    try {
      const result = await this.requirePool().execute(sql, values);
      const rows = result[0] as Record<string, unknown>[];

      const records = rows.map(row => {
        const rawData = this._rowToRawData(row, resolvedSchema);
        return this.deps.createRecord(modelName, rawData, { isDbRecord: true, serialize: false, transform: false }) as unknown as OrmRecord;
      });

      // Don't let memory:false records accumulate in the store
      for (const record of records) {
        this._evictIfNotMemory(modelName, record);
      }

      return records;
    } catch (error) {
      if (isDbError(error) && error.code === 'ER_NO_SUCH_TABLE') return [];
      throw error;
    }
  }

  /**
   * Remove a record from the in-memory store if its model has memory: false.
   * The record object itself survives — the caller retains the reference.
   * This prevents on-demand queries from leaking records into the store.
   */
  private _evictIfNotMemory(modelName: string, record: OrmRecord): void {
    const storeRef = this.deps.store;

    // Use the memory resolver if available (set by Orm.init)
    if (storeRef._memoryResolver && !storeRef._memoryResolver(modelName)) {
      const modelStore = (storeRef.get?.(modelName) ?? storeRef.data?.get(modelName)) as Map<unknown, unknown> | undefined;
      if (modelStore) modelStore.delete(record.id);
    }
  }

  private _rowToRawData(row: Record<string, unknown>, schema: { columns: Record<string, string>; foreignKeys: Record<string, unknown> }): Record<string, unknown> {
    const rawData: Record<string, unknown> = { ...row };

    for (const [col, mysqlType] of Object.entries(schema.columns)) {
      if (rawData[col] == null) continue;

      // Convert boolean columns from MySQL TINYINT(1) 0/1 to false/true
      if (mysqlType === 'TINYINT(1)') {
        rawData[col] = !!rawData[col];
      }

      // Parse JSON columns back to JS values (custom transforms stored as JSON)
      if (mysqlType === 'JSON' && typeof rawData[col] === 'string') {
        try { rawData[col] = JSON.parse(rawData[col] as string); } catch { /* keep raw string */ }
      }
    }

    // Map FK columns back to relationship keys
    // e.g., owner_id -> owner (the belongsTo handler expects the id value under the relationship key name)
    for (const fkCol of Object.keys(schema.foreignKeys)) {
      const relName = fkCol.replace(/_id$/, '');

      if (rawData[fkCol] !== undefined) {
        rawData[relName] = rawData[fkCol];
        delete rawData[fkCol];
      }
    }

    // Remove timestamp columns — managed by MySQL
    delete rawData.created_at;
    delete rawData.updated_at;

    return rawData;
  }

  async persist(operation: string, modelName: string, context: PersistContext, response: PersistResponse): Promise<void> {
    const Orm = (await import('@stonyx/orm')).default;
    if ((Orm as unknown as { instance?: { isView?: (name: string) => boolean } }).instance?.isView?.(modelName)) return;

    if (!this._acceptingWrites) throw new WriteQueueClosedError();
    if (this._queuedWrites.length >= this.writeQueueLimit) throw new WriteQueueFullError(this.writeQueueLimit);

    return new Promise<void>((resolve, reject) => {
      const write: QueuedWrite = {
        operation, modelName, context, response,
        resolve: () => {
          this._inFlightWrites.delete(write);
          resolve();
        },
        reject: (error: unknown) => {
          this._inFlightWrites.delete(write);
          reject(error);
        },
      };
      this._queuedWrites.push(write);
      this._drainWritesInBackground();
    });
  }

  private _drainWritesInBackground(): void {
    if (this._drainingWrites) return;
    this._drainingWrites = this._drainQueuedWrites().finally(() => {
      this._drainingWrites = null;
    });
  }

  private async _drainQueuedWrites(): Promise<void> {
    while (this._queuedWrites.length > 0) {
      const writes = this._takeNextWriteGroup();
      writes.forEach(write => this._inFlightWrites.add(write));
      try {
        await this._executeWriteGroup(writes);
      } catch (error) {
        writes.filter(write => this._inFlightWrites.has(write)).forEach(write => write.reject(error));
      }
    }
  }

  private _takeNextWriteGroup(): QueuedWrite[] {
    const [first] = this._queuedWrites;
    let groupSize = 1;

    if (first.operation === 'create') {
      while (
        groupSize < this.writeBatchSize
        && groupSize < this._queuedWrites.length
        && this._queuedWrites[groupSize].operation === 'create'
        && this._queuedWrites[groupSize].modelName === first.modelName
      ) groupSize++;
    }

    return this._queuedWrites.splice(0, groupSize);
  }

  private async _executeWriteGroup(writes: QueuedWrite[]): Promise<void> {
    const [first] = writes;
    if (first.operation === 'create') return this._persistCreates(first.modelName, writes);

    try {
      if (first.operation === 'update') await this._persistUpdate(first.modelName, first.context, first.response);
      if (first.operation === 'delete') await this._persistDelete(first.modelName, first.context);
      first.resolve();
    } catch (error) {
      first.reject(error);
    }
  }

  private async _persistCreates(modelName: string, writes: QueuedWrite[]): Promise<void> {
    const schema = this.deps.introspectModels()[modelName];
    const prepared: PreparedCreate[] = [];

    for (const write of writes) {
      try {
        const create = schema ? this._prepareCreate(modelName, schema, write) : null;
        if (create) prepared.push(create);
        else write.resolve();
      } catch (error) {
        write.reject(error);
      }
    }

    for (const chunk of this._chunkForSingleInsert(prepared)) {
      await this._insertCreates(schema, chunk);
    }
  }

  private _prepareCreate(modelName: string, schema: ModelSchema, write: QueuedWrite): PreparedCreate | null {
    const { context, response } = write;
    const recordId = response?.data?.id;
    const record = recordId != null ? this.deps.store.get(modelName, (isNaN(recordId as number) ? recordId : parseInt(recordId as string)) as number | string) as OrmRecord | null : null;

    if (!record) return null;

    const row = this._recordToRow(record, schema);
    const isPendingId = context.rawData?.__pendingSqlId === true;

    if (isPendingId) delete row.id;

    return { write, modelName, record, row, isPendingId };
  }

  private _chunkForSingleInsert(prepared: PreparedCreate[]): PreparedCreate[][] {
    const chunks: PreparedCreate[][] = [];
    let chunk: PreparedCreate[] = [];
    let chunkColumns = new Set<string>();

    for (const create of prepared) {
      const columnsWithCreate = new Set([...chunkColumns, ...Object.keys(create.row)]);
      const mixesIdSources = chunk.length > 0 && chunk[0].isPendingId !== create.isPendingId;
      const exceedsPlaceholders = (chunk.length + 1) * columnsWithCreate.size > MYSQL_MAX_PLACEHOLDERS;

      if (chunk.length > 0 && (mixesIdSources || exceedsPlaceholders)) {
        chunks.push(chunk);
        chunk = [];
        chunkColumns = new Set(Object.keys(create.row));
      } else {
        chunkColumns = columnsWithCreate;
      }

      chunk.push(create);
    }

    if (chunk.length > 0) chunks.push(chunk);
    return chunks;
  }

  private async _insertCreates(schema: ModelSchema, creates: PreparedCreate[]): Promise<void> {
    if (creates.length === 1) return this._insertCreatesOneByOne(schema, creates);

    let firstInsertId: number | undefined;

    try {
      const { sql, values } = this.deps.buildInsertMany(schema.table, creates.map(({ row }) => row));
      const [result] = await this.requirePool().execute(sql, values) as [ExecuteResult, unknown];
      firstInsertId = result.insertId;
    } catch {
      return this._insertCreatesOneByOne(schema, creates);
    }

    creates.forEach((create, index) => {
      if (firstInsertId) this._adoptGeneratedId(create, firstInsertId + index);
      create.write.resolve();
    });
  }

  private async _insertCreatesOneByOne(schema: ModelSchema, creates: PreparedCreate[]): Promise<void> {
    for (const create of creates) {
      try {
        const { sql, values } = this.deps.buildInsert(schema.table, create.row);
        const [result] = await this.requirePool().execute(sql, values) as [ExecuteResult, unknown];
        if (result.insertId) this._adoptGeneratedId(create, result.insertId);
        create.write.resolve();
      } catch (error) {
        create.write.reject(error);
      }
    }
  }

  private _adoptGeneratedId({ modelName, record, isPendingId, write }: PreparedCreate, realId: number): void {
    if (!isPendingId) return;

    const pendingId = record.id;
    const modelStore = this.deps.store.get(modelName);
    if (!modelStore) throw new Error(`Model "${modelName}" not found in store during ID re-key`);

    modelStore.delete(pendingId as number | string);
    record.__data.id = realId;
    record.id = realId;
    modelStore.set(realId, record);

    if (write.response?.data) write.response.data.id = realId;

    delete record.__data.__pendingSqlId;
  }

  private async _persistUpdate(modelName: string, context: PersistContext, response: PersistResponse): Promise<void> {
    const schemas = this.deps.introspectModels();
    const schema = schemas[modelName];

    if (!schema) return;

    const record = context.record;
    if (!record) return;

    const id = record.id;
    const oldState = context.oldState || {};
    const currentData = record.__data;

    // Build a diff of changed columns
    const changedData: Record<string, unknown> = {};

    for (const [col] of Object.entries(schema.columns)) {
      if (currentData[col] !== oldState[col]) {
        changedData[col] = currentData[col] ?? null;
      }
    }

    // Check FK changes too
    for (const fkCol of Object.keys(schema.foreignKeys)) {
      const relName = fkCol.replace(/_id$/, '');
      const currentFkValue = (record.__relationships[relName] as { id: unknown } | undefined)?.id ?? null;
      const oldFkValue = oldState[relName] ?? null;

      if (currentFkValue !== oldFkValue) {
        changedData[fkCol] = currentFkValue;
      }
    }

    if (Object.keys(changedData).length === 0) return;

    const { sql, values } = this.deps.buildUpdate(schema.table, id, changedData);
    await this.requirePool().execute(sql, values);
  }

  private async _persistDelete(modelName: string, context: PersistContext): Promise<void> {
    const schemas = this.deps.introspectModels();
    const schema = schemas[modelName];

    if (!schema) return;

    const id = context.recordId;
    if (id == null) return;

    const { sql, values } = this.deps.buildDelete(schema.table, id);
    await this.requirePool().execute(sql, values);
  }

  private _recordToRow(record: OrmRecord, schema: ModelSchema): Record<string, unknown> {
    const row: Record<string, unknown> = {};
    const data = record.__data;

    // ID
    if (data.id !== undefined) {
      row.id = data.id;
    }

    // Attribute columns
    for (const [col, mysqlType] of Object.entries(schema.columns)) {
      if (data[col] !== undefined) {
        // JSON columns: stringify non-string values for MySQL JSON storage
        row[col] = mysqlType === 'JSON' && typeof data[col] !== 'string'
          ? JSON.stringify(data[col])
          : data[col];
      }
    }

    // FK columns from relationships
    for (const fkCol of Object.keys(schema.foreignKeys)) {
      const relName = fkCol.replace(/_id$/, '');
      const related = record.__relationships[relName];

      if (related) {
        row[fkCol] = (related as { id: unknown }).id;
      } else if (data[relName] !== undefined) {
        // Raw FK value (e.g., from create payload)
        row[fkCol] = data[relName];
      }
    }

    return row;
  }
}
