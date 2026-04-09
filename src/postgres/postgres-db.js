import { getPool, closePool } from './connection.js';
import { ensureMigrationsTable, getAppliedMigrations, getMigrationFiles, applyMigration, parseMigrationFile } from './migration-runner.js';
import { introspectModels, introspectViews, getTopologicalOrder, schemasToSnapshot } from './schema-introspector.js';
import { loadLatestSnapshot, detectSchemaDrift } from './migration-generator.js';
import { buildInsert, buildUpdate, buildDelete, buildSelect, buildVectorSearch, buildHybridSearch } from './query-builder.js';
import { createRecord, store } from '@stonyx/orm';
import { confirm } from '@stonyx/utils/prompt';
import { readFile } from '@stonyx/utils/file';
import { getPluralName } from '../plural-registry.js';
import config from 'stonyx/config';
import log from 'stonyx/log';
import path from 'path';

const defaultDeps = {
  getPool, closePool, ensureMigrationsTable, getAppliedMigrations,
  getMigrationFiles, applyMigration, parseMigrationFile,
  introspectModels, introspectViews, getTopologicalOrder, schemasToSnapshot,
  loadLatestSnapshot, detectSchemaDrift,
  buildInsert, buildUpdate, buildDelete, buildSelect, buildVectorSearch, buildHybridSearch,
  createRecord, store, confirm, readFile, getPluralName, config, log, path
};

export default class PostgresDB {
  /** @type {string[]} PostgreSQL extensions to enable on pool init. Subclasses can override. */
  static extensions = ['vector'];

  /** @type {string} Config key under config.orm for this adapter. Subclasses can override. */
  static configKey = 'postgres';

  constructor(deps = {}) {
    const Ctor = this.constructor;
    if (Ctor.instance) return Ctor.instance;
    Ctor.instance = this;

    this.deps = { ...defaultDeps, ...deps };
    this.pool = null;
    this.pgConfig = this.deps.config.orm[Ctor.configKey];
  }

  async init() {
    this.pool = await this.deps.getPool(this.pgConfig, this.constructor.extensions);
    await this.deps.ensureMigrationsTable(this.pool, this.pgConfig.migrationsTable);
    await this.loadMemoryRecords();
  }

  async startup() {
    const migrationsPath = this.deps.path.resolve(this.deps.config.rootPath, this.pgConfig.migrationsDir);

    // Check for pending migrations
    const applied = await this.deps.getAppliedMigrations(this.pool, this.pgConfig.migrationsTable);
    const files = await this.deps.getMigrationFiles(migrationsPath);
    const pending = files.filter(f => !applied.includes(f));

    if (pending.length > 0) {
      this.deps.log.db(`${pending.length} pending migration(s) found.`);

      const shouldApply = await this.deps.confirm(`${pending.length} pending migration(s) found. Apply now?`);

      if (shouldApply) {
        for (const filename of pending) {
          const content = await this.deps.readFile(this.deps.path.join(migrationsPath, filename));
          const { up } = this.deps.parseMigrationFile(content);

          await this.deps.applyMigration(this.pool, filename, up, this.pgConfig.migrationsTable);
          this.deps.log.db(`Applied migration: ${filename}`);
        }

        // Reload records after applying migrations
        await this.loadMemoryRecords();
      } else {
        this.deps.log.warn('Skipping pending migrations. Schema may be outdated.');
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
            await this.deps.applyMigration(this.pool, result.filename, up, this.pgConfig.migrationsTable);
            this.deps.log.db(`Applied migration: ${result.filename}`);
            await this.loadMemoryRecords();
          }
        } else {
          this.deps.log.warn('Skipping initial migration. Tables may not exist.');
        }
      }
    }

    // Check for schema drift
    const schemas = this.deps.introspectModels();
    const snapshot = await this.deps.loadLatestSnapshot(this.deps.path.resolve(this.deps.config.rootPath, this.pgConfig.migrationsDir));

    if (Object.keys(snapshot).length > 0) {
      const drift = this.deps.detectSchemaDrift(schemas, snapshot);

      if (drift.hasChanges) {
        this.deps.log.warn('Schema drift detected: models have changed since the last migration.');
        this.deps.log.warn('Run `stonyx db:generate-migration` to create a new migration.');
      }
    }
  }

  async shutdown() {
    await this.deps.closePool();
    this.pool = null;
  }

  async save() {
    // No-op: PostgreSQL persists data immediately via persist()
  }

  /**
   * Loads only models with memory: true into the in-memory store on startup.
   * Models with memory: false are skipped — accessed on-demand via find()/findAll().
   */
  async loadMemoryRecords() {
    const schemas = this.deps.introspectModels();
    const order = this.deps.getTopologicalOrder(schemas);
    const Orm = (await import('@stonyx/orm')).default;

    for (const modelName of order) {
      const { modelClass } = Orm.instance.getRecordClasses(modelName);
      if (modelClass?.memory === false) {
        this.deps.log.db(`Skipping memory load for '${modelName}' (memory: false)`);
        continue;
      }

      const schema = schemas[modelName];
      const { sql, values } = this.deps.buildSelect(schema.table);

      try {
        const result = await this.pool.query(sql, values);

        for (const row of result.rows) {
          const rawData = this._rowToRawData(row, schema);
          this.deps.createRecord(modelName, rawData, { isDbRecord: true, serialize: false, transform: false });
        }
      } catch (error) {
        // 42P01 = undefined_table (PG equivalent of ER_NO_SUCH_TABLE)
        if (error.code === '42P01') {
          this.deps.log.db(`Table '${schema.table}' does not exist yet. Skipping load for '${modelName}'.`);
          continue;
        }

        throw error;
      }
    }

    // Load views with memory: true
    const viewSchemas = this.deps.introspectViews();

    for (const [viewName, viewSchema] of Object.entries(viewSchemas)) {
      const { modelClass: viewClass } = Orm.instance.getRecordClasses(viewName);
      if (viewClass?.memory !== true) {
        this.deps.log.db(`Skipping memory load for view '${viewName}' (memory: false)`);
        continue;
      }

      const schema = { table: viewSchema.viewName, columns: viewSchema.columns || {}, foreignKeys: viewSchema.foreignKeys || {} };
      const { sql, values } = this.deps.buildSelect(schema.table);

      try {
        const result = await this.pool.query(sql, values);

        for (const row of result.rows) {
          const rawData = this._rowToRawData(row, schema);
          this.deps.createRecord(viewName, rawData, { isDbRecord: true, serialize: false, transform: false });
        }
      } catch (error) {
        if (error.code === '42P01') {
          this.deps.log.db(`View '${viewSchema.viewName}' does not exist yet. Skipping load for '${viewName}'.`);
          continue;
        }
        throw error;
      }
    }
  }

  /**
   * @deprecated Use loadMemoryRecords() instead. Kept for backward compatibility.
   */
  async loadAllRecords() {
    return this.loadMemoryRecords();
  }

  /**
   * Find a single record by ID from PostgreSQL.
   * Does NOT cache the result in the store for memory: false models.
   * @param {string} modelName
   * @param {string|number} id
   * @returns {Promise<Record|undefined>}
   */
  async findRecord(modelName, id) {
    const schemas = this.deps.introspectModels();
    let schema = schemas[modelName];

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
      const result = await this.pool.query(sql, values);

      if (result.rows.length === 0) return undefined;

      const rawData = this._rowToRawData(result.rows[0], schema);
      const record = this.deps.createRecord(modelName, rawData, { isDbRecord: true, serialize: false, transform: false });

      this._evictIfNotMemory(modelName, record);

      return record;
    } catch (error) {
      if (error.code === '42P01') return undefined;
      throw error;
    }
  }

  /**
   * Find all records of a model from PostgreSQL, with optional conditions.
   * @param {string} modelName
   * @param {Object} [conditions] - Optional WHERE conditions (key-value pairs)
   * @returns {Promise<Record[]>}
   */
  async findAll(modelName, conditions) {
    const schemas = this.deps.introspectModels();
    let schema = schemas[modelName];

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
      const result = await this.pool.query(sql, values);

      const records = result.rows.map(row => {
        const rawData = this._rowToRawData(row, schema);
        return this.deps.createRecord(modelName, rawData, { isDbRecord: true, serialize: false, transform: false });
      });

      for (const record of records) {
        this._evictIfNotMemory(modelName, record);
      }

      return records;
    } catch (error) {
      if (error.code === '42P01') return [];
      throw error;
    }
  }

  /**
   * Perform a vector similarity search using cosine distance.
   * @param {string} modelName
   * @param {string} vectorColumn - Name of the vector column
   * @param {number[]} queryVector - The query vector
   * @param {Object} [options]
   * @param {number} [options.limit=10]
   * @param {Object} [options.where] - Additional conditions
   * @returns {Promise<{ record: Record, distance: number }[]>}
   */
  async vectorSearch(modelName, vectorColumn, queryVector, options = {}) {
    const schemas = this.deps.introspectModels();
    const schema = schemas[modelName];
    if (!schema) return [];

    const { sql, values } = this.deps.buildVectorSearch(schema.table, vectorColumn, queryVector, options);

    try {
      const result = await this.pool.query(sql, values);

      return result.rows.map(row => {
        const distance = row.distance;
        delete row.distance;
        const rawData = this._rowToRawData(row, schema);
        const record = this.deps.createRecord(modelName, rawData, { isDbRecord: true, serialize: false, transform: false });
        this._evictIfNotMemory(modelName, record);
        return { record, distance };
      });
    } catch (error) {
      if (error.code === '42P01') return [];
      throw error;
    }
  }

  /**
   * Perform a hybrid search combining vector similarity with text filtering.
   * @param {string} modelName
   * @param {string} vectorColumn
   * @param {number[]} queryVector
   * @param {string} textColumn
   * @param {string} textQuery
   * @param {Object} [options]
   * @returns {Promise<{ record: Record, distance: number }[]>}
   */
  async hybridSearch(modelName, vectorColumn, queryVector, textColumn, textQuery, options = {}) {
    const schemas = this.deps.introspectModels();
    const schema = schemas[modelName];
    if (!schema) return [];

    const { sql, values } = this.deps.buildHybridSearch(schema.table, vectorColumn, queryVector, textColumn, textQuery, options);

    try {
      const result = await this.pool.query(sql, values);

      return result.rows.map(row => {
        const distance = row.distance;
        delete row.distance;
        const rawData = this._rowToRawData(row, schema);
        const record = this.deps.createRecord(modelName, rawData, { isDbRecord: true, serialize: false, transform: false });
        this._evictIfNotMemory(modelName, record);
        return { record, distance };
      });
    } catch (error) {
      if (error.code === '42P01') return [];
      throw error;
    }
  }

  /**
   * Remove a record from the in-memory store if its model has memory: false.
   * The record object itself survives — the caller retains the reference.
   * @private
   */
  _evictIfNotMemory(modelName, record) {
    const store = this.deps.store;

    if (store._memoryResolver && !store._memoryResolver(modelName)) {
      const modelStore = store.get?.(modelName) ?? store.data?.get(modelName);
      if (modelStore) modelStore.delete(record.id);
    }
  }

  _rowToRawData(row, schema) {
    const rawData = { ...row };

    // PostgreSQL returns native booleans and parsed JSONB — no manual conversion needed.
    // Only FK remapping and timestamp stripping required.

    // Map FK columns back to relationship keys
    for (const [fkCol] of Object.entries(schema.foreignKeys)) {
      const relName = fkCol.replace(/_id$/, '');

      if (rawData[fkCol] !== undefined) {
        rawData[relName] = rawData[fkCol];
        delete rawData[fkCol];
      }
    }

    // Remove timestamp columns — managed by PostgreSQL
    delete rawData.created_at;
    delete rawData.updated_at;

    return rawData;
  }

  async persist(operation, modelName, context, response) {
    // Views are read-only — no-op for all write operations
    const Orm = (await import('@stonyx/orm')).default;
    if (Orm.instance?.isView?.(modelName)) return;

    switch (operation) {
      case 'create':
        return this._persistCreate(modelName, context, response);
      case 'update':
        return this._persistUpdate(modelName, context, response);
      case 'delete':
        return this._persistDelete(modelName, context);
    }
  }

  async _persistCreate(modelName, context, response) {
    const schemas = this.deps.introspectModels();
    const schema = schemas[modelName];

    if (!schema) return;

    const recordId = response?.data?.id;
    const record = recordId != null ? this.deps.store.get(modelName, isNaN(recordId) ? recordId : parseInt(recordId)) : null;

    if (!record) return;

    const insertData = this._recordToRow(record, schema);

    // For auto-increment models, remove the pending ID
    const isPendingId = record.__data.__pendingSqlId;

    if (isPendingId) {
      delete insertData.id;
    }

    const { sql, values } = this.deps.buildInsert(schema.table, insertData);

    const result = await this.pool.query(sql, values);

    // Re-key the record in the store if PostgreSQL generated the ID (via RETURNING)
    if (isPendingId && result.rows.length > 0) {
      const pendingId = record.id;
      const realId = result.rows[0].id;
      const modelStore = this.deps.store.get(modelName);

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

  async _persistUpdate(modelName, context, response) {
    const schemas = this.deps.introspectModels();
    const schema = schemas[modelName];

    if (!schema) return;

    const record = context.record;
    if (!record) return;

    const id = record.id;
    const oldState = context.oldState || {};
    const currentData = record.__data;

    // Build a diff of changed columns
    const changedData = {};

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

    // PostgreSQL doesn't have ON UPDATE CURRENT_TIMESTAMP — set updated_at manually
    changedData.updated_at = new Date();

    const { sql, values } = this.deps.buildUpdate(schema.table, id, changedData);
    await this.pool.query(sql, values);
  }

  async _persistDelete(modelName, context) {
    const schemas = this.deps.introspectModels();
    const schema = schemas[modelName];

    if (!schema) return;

    const id = context.recordId;
    if (id == null) return;

    const { sql, values } = this.deps.buildDelete(schema.table, id);
    await this.pool.query(sql, values);
  }

  _recordToRow(record, schema) {
    const row = {};
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
        row[fkCol] = related.id;
      } else if (data[relName] !== undefined) {
        // Raw FK value (e.g., from create payload)
        row[fkCol] = data[relName];
      }
    }

    return row;
  }
}
