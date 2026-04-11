import { getPool, closePool } from './connection.js';
import type { MysqlConfig } from './connection.js';
import { ensureMigrationsTable, getAppliedMigrations, getMigrationFiles, applyMigration, parseMigrationFile } from './migration-runner.js';
import { introspectModels, introspectViews, getTopologicalOrder, schemasToSnapshot } from './schema-introspector.js';
import type { ModelSchema, ViewSchema, SnapshotEntry } from './schema-introspector.js';
import { loadLatestSnapshot, detectSchemaDrift } from './migration-generator.js';
import { buildInsert, buildUpdate, buildDelete, buildSelect } from './query-builder.js';
import { store } from '../main.js';
import { createRecord } from '../manage-record.js';
import { confirm } from '@stonyx/utils/prompt';
import { readFile } from '@stonyx/utils/file';
import { getPluralName } from '../plural-registry.js';
import config from 'stonyx/config';
import log from 'stonyx/log';
import path from 'path';
import type { Pool } from 'mysql2/promise';

interface OrmRecord {
  id: unknown;
  __data: Record<string, unknown> & { id?: unknown; __pendingSqlId?: boolean };
  __relationships: Record<string, { id: unknown } | undefined>;
}

interface PersistContext {
  record?: OrmRecord;
  recordId?: unknown;
  oldState?: Record<string, unknown>;
}

interface PersistResponse {
  data?: { id?: unknown };
}

interface ExecuteResult {
  insertId?: number;
}

interface OrmStore {
  get(modelName: string, id?: unknown): unknown;
  _memoryResolver?: (modelName: string) => boolean;
  data?: Map<string, Map<unknown, unknown>>;
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
  buildUpdate: typeof buildUpdate;
  buildDelete: typeof buildDelete;
  buildSelect: typeof buildSelect;
  createRecord: typeof createRecord;
  store: OrmStore;
  confirm: typeof confirm;
  readFile: typeof readFile;
  getPluralName: typeof getPluralName;
  config: Record<string, unknown> & { orm: { mysql: MysqlConfig }; rootPath: string };
  log: Record<string, ((...args: unknown[]) => void) | undefined>;
  path: typeof path;
}

const defaultDeps: MysqlDBDeps = {
  getPool, closePool, ensureMigrationsTable, getAppliedMigrations,
  getMigrationFiles, applyMigration, parseMigrationFile,
  introspectModels, introspectViews, getTopologicalOrder, schemasToSnapshot,
  loadLatestSnapshot, detectSchemaDrift,
  buildInsert, buildUpdate, buildDelete, buildSelect,
  createRecord, store: store as unknown as OrmStore, confirm, readFile, getPluralName,
  config: config as unknown as MysqlDBDeps['config'], log, path
};

export default class MysqlDB {
  static instance: MysqlDB | undefined;

  deps!: MysqlDBDeps;
  pool!: Pool | null;
  mysqlConfig!: MysqlConfig;

  constructor(deps: Partial<MysqlDBDeps> = {}) {
    if (MysqlDB.instance) return MysqlDB.instance;
    MysqlDB.instance = this;

    this.deps = { ...defaultDeps, ...deps } as MysqlDBDeps;
    this.pool = null;
    this.mysqlConfig = this.deps.config.orm.mysql;
  }

  async init(): Promise<void> {
    this.pool = await this.deps.getPool(this.mysqlConfig);
    await this.deps.ensureMigrationsTable(this.pool, this.mysqlConfig.migrationsTable);
    await this.loadMemoryRecords();
  }

  async startup(): Promise<void> {
    const migrationsPath = this.deps.path.resolve(this.deps.config.rootPath, this.mysqlConfig.migrationsDir!);

    // Check for pending migrations
    const applied = await this.deps.getAppliedMigrations(this.pool!, this.mysqlConfig.migrationsTable);
    const files = await this.deps.getMigrationFiles(migrationsPath);
    const pending = files.filter(f => !applied.includes(f));

    if (pending.length > 0) {
      this.deps.log.db!(`${pending.length} pending migration(s) found.`);

      const shouldApply = await this.deps.confirm(`${pending.length} pending migration(s) found. Apply now?`);

      if (shouldApply) {
        for (const filename of pending) {
          const content = await this.deps.readFile(this.deps.path.join(migrationsPath, filename)) as string;
          const { up } = this.deps.parseMigrationFile(content);

          await this.deps.applyMigration(this.pool!, filename, up, this.mysqlConfig.migrationsTable);
          this.deps.log.db!(`Applied migration: ${filename}`);
        }

        // Reload records after applying migrations
        await this.loadMemoryRecords();
      } else {
        this.deps.log.warn!('Skipping pending migrations. Schema may be outdated.');
      }
    } else if (files.length === 0) {
      const schemas = this.deps.introspectModels();
      const modelCount = Object.keys(schemas).length;

      if (modelCount > 0) {
        const shouldGenerate = await this.deps.confirm(
          `No migrations found but ${modelCount} model(s) detected. Generate and apply initial migration?`
        );

        if (shouldGenerate) {
          const { generateMigration } = await import('./migration-generator.js');
          const result = await generateMigration('initial_setup');

          if (result) {
            const { up } = this.deps.parseMigrationFile(result.content);
            await this.deps.applyMigration(this.pool!, result.filename, up, this.mysqlConfig.migrationsTable);
            this.deps.log.db!(`Applied migration: ${result.filename}`);
            await this.loadMemoryRecords();
          }
        } else {
          this.deps.log.warn!('Skipping initial migration. Tables may not exist.');
        }
      }
    }

    // Check for schema drift
    const schemas = this.deps.introspectModels();
    const snapshot = await this.deps.loadLatestSnapshot(this.deps.path.resolve(this.deps.config.rootPath, this.mysqlConfig.migrationsDir!)) as Record<string, SnapshotEntry>;

    if (Object.keys(snapshot).length > 0) {
      const drift = this.deps.detectSchemaDrift(schemas, snapshot);

      if (drift.hasChanges) {
        this.deps.log.warn!('Schema drift detected: models have changed since the last migration.');
        this.deps.log.warn!('Run `stonyx db:generate-migration` to create a new migration.');
      }
    }
  }

  async shutdown(): Promise<void> {
    await this.deps.closePool();
    this.pool = null;
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
        this.deps.log.db!(`Skipping memory load for '${modelName}' (memory: false)`);
        continue;
      }

      const schema = schemas[modelName];
      const { sql, values } = this.deps.buildSelect(schema.table);

      try {
        const [rows] = await this.pool!.execute(sql, values) as [Record<string, unknown>[], unknown];

        for (const row of rows) {
          const rawData = this._rowToRawData(row, schema);
          this.deps.createRecord(modelName, rawData, { isDbRecord: true, serialize: false, transform: false });
        }
      } catch (error) {
        // Table may not exist yet (pre-migration) — skip gracefully
        if ((error as { code?: string }).code === 'ER_NO_SUCH_TABLE') {
          this.deps.log.db!(`Table '${schema.table}' does not exist yet. Skipping load for '${modelName}'.`);
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
        this.deps.log.db!(`Skipping memory load for view '${viewName}' (memory: false)`);
        continue;
      }

      const schema = { table: viewSchema.viewName, columns: viewSchema.columns || {}, foreignKeys: viewSchema.foreignKeys || {} };
      const { sql, values } = this.deps.buildSelect(schema.table);

      try {
        const [rows] = await this.pool!.execute(sql, values) as [Record<string, unknown>[], unknown];

        for (const row of rows) {
          const rawData = this._rowToRawData(row, schema);
          this.deps.createRecord(viewName, rawData, { isDbRecord: true, serialize: false, transform: false });
        }
      } catch (error) {
        if ((error as { code?: string }).code === 'ER_NO_SUCH_TABLE') {
          this.deps.log.db!(`View '${viewSchema.viewName}' does not exist yet. Skipping load for '${viewName}'.`);
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
      const [rows] = await this.pool!.execute(sql, values) as [Record<string, unknown>[], unknown];

      if (rows.length === 0) return undefined;

      const rawData = this._rowToRawData(rows[0], schema);
      const record = this.deps.createRecord(modelName, rawData, { isDbRecord: true, serialize: false, transform: false }) as unknown as OrmRecord;

      // Don't let memory:false records accumulate in the store
      // The caller keeps the reference; the store doesn't retain it
      this._evictIfNotMemory(modelName, record);

      return record;
    } catch (error) {
      if ((error as { code?: string }).code === 'ER_NO_SUCH_TABLE') return undefined;
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

    const { sql, values } = this.deps.buildSelect(schema.table, conditions);

    try {
      const [rows] = await this.pool!.execute(sql, values) as [Record<string, unknown>[], unknown];

      const records = rows.map(row => {
        const rawData = this._rowToRawData(row, schema!);
        return this.deps.createRecord(modelName, rawData, { isDbRecord: true, serialize: false, transform: false }) as unknown as OrmRecord;
      });

      // Don't let memory:false records accumulate in the store
      for (const record of records) {
        this._evictIfNotMemory(modelName, record);
      }

      return records;
    } catch (error) {
      if ((error as { code?: string }).code === 'ER_NO_SUCH_TABLE') return [];
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

  _rowToRawData(row: Record<string, unknown>, schema: { columns: Record<string, string>; foreignKeys: Record<string, unknown> }): Record<string, unknown> {
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
    // Views are read-only — no-op for all write operations
    const Orm = (await import('@stonyx/orm')).default;
    if ((Orm as unknown as { instance?: { isView?: (name: string) => boolean } }).instance?.isView?.(modelName)) return;

    switch (operation) {
      case 'create':
        return this._persistCreate(modelName, context, response);
      case 'update':
        return this._persistUpdate(modelName, context, response);
      case 'delete':
        return this._persistDelete(modelName, context);
    }
  }

  private async _persistCreate(modelName: string, context: PersistContext, response: PersistResponse): Promise<void> {
    const schemas = this.deps.introspectModels();
    const schema = schemas[modelName];

    if (!schema) return;

    const recordId = response?.data?.id;
    const record = recordId != null ? this.deps.store.get(modelName, isNaN(recordId as number) ? recordId : parseInt(recordId as string)) as OrmRecord | null : null;

    if (!record) return;

    const insertData = this._recordToRow(record, schema);

    // For auto-increment models, remove the pending ID
    const isPendingId = record.__data.__pendingSqlId;

    if (isPendingId) {
      delete insertData.id;
    } else if (insertData.id !== undefined) {
      // Keep user-provided ID (string IDs or explicit numeric IDs)
    }

    const { sql, values } = this.deps.buildInsert(schema.table, insertData);

    const [result] = await this.pool!.execute(sql, values) as [ExecuteResult, unknown];

    // Re-key the record in the store if MySQL generated the ID
    if (isPendingId && result.insertId) {
      const pendingId = record.id;
      const realId = result.insertId;
      const modelStore = this.deps.store.get(modelName) as Map<unknown, OrmRecord>;

      modelStore.delete(pendingId);
      record.__data.id = realId;
      record.id = realId;
      modelStore.set(realId, record);

      // Update the response data with the real ID
      if (response?.data) {
        response.data.id = realId;
      }

      delete record.__data.__pendingSqlId;
    }
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
      const currentFkValue = record.__relationships[relName]?.id ?? null;
      const oldFkValue = oldState[relName] ?? null;

      if (currentFkValue !== oldFkValue) {
        changedData[fkCol] = currentFkValue;
      }
    }

    if (Object.keys(changedData).length === 0) return;

    const { sql, values } = this.deps.buildUpdate(schema.table, id, changedData);
    await this.pool!.execute(sql, values);
  }

  private async _persistDelete(modelName: string, context: PersistContext): Promise<void> {
    const schemas = this.deps.introspectModels();
    const schema = schemas[modelName];

    if (!schema) return;

    const id = context.recordId;
    if (id == null) return;

    const { sql, values } = this.deps.buildDelete(schema.table, id);
    await this.pool!.execute(sql, values);
  }

  _recordToRow(record: OrmRecord, schema: ModelSchema): Record<string, unknown> {
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
        row[fkCol] = related.id;
      } else if (data[relName] !== undefined) {
        // Raw FK value (e.g., from create payload)
        row[fkCol] = data[relName];
      }
    }

    return row;
  }
}
