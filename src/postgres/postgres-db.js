import { getPool, closePool } from './connection.js';
import { ensureMigrationsTable, getAppliedMigrations, getMigrationFiles, applyMigration, parseMigrationFile } from './migration-runner.js';
import { introspectModels, introspectViews, getTopologicalOrder, schemasToSnapshot } from './schema-introspector.js';
import { loadLatestSnapshot, detectSchemaDrift } from './migration-generator.js';
import { buildInsert, buildUpdate, buildDelete, buildSelect } from './query-builder.js';
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
  buildInsert, buildUpdate, buildDelete, buildSelect,
  createRecord, store, confirm, readFile, getPluralName, config, log, path
};

export default class PostgresDB {
  constructor(deps = {}) {
    if (PostgresDB.instance) return PostgresDB.instance;
    PostgresDB.instance = this;

    this.deps = { ...defaultDeps, ...deps };
    this.pool = null;
    this.postgresConfig = this.deps.config.orm.postgres;
  }

  async init() {
    this.pool = await this.deps.getPool(this.postgresConfig);
    await this.deps.ensureMigrationsTable(this.pool, this.postgresConfig.migrationsTable);
    await this.loadMemoryRecords();
  }

  async startup() {
    const migrationsPath = this.deps.path.resolve(this.deps.config.rootPath, this.postgresConfig.migrationsDir);

    // Check for pending migrations
    const applied = await this.deps.getAppliedMigrations(this.pool, this.postgresConfig.migrationsTable);
    const files = await this.deps.getMigrationFiles(migrationsPath);
    const pending = files.filter(f => !applied.includes(f));

    if (pending.length > 0) {
      this.deps.log.db(`${pending.length} pending migration(s) found.`);

      const shouldApply = await this.deps.confirm(`${pending.length} pending migration(s) found. Apply now?`);

      if (shouldApply) {
        for (const filename of pending) {
          const content = await this.deps.readFile(this.deps.path.join(migrationsPath, filename));
          const { up } = this.deps.parseMigrationFile(content);

          await this.deps.applyMigration(this.pool, filename, up, this.postgresConfig.migrationsTable);
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
            await this.deps.applyMigration(this.pool, result.filename, up, this.postgresConfig.migrationsTable);
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
    const snapshot = await this.deps.loadLatestSnapshot(this.deps.path.resolve(this.deps.config.rootPath, this.postgresConfig.migrationsDir));

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
    // No-op: Postgres persists data immediately via persist()
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
      // Check the model's memory flag — skip non-memory models
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
        // Table may not exist yet (pre-migration) — skip gracefully
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
   * Find a single record by ID from Postgres.
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

      // Don't let memory:false records accumulate in the store
      // The caller keeps the reference; the store doesn't retain it
      this._evictIfNotMemory(modelName, record);

      return record;
    } catch (error) {
      if (error.code === '42P01') return undefined;
      throw error;
    }
  }

  /**
   * Find all records of a model from Postgres, with optional conditions.
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

      // Don't let memory:false records accumulate in the store
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
   * Remove a record from the in-memory store if its model has memory: false.
   * The record object itself survives — the caller retains the reference.
   * This prevents on-demand queries from leaking records into the store.
   * @private
   */
  _evictIfNotMemory(modelName, record) {
    const store = this.deps.store;

    // Use the memory resolver if available (set by Orm.init)
    if (store._memoryResolver && !store._memoryResolver(modelName)) {
      const modelStore = store.get?.(modelName) ?? store.data?.get(modelName);
      if (modelStore) modelStore.delete(record.id);
    }
  }

  _rowToRawData(row, schema) {
    const rawData = { ...row };

    for (const [col, pgType] of Object.entries(schema.columns)) {
      if (rawData[col] == null) continue;

      // BIGINT columns come back as strings from pg — convert to Number
      if (pgType === 'BIGINT' && typeof rawData[col] === 'string') {
        rawData[col] = Number(rawData[col]);
      }
    }

    // Map FK columns back to relationship keys
    // e.g., owner_id → owner (the belongsTo handler expects the id value under the relationship key name)
    for (const [fkCol, fkDef] of Object.entries(schema.foreignKeys)) {
      const relName = fkCol.replace(/_id$/, '');

      if (rawData[fkCol] !== undefined) {
        rawData[relName] = rawData[fkCol];
        delete rawData[fkCol];
      }
    }

    // Remove timestamp columns — managed by the database
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
    } else if (insertData.id !== undefined) {
      // Keep user-provided ID (string IDs or explicit numeric IDs)
    }

    const { sql, values } = this.deps.buildInsert(schema.table, insertData);

    // Append RETURNING id to get the generated ID back from Postgres
    const result = await this.pool.query(`${sql} RETURNING id`, values);

    // Re-key the record in the store if Postgres generated the ID
    if (isPendingId && result.rows[0]?.id) {
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

    // Postgres has no ON UPDATE CURRENT_TIMESTAMP — set updated_at manually
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

    // Attribute columns — pg accepts JS objects directly for JSONB, no stringify needed
    for (const [col] of Object.entries(schema.columns)) {
      if (data[col] !== undefined) {
        row[col] = data[col];
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
