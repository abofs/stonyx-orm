import { getPool, closePool } from './connection.js';
import { ensureMigrationsTable, getAppliedMigrations, getMigrationFiles, applyMigration, parseMigrationFile } from './migration-runner.js';
import { introspectModels, getTopologicalOrder, schemasToSnapshot } from './schema-introspector.js';
import { loadLatestSnapshot, detectSchemaDrift } from './migration-generator.js';
import { buildInsert, buildUpdate, buildDelete, buildSelect } from './query-builder.js';
import { createRecord, store } from '@stonyx/orm';
import { confirm } from '@stonyx/utils/prompt';
import { readFile } from '@stonyx/utils/file';
import { pluralize } from '@stonyx/utils/string';
import config from 'stonyx/config';
import log from 'stonyx/log';
import path from 'path';

export default class MysqlDB {
  constructor() {
    if (MysqlDB.instance) return MysqlDB.instance;
    MysqlDB.instance = this;

    this.pool = null;
    this.mysqlConfig = config.orm.mysql;
  }

  async init() {
    this.pool = await getPool(this.mysqlConfig);
    await ensureMigrationsTable(this.pool, this.mysqlConfig.migrationsTable);
    await this.loadAllRecords();
  }

  async startup() {
    const migrationsPath = path.resolve(config.rootPath, this.mysqlConfig.migrationsDir);

    // Check for pending migrations
    const applied = await getAppliedMigrations(this.pool, this.mysqlConfig.migrationsTable);
    const files = await getMigrationFiles(migrationsPath);
    const pending = files.filter(f => !applied.includes(f));

    if (pending.length > 0) {
      log.db(`${pending.length} pending migration(s) found.`);

      const shouldApply = await confirm(`${pending.length} pending migration(s) found. Apply now?`);

      if (shouldApply) {
        for (const filename of pending) {
          const content = await readFile(path.join(migrationsPath, filename));
          const { up } = parseMigrationFile(content);

          await applyMigration(this.pool, filename, up, this.mysqlConfig.migrationsTable);
          log.db(`Applied migration: ${filename}`);
        }

        // Reload records after applying migrations
        await this.loadAllRecords();
      } else {
        log.warn('Skipping pending migrations. Schema may be outdated.');
      }
    }

    // Check for schema drift
    const schemas = introspectModels();
    const snapshot = await loadLatestSnapshot(path.resolve(config.rootPath, this.mysqlConfig.migrationsDir));

    if (Object.keys(snapshot).length > 0) {
      const drift = detectSchemaDrift(schemas, snapshot);

      if (drift.hasChanges) {
        log.warn('Schema drift detected: models have changed since the last migration.');
        log.warn('Run `stonyx db:generate-migration` to create a new migration.');
      }
    }
  }

  async shutdown() {
    await closePool();
    this.pool = null;
  }

  async loadAllRecords() {
    const schemas = introspectModels();
    const order = getTopologicalOrder(schemas);

    for (const modelName of order) {
      const schema = schemas[modelName];
      const { sql, values } = buildSelect(schema.table);

      try {
        const [rows] = await this.pool.execute(sql, values);

        for (const row of rows) {
          const rawData = this._rowToRawData(row, schema);
          createRecord(modelName, rawData, { isDbRecord: true, serialize: false, transform: false });
        }
      } catch (error) {
        // Table may not exist yet (pre-migration) — skip gracefully
        if (error.code === 'ER_NO_SUCH_TABLE') {
          log.db(`Table '${schema.table}' does not exist yet. Skipping load for '${modelName}'.`);
          continue;
        }

        throw error;
      }
    }
  }

  _rowToRawData(row, schema) {
    const rawData = { ...row };

    // Map FK columns back to relationship keys
    // e.g., owner_id → owner (the belongsTo handler expects the id value under the relationship key name)
    for (const [fkCol, fkDef] of Object.entries(schema.foreignKeys)) {
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

  async persist(operation, modelName, context, response) {
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
    const schemas = introspectModels();
    const schema = schemas[modelName];

    if (!schema) return;

    const recordId = response?.data?.id;
    const record = recordId != null ? store.get(modelName, isNaN(recordId) ? recordId : parseInt(recordId)) : null;

    if (!record) return;

    const insertData = this._recordToRow(record, schema);

    // For auto-increment models, remove the pending ID
    const isPendingId = record.__data.__pendingMysqlId;

    if (isPendingId) {
      delete insertData.id;
    } else if (insertData.id !== undefined) {
      // Keep user-provided ID (string IDs or explicit numeric IDs)
    }

    const { sql, values } = buildInsert(schema.table, insertData);

    const [result] = await this.pool.execute(sql, values);

    // Re-key the record in the store if MySQL generated the ID
    if (isPendingId && result.insertId) {
      const pendingId = record.id;
      const realId = result.insertId;
      const modelStore = store.get(modelName);

      modelStore.delete(pendingId);
      record.__data.id = realId;
      record.id = realId;
      modelStore.set(realId, record);

      // Update the response data with the real ID
      if (response?.data) {
        response.data.id = realId;
      }

      delete record.__data.__pendingMysqlId;
    }
  }

  async _persistUpdate(modelName, context, response) {
    const schemas = introspectModels();
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

    const { sql, values } = buildUpdate(schema.table, id, changedData);
    await this.pool.execute(sql, values);
  }

  async _persistDelete(modelName, context) {
    const schemas = introspectModels();
    const schema = schemas[modelName];

    if (!schema) return;

    const id = context.recordId;
    if (id == null) return;

    const { sql, values } = buildDelete(schema.table, id);
    await this.pool.execute(sql, values);
  }

  _recordToRow(record, schema) {
    const row = {};
    const data = record.__data;

    // ID
    if (data.id !== undefined) {
      row.id = data.id;
    }

    // Attribute columns
    for (const col of Object.keys(schema.columns)) {
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
