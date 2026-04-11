import { getPool, closePool } from './connection.js';
import { ensureMigrationsTable, getAppliedMigrations, getMigrationFiles, applyMigration, parseMigrationFile } from './migration-runner.js';
import { introspectModels, introspectViews, getTopologicalOrder, schemasToSnapshot } from './schema-introspector.js';
import { loadLatestSnapshot, detectSchemaDrift } from './migration-generator.js';
import { buildInsert, buildUpdate, buildDelete, buildSelect, buildVectorSearch, buildHybridSearch } from './query-builder.js';
import { store } from '../main.js';
import { createRecord } from '../manage-record.js';
import { confirm } from '@stonyx/utils/prompt';
import { readFile } from '@stonyx/utils/file';
import { getPluralName } from '../plural-registry.js';
import { isDbError } from '../utils.js';
import config from 'stonyx/config';
import log from 'stonyx/log';
import path from 'path';
import type { Pool } from 'pg';
import type { ForeignKeyDef, ModelSchema, OrmRecord } from '../types/orm-types.js';

interface PersistContext {
  record?: OrmRecord;
  recordId?: unknown;
  oldState?: Record<string, unknown>;
}

interface PersistResponse {
  data?: { id: unknown };
}

interface SearchResult {
  record: OrmRecord;
  distance: number;
}

interface VectorSearchOptions {
  limit?: number;
  where?: Record<string, unknown>;
}

interface PostgresDeps {
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
  buildVectorSearch: typeof buildVectorSearch;
  buildHybridSearch: typeof buildHybridSearch;
  createRecord: typeof createRecord;
  store: typeof store;
  confirm: typeof confirm;
  readFile: typeof readFile;
  getPluralName: typeof getPluralName;
  config: typeof config;
  log: typeof log;
  path: typeof path;
  [key: string]: unknown;
}

const defaultDeps: PostgresDeps = {
  getPool, closePool, ensureMigrationsTable, getAppliedMigrations,
  getMigrationFiles, applyMigration, parseMigrationFile,
  introspectModels, introspectViews, getTopologicalOrder, schemasToSnapshot,
  loadLatestSnapshot, detectSchemaDrift,
  buildInsert, buildUpdate, buildDelete, buildSelect, buildVectorSearch, buildHybridSearch,
  createRecord, store, confirm, readFile, getPluralName, config, log, path
};

export default class PostgresDB {
  /** PostgreSQL extensions to enable on pool init. Subclasses can override. */
  static extensions: string[] = ['vector'];

  /** Config key under config.orm for this adapter. Subclasses can override. */
  static configKey: string = 'postgres';

  /** Singleton instance, set by subclass constructor name. */
  static instance: PostgresDB | undefined;

  deps!: PostgresDeps;
  pool!: Pool | null;
  pgConfig!: Record<string, unknown>;

  constructor(deps: Partial<PostgresDeps> = {}) {
    const Ctor = this.constructor as typeof PostgresDB;
    if (Ctor.instance) return Ctor.instance;
    Ctor.instance = this;

    this.deps = { ...defaultDeps, ...deps } as PostgresDeps;
    this.pool = null;
    this.pgConfig = (this.deps.config as Record<string, Record<string, unknown>>).orm[Ctor.configKey] as Record<string, unknown>;
  }

  protected requirePool(): Pool {
    if (!this.pool) throw new Error('PostgresDB pool not initialized — call init() first');
    return this.pool;
  }

  async init(): Promise<void> {
    this.pool = await this.deps.getPool(
      this.pgConfig as unknown as Parameters<typeof getPool>[0],
      (this.constructor as typeof PostgresDB).extensions
    );
    await this.deps.ensureMigrationsTable(this.pool, this.pgConfig.migrationsTable as string | undefined);
    await this.loadMemoryRecords();
  }

  async startup(): Promise<void> {
    const migrationsPath = this.deps.path.resolve(this.deps.config.rootPath as string, this.pgConfig.migrationsDir as string);

    // Check for pending migrations
    const applied = await this.deps.getAppliedMigrations(this.requirePool(), this.pgConfig.migrationsTable as string | undefined);
    const files = await this.deps.getMigrationFiles(migrationsPath);
    const pending = files.filter(f => !applied.includes(f));

    if (pending.length > 0) {
      this.deps.log.db!(`${pending.length} pending migration(s) found.`);

      const shouldApply = await this.deps.confirm(`${pending.length} pending migration(s) found. Apply now?`);

      if (shouldApply) {
        for (const filename of pending) {
          const content = await this.deps.readFile(this.deps.path.join(migrationsPath, filename)) as string;
          const { up } = this.deps.parseMigrationFile(content);

          await this.deps.applyMigration(this.requirePool(), filename, up, this.pgConfig.migrationsTable as string | undefined);
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
            await this.deps.applyMigration(this.requirePool(), result.filename, up, this.pgConfig.migrationsTable as string | undefined);
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
    const snapshot = await this.deps.loadLatestSnapshot(this.deps.path.resolve(this.deps.config.rootPath as string, this.pgConfig.migrationsDir as string));

    if (Object.keys(snapshot).length > 0) {
      const drift = this.deps.detectSchemaDrift(schemas, snapshot as Parameters<typeof detectSchemaDrift>[1]);

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
    // No-op: PostgreSQL persists data immediately via persist()
  }

  /**
   * Loads only models with memory: true into the in-memory store on startup.
   * Models with memory: false are skipped -- accessed on-demand via find()/findAll().
   */
  async loadMemoryRecords(): Promise<void> {
    const schemas = this.deps.introspectModels();
    const order = this.deps.getTopologicalOrder(schemas);
    const Orm = (await import('@stonyx/orm')).default;

    for (const modelName of order) {
      const { modelClass } = Orm.instance.getRecordClasses(modelName) as { modelClass: { memory?: boolean } };
      if (modelClass?.memory === false) {
        this.deps.log.db!(`Skipping memory load for '${modelName}' (memory: false)`);
        continue;
      }

      const schema = schemas[modelName];
      const { sql, values } = this.deps.buildSelect(schema.table);

      try {
        const result = await this.requirePool().query(sql, values);

        for (const row of result.rows) {
          const rawData = this._rowToRawData(row, schema);
          this.deps.createRecord(modelName, rawData, { isDbRecord: true, serialize: false, transform: false });
        }
      } catch (error) {
        // 42P01 = undefined_table (PG equivalent of ER_NO_SUCH_TABLE)
        if (isDbError(error) && error.code === '42P01') {
          this.deps.log.db!(`Table '${schema.table}' does not exist yet. Skipping load for '${modelName}'.`);
          continue;
        }

        throw error;
      }
    }

    // Load views with memory: true
    const viewSchemas = this.deps.introspectViews();

    for (const [viewName, viewSchema] of Object.entries(viewSchemas)) {
      const { modelClass: viewClass } = Orm.instance.getRecordClasses(viewName) as { modelClass: { memory?: boolean } };
      if (viewClass?.memory !== true) {
        this.deps.log.db!(`Skipping memory load for view '${viewName}' (memory: false)`);
        continue;
      }

      const schema: ModelSchema = {
        table: viewSchema.viewName,
        idType: 'number',
        columns: viewSchema.columns || {},
        foreignKeys: (viewSchema.foreignKeys || {}) as Record<string, ForeignKeyDef>,
        relationships: { belongsTo: {}, hasMany: {} },
        vectorColumns: {},
        memory: false,
      };
      const { sql, values } = this.deps.buildSelect(schema.table);

      try {
        const result = await this.requirePool().query(sql, values);

        for (const row of result.rows) {
          const rawData = this._rowToRawData(row, schema);
          this.deps.createRecord(viewName, rawData, { isDbRecord: true, serialize: false, transform: false });
        }
      } catch (error) {
        if (isDbError(error) && error.code === '42P01') {
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
   * Find a single record by ID from PostgreSQL.
   * Does NOT cache the result in the store for memory: false models.
   */
  async findRecord(modelName: string, id: string | number): Promise<OrmRecord | undefined> {
    const schemas = this.deps.introspectModels();
    let schema: ModelSchema | undefined = schemas[modelName];

    // Check views if not found in models
    if (!schema) {
      const viewSchemas = this.deps.introspectViews();
      const viewSchema = viewSchemas[modelName];
      if (viewSchema) {
        schema = {
          table: viewSchema.viewName,
          idType: 'number',
          columns: viewSchema.columns || {},
          foreignKeys: (viewSchema.foreignKeys || {}) as Record<string, ForeignKeyDef>,
          relationships: { belongsTo: {}, hasMany: {} },
          vectorColumns: {},
          memory: false,
        };
      }
    }

    if (!schema) return undefined;

    const { sql, values } = this.deps.buildSelect(schema.table, { id });

    try {
      const result = await this.requirePool().query(sql, values);

      if (result.rows.length === 0) return undefined;

      const rawData = this._rowToRawData(result.rows[0], schema);
      const record = this.deps.createRecord(modelName, rawData, { isDbRecord: true, serialize: false, transform: false }) as unknown as OrmRecord;

      this._evictIfNotMemory(modelName, record);

      return record;
    } catch (error) {
      if (isDbError(error) && error.code === '42P01') return undefined;
      throw error;
    }
  }

  /**
   * Find all records of a model from PostgreSQL, with optional conditions.
   */
  async findAll(modelName: string, conditions?: Record<string, unknown>): Promise<OrmRecord[]> {
    const schemas = this.deps.introspectModels();
    let schema: ModelSchema | undefined = schemas[modelName];

    // Check views if not found in models
    if (!schema) {
      const viewSchemas = this.deps.introspectViews();
      const viewSchema = viewSchemas[modelName];
      if (viewSchema) {
        schema = {
          table: viewSchema.viewName,
          idType: 'number',
          columns: viewSchema.columns || {},
          foreignKeys: (viewSchema.foreignKeys || {}) as Record<string, ForeignKeyDef>,
          relationships: { belongsTo: {}, hasMany: {} },
          vectorColumns: {},
          memory: false,
        };
      }
    }

    if (!schema) return [];

    const { sql, values } = this.deps.buildSelect(schema.table, conditions);

    try {
      const result = await this.requirePool().query(sql, values);

      const records = result.rows.map(row => {
        const rawData = this._rowToRawData(row, schema!);
        return this.deps.createRecord(modelName, rawData, { isDbRecord: true, serialize: false, transform: false }) as unknown as OrmRecord;
      });

      for (const record of records) {
        this._evictIfNotMemory(modelName, record);
      }

      return records;
    } catch (error) {
      if (isDbError(error) && error.code === '42P01') return [];
      throw error;
    }
  }

  /**
   * Perform a vector similarity search using cosine distance.
   */
  async vectorSearch(modelName: string, vectorColumn: string, queryVector: number[], options: VectorSearchOptions = {}): Promise<SearchResult[]> {
    const schemas = this.deps.introspectModels();
    const schema = schemas[modelName];
    if (!schema) return [];

    const { sql, values } = this.deps.buildVectorSearch(schema.table, vectorColumn, queryVector, options);

    try {
      const result = await this.requirePool().query(sql, values);

      return result.rows.map(row => {
        const distance = row.distance as number;
        delete row.distance;
        const rawData = this._rowToRawData(row, schema);
        const record = this.deps.createRecord(modelName, rawData, { isDbRecord: true, serialize: false, transform: false }) as unknown as OrmRecord;
        this._evictIfNotMemory(modelName, record);
        return { record, distance };
      });
    } catch (error) {
      if (isDbError(error) && error.code === '42P01') return [];
      throw error;
    }
  }

  /**
   * Perform a hybrid search combining vector similarity with text filtering.
   */
  async hybridSearch(modelName: string, vectorColumn: string, queryVector: number[], textColumn: string, textQuery: string, options: VectorSearchOptions = {}): Promise<SearchResult[]> {
    const schemas = this.deps.introspectModels();
    const schema = schemas[modelName];
    if (!schema) return [];

    const { sql, values } = this.deps.buildHybridSearch(schema.table, vectorColumn, queryVector, textColumn, textQuery, options);

    try {
      const result = await this.requirePool().query(sql, values);

      return result.rows.map(row => {
        const distance = row.distance as number;
        delete row.distance;
        const rawData = this._rowToRawData(row, schema);
        const record = this.deps.createRecord(modelName, rawData, { isDbRecord: true, serialize: false, transform: false }) as unknown as OrmRecord;
        this._evictIfNotMemory(modelName, record);
        return { record, distance };
      });
    } catch (error) {
      if (isDbError(error) && error.code === '42P01') return [];
      throw error;
    }
  }

  /**
   * Remove a record from the in-memory store if its model has memory: false.
   * The record object itself survives -- the caller retains the reference.
   * @private
   */
  _evictIfNotMemory(modelName: string, record: OrmRecord): void {
    const storeRef = this.deps.store as unknown as {
      _memoryResolver?: (name: string) => boolean;
      get?: (name: string) => Map<unknown, unknown> | undefined;
      data?: { get(name: string): Map<unknown, unknown> | undefined };
    };

    if (storeRef._memoryResolver && !storeRef._memoryResolver(modelName)) {
      const modelStore = storeRef.get?.(modelName) ?? storeRef.data?.get(modelName);
      if (modelStore) modelStore.delete(record.id);
    }
  }

  _rowToRawData(row: Record<string, unknown>, schema: ModelSchema): Record<string, unknown> {
    const rawData: Record<string, unknown> = { ...row };

    // PostgreSQL returns native booleans and parsed JSONB -- no manual conversion needed.
    // Only FK remapping and timestamp stripping required.

    // Map FK columns back to relationship keys
    for (const [fkCol] of Object.entries(schema.foreignKeys)) {
      const relName = fkCol.replace(/_id$/, '');

      if (rawData[fkCol] !== undefined) {
        rawData[relName] = rawData[fkCol];
        delete rawData[fkCol];
      }
    }

    // Remove timestamp columns -- managed by PostgreSQL
    delete rawData.created_at;
    delete rawData.updated_at;

    return rawData;
  }

  async persist(operation: string, modelName: string, context: PersistContext, response: PersistResponse): Promise<void> {
    // Views are read-only -- no-op for all write operations
    const Orm = (await import('@stonyx/orm')).default;
    if ((Orm.instance as { isView?: (name: string) => boolean })?.isView?.(modelName)) return;

    switch (operation) {
      case 'create':
        return this._persistCreate(modelName, context, response);
      case 'update':
        return this._persistUpdate(modelName, context, response);
      case 'delete':
        return this._persistDelete(modelName, context);
    }
  }

  async _persistCreate(modelName: string, _context: PersistContext, response: PersistResponse): Promise<void> {
    const schemas = this.deps.introspectModels();
    const schema = schemas[modelName];

    if (!schema) return;

    const recordId = response?.data?.id;
    const storeRef = this.deps.store as unknown as {
      get(name: string, id: unknown): OrmRecord | null;
    };
    const record = recordId != null ? storeRef.get(modelName, isNaN(recordId as number) ? recordId : parseInt(recordId as string)) : null;

    if (!record) return;

    const insertData = this._recordToRow(record, schema);

    // For auto-increment models, remove the pending ID
    const isPendingId = record.__data.__pendingSqlId;

    if (isPendingId) {
      delete insertData.id;
    }

    const { sql, values } = this.deps.buildInsert(schema.table, insertData);

    const result = await this.requirePool().query(sql, values);

    // Re-key the record in the store if PostgreSQL generated the ID (via RETURNING)
    if (isPendingId && result.rows.length > 0) {
      const pendingId = record.id;
      const realId = result.rows[0].id;
      const modelStore = (this.deps.store as unknown as { get(name: string): Map<unknown, unknown> }).get(modelName);

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

  async _persistUpdate(modelName: string, context: PersistContext, _response: PersistResponse): Promise<void> {
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

    // PostgreSQL doesn't have ON UPDATE CURRENT_TIMESTAMP -- set updated_at manually
    changedData.updated_at = new Date();

    const { sql, values } = this.deps.buildUpdate(schema.table, id, changedData);
    await this.requirePool().query(sql, values);
  }

  async _persistDelete(modelName: string, context: PersistContext): Promise<void> {
    const schemas = this.deps.introspectModels();
    const schema = schemas[modelName];

    if (!schema) return;

    const id = context.recordId;
    if (id == null) return;

    const { sql, values } = this.deps.buildDelete(schema.table, id);
    await this.requirePool().query(sql, values);
  }

  _recordToRow(record: OrmRecord, schema: ModelSchema): Record<string, unknown> {
    const row: Record<string, unknown> = {};
    const data = record.__data;

    // ID
    if (data.id !== undefined) {
      row.id = data.id;
    }

    // Attribute columns
    for (const [col, pgType] of Object.entries(schema.columns)) {
      if (data[col] !== undefined) {
        // JSONB columns: stringify non-string values for PostgreSQL JSONB storage
        row[col] = pgType === 'JSONB' && typeof data[col] !== 'string'
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
