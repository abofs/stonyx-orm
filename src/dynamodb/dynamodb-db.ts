/**
 * DynamoDB driver implementing the SqlDb PAL contract.
 *
 * Drop-in replacement for PostgresDB / MysqlDB — zero ORM core changes.
 * Selected via config.orm.dynamodb.
 */

import { createDocumentClient, destroyDocumentClient } from './connection.js';
import type { DocumentClient, DynamoDBConfig } from './connection.js';
import {
  buildPutItem,
  buildGetItem,
  buildUpdateItem,
  buildDeleteItem,
  buildScan,
  buildQuery,
} from './operation-builder.js';
import { introspectModels, getTopologicalOrder } from '../postgres/schema-introspector.js';
import { getDynamoKeyType } from './type-map.js';
import { store } from '@stonyx/orm';
import { createRecord } from '../manage-record.js';
import { getPluralName } from '../plural-registry.js';
import { sanitizeTableName } from '../schema-helpers.js';
import config from 'stonyx/config';
import log from 'stonyx/log';
import type { ModelSchema, OrmRecord } from '../types/orm-types.js';

// ---------------------------------------------------------------------------
// ULID — monotonic, inline implementation (avoids heavy dep)
// ---------------------------------------------------------------------------

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

function generateUlid(): string {
  const now = Date.now();
  let id = '';

  // 10-char timestamp (48-bit millisecond precision)
  let t = now;
  for (let i = 9; i >= 0; i--) {
    id = CROCKFORD[t % 32] + id;
    t = Math.floor(t / 32);
  }

  // 16-char random
  for (let i = 0; i < 16; i++) {
    id += CROCKFORD[Math.floor(Math.random() * 32)];
  }

  return id;
}

// ---------------------------------------------------------------------------
// SDK Command factories (injectable for testing without real AWS SDK)
// ---------------------------------------------------------------------------

/**
 * Load the DynamoDB DocumentClient command constructors via dynamic import.
 * Returns a frozen object so it can be cached in deps.
 */
export async function loadDocClientCommands(): Promise<{
  PutCommand: new (params: unknown) => unknown;
  GetCommand: new (params: unknown) => unknown;
  UpdateCommand: new (params: unknown) => unknown;
  DeleteCommand: new (params: unknown) => unknown;
  ScanCommand: new (params: unknown) => unknown;
  QueryCommand: new (params: unknown) => unknown;
}> {
  return import('@aws-sdk/lib-dynamodb' as string) as Promise<{
    PutCommand: new (params: unknown) => unknown;
    GetCommand: new (params: unknown) => unknown;
    UpdateCommand: new (params: unknown) => unknown;
    DeleteCommand: new (params: unknown) => unknown;
    ScanCommand: new (params: unknown) => unknown;
    QueryCommand: new (params: unknown) => unknown;
  }>;
}

export async function loadTableCommands(): Promise<{
  DynamoDBClient: new (opts: unknown) => { send(cmd: unknown): Promise<unknown> };
  DescribeTableCommand: new (params: unknown) => unknown;
  CreateTableCommand: new (params: unknown) => unknown;
  UpdateTableCommand: new (params: unknown) => unknown;
}> {
  return import('@aws-sdk/client-dynamodb' as string) as Promise<{
    DynamoDBClient: new (opts: unknown) => { send(cmd: unknown): Promise<unknown> };
    DescribeTableCommand: new (params: unknown) => unknown;
    CreateTableCommand: new (params: unknown) => unknown;
    UpdateTableCommand: new (params: unknown) => unknown;
  }>;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface PersistContext {
  record?: OrmRecord;
  recordId?: unknown;
  oldState?: Record<string, unknown>;
  rawData?: Record<string, unknown>;
}

interface PersistResponse {
  data?: { id?: unknown };
}

/** Minimal Orm module shape needed at runtime — avoids circular import at top-level. */
interface OrmModule {
  default: {
    instance: {
      getRecordClasses(name: string): { modelClass: { memory?: boolean } };
      isView?(name: string): boolean;
    };
  };
}

export interface DynamoDBDeps {
  createDocumentClient: typeof createDocumentClient;
  destroyDocumentClient: typeof destroyDocumentClient;
  loadDocClientCommands: typeof loadDocClientCommands;
  loadTableCommands: typeof loadTableCommands;
  buildPutItem: typeof buildPutItem;
  buildGetItem: typeof buildGetItem;
  buildUpdateItem: typeof buildUpdateItem;
  buildDeleteItem: typeof buildDeleteItem;
  buildScan: typeof buildScan;
  buildQuery: typeof buildQuery;
  introspectModels: typeof introspectModels;
  getTopologicalOrder: typeof getTopologicalOrder;
  getDynamoKeyType: typeof getDynamoKeyType;
  createRecord: typeof createRecord;
  store: typeof store;
  getPluralName: typeof getPluralName;
  config: typeof config;
  log: typeof log;
  /** Injected for testing — import('@stonyx/orm') replacement */
  _importOrm?: () => Promise<OrmModule>;
  [key: string]: unknown;
}

const defaultDeps: DynamoDBDeps = {
  createDocumentClient,
  destroyDocumentClient,
  loadDocClientCommands,
  loadTableCommands,
  buildPutItem,
  buildGetItem,
  buildUpdateItem,
  buildDeleteItem,
  buildScan,
  buildQuery,
  introspectModels,
  getTopologicalOrder,
  getDynamoKeyType,
  createRecord,
  store,
  getPluralName,
  config,
  log,
};

// ---------------------------------------------------------------------------
// GSI registry type
// ---------------------------------------------------------------------------

/** modelName → attrName → gsiName */
type GsiRegistry = Map<string, Map<string, string>>;

// ---------------------------------------------------------------------------
// DynamoDB driver
// ---------------------------------------------------------------------------

export default class DynamoDBDB {
  static instance: DynamoDBDB | undefined;

  deps!: DynamoDBDeps;
  client!: DocumentClient | null;
  dbConfig!: DynamoDBConfig;

  /** GSI registry built during init from model introspection. */
  private _gsiRegistry: GsiRegistry = new Map();

  constructor(deps: Partial<DynamoDBDeps> = {}) {
    const Ctor = this.constructor as typeof DynamoDBDB;
    if (Ctor.instance) return Ctor.instance;
    Ctor.instance = this;

    this.deps = { ...defaultDeps, ...deps } as DynamoDBDeps;
    this.client = null;

    const dynamoConfig = this.deps.config.orm.dynamodb;
    if (!dynamoConfig) throw new Error('DynamoDB configuration (config.orm.dynamodb) is required');
    this.dbConfig = dynamoConfig as DynamoDBConfig;
  }

  private requireClient(): DocumentClient {
    if (!this.client) throw new Error('DynamoDBDB client not initialized — call init() first');
    return this.client;
  }

  /** Resolve Orm singleton — falls back to real import in production. */
  private async _getOrm(): Promise<OrmModule> {
    if (this.deps._importOrm) return this.deps._importOrm();
    return import('@stonyx/orm') as unknown as Promise<OrmModule>;
  }

  // -------------------------------------------------------------------------
  // SqlDb contract — init
  // -------------------------------------------------------------------------

  async init(): Promise<void> {
    this.client = await this.deps.createDocumentClient(this.dbConfig);
    this._buildGsiRegistry();
    await this.loadMemoryRecords();
  }

  // -------------------------------------------------------------------------
  // SqlDb contract — startup (table provisioning)
  // -------------------------------------------------------------------------

  /**
   * For each model, DescribeTable — CreateTable if missing (with GSIs, PAY_PER_REQUEST).
   * For existing tables, check for missing GSIs and UpdateTable + poll for ACTIVE.
   */
  async startup(): Promise<void> {
    const schemas = this.deps.introspectModels();
    const { DynamoDBClient, DescribeTableCommand, CreateTableCommand, UpdateTableCommand } =
      await this.deps.loadTableCommands();

    const clientOptions: Record<string, unknown> = {};
    if (this.dbConfig.region) clientOptions.region = this.dbConfig.region;
    if (this.dbConfig.endpoint) clientOptions.endpoint = this.dbConfig.endpoint;

    const rawClient = new DynamoDBClient(clientOptions);

    for (const [modelName, schema] of Object.entries(schemas)) {
      const tableName = sanitizeTableName(this.deps.getPluralName(modelName));
      const gsis = this._buildGsiDefinitions(modelName, schema);

      try {
        const desc = await rawClient.send(new DescribeTableCommand({ TableName: tableName })) as {
          Table?: { TableStatus?: string; GlobalSecondaryIndexes?: Array<{ IndexName?: string }> };
        };

        // Table exists — check for missing GSIs
        const existingGsiNames = new Set(
          (desc.Table?.GlobalSecondaryIndexes ?? []).map((g: { IndexName?: string }) => g.IndexName ?? '')
        );

        for (const gsi of gsis) {
          const gsiName = (gsi as { IndexName?: string }).IndexName;
          if (gsiName && !existingGsiNames.has(gsiName)) {
            this.deps.log.db?.(`Adding missing GSI '${gsiName}' to table '${tableName}'`);

            await rawClient.send(new UpdateTableCommand({
              TableName: tableName,
              GlobalSecondaryIndexUpdates: [{ Create: gsi }],
              AttributeDefinitions: this._buildAttributeDefinitions(schema),
            }));

            await this._waitForTableActive(rawClient, tableName, DescribeTableCommand);
          }
        }

        this.deps.log.db?.(`DynamoDB table '${tableName}' is ready`);
      } catch (err: unknown) {
        const code = (err as { name?: string }).name;
        if (code !== 'ResourceNotFoundException') throw err;

        // Table does not exist — create it
        this.deps.log.db?.(`Creating DynamoDB table '${tableName}'`);

        await rawClient.send(new CreateTableCommand({
          TableName: tableName,
          BillingMode: 'PAY_PER_REQUEST',
          AttributeDefinitions: this._buildAttributeDefinitions(schema),
          KeySchema: [{ AttributeName: 'id', KeyType: 'HASH' }],
          ...(gsis.length > 0 ? { GlobalSecondaryIndexes: gsis } : {}),
        }));

        await this._waitForTableActive(rawClient, tableName, DescribeTableCommand);
        this.deps.log.db?.(`Created DynamoDB table '${tableName}'`);
      }
    }
  }

  // -------------------------------------------------------------------------
  // SqlDb contract — shutdown
  // -------------------------------------------------------------------------

  async shutdown(): Promise<void> {
    this.client = this.deps.destroyDocumentClient(this.client);
  }

  // -------------------------------------------------------------------------
  // SqlDb contract — persist
  // -------------------------------------------------------------------------

  async persist(operation: string, modelName: string, context: PersistContext, response: PersistResponse): Promise<void> {
    const OrmModule = await this._getOrm();
    if (OrmModule.default?.instance?.isView?.(modelName)) return;

    switch (operation) {
      case 'create':
        return this._persistCreate(modelName, context, response);
      case 'update':
        return this._persistUpdate(modelName, context);
      case 'delete':
        return this._persistDelete(modelName, context);
    }
  }

  // -------------------------------------------------------------------------
  // SqlDb contract — findRecord
  // -------------------------------------------------------------------------

  async findRecord(modelName: string, id: unknown): Promise<OrmRecord | undefined> {
    const schemas = this.deps.introspectModels();
    const schema = schemas[modelName];
    if (!schema) return undefined;

    const tableName = sanitizeTableName(this.deps.getPluralName(modelName));
    const { GetCommand } = await this.deps.loadDocClientCommands();

    const params = this.deps.buildGetItem(tableName, { id });

    try {
      const result = await this.requireClient().send(new GetCommand(params)) as {
        Item?: Record<string, unknown>;
      };

      if (!result.Item) return undefined;

      const rawData = this._itemToRawData(result.Item, schema);
      const record = this.deps.createRecord(modelName, rawData, {
        isDbRecord: true, serialize: false, transform: false,
      }) as unknown as OrmRecord;

      this._evictIfNotMemory(modelName, record);
      return record;
    } catch (err: unknown) {
      if ((err as { name?: string }).name === 'ResourceNotFoundException') return undefined;
      throw err;
    }
  }

  // -------------------------------------------------------------------------
  // SqlDb contract — findAll
  // -------------------------------------------------------------------------

  async findAll(modelName: string, conditions?: Record<string, unknown>): Promise<OrmRecord[]> {
    const schemas = this.deps.introspectModels();
    const schema = schemas[modelName];
    if (!schema) return [];

    const tableName = sanitizeTableName(this.deps.getPluralName(modelName));

    try {
      let items: Record<string, unknown>[];

      if (!conditions || Object.keys(conditions).length === 0) {
        items = await this._paginatedScan(tableName);
      } else {
        // Try to route through a GSI if one matches a condition key
        const gsiMatch = this._findGsiMatch(modelName, conditions);

        if (gsiMatch) {
          const { indexName, keyConditions, remainingConditions } = gsiMatch;
          items = await this._paginatedQuery(tableName, indexName, keyConditions);

          // Filter remaining non-key conditions in memory
          if (Object.keys(remainingConditions).length > 0) {
            items = items.filter(item =>
              Object.entries(remainingConditions).every(([k, v]) => item[k] === v)
            );
          }
        } else {
          // No GSI — fall back to Scan + FilterExpression (warn)
          this.deps.log.warn?.(
            `[DynamoDB] findAll('${modelName}') using Scan+FilterExpression — no GSI for conditions: ${JSON.stringify(conditions)}. Add a GSI index for better performance.`
          );
          items = await this._paginatedScan(tableName, conditions);
        }
      }

      const records = items.map(item => {
        const rawData = this._itemToRawData(item, schema);
        return this.deps.createRecord(modelName, rawData, {
          isDbRecord: true, serialize: false, transform: false,
        }) as unknown as OrmRecord;
      });

      for (const record of records) {
        this._evictIfNotMemory(modelName, record);
      }

      return records;
    } catch (err: unknown) {
      if ((err as { name?: string }).name === 'ResourceNotFoundException') return [];
      throw err;
    }
  }

  // -------------------------------------------------------------------------
  // loadMemoryRecords
  // -------------------------------------------------------------------------

  async loadMemoryRecords(): Promise<void> {
    const schemas = this.deps.introspectModels();
    const order = this.deps.getTopologicalOrder(schemas);
    const OrmModule = await this._getOrm();
    const Orm = OrmModule.default;

    for (const modelName of order) {
      const { modelClass } = Orm.instance.getRecordClasses(modelName);

      if (modelClass?.memory === false) {
        this.deps.log.db?.(`Skipping memory load for '${modelName}' (memory: false)`);
        continue;
      }

      const schema = schemas[modelName];
      const tableName = sanitizeTableName(this.deps.getPluralName(modelName));

      try {
        const items = await this._paginatedScan(tableName);

        for (const item of items) {
          const rawData = this._itemToRawData(item, schema);
          this.deps.createRecord(modelName, rawData, {
            isDbRecord: true, serialize: false, transform: false,
          });
        }
      } catch (err: unknown) {
        if ((err as { name?: string }).name === 'ResourceNotFoundException') {
          this.deps.log.db?.(`Table '${tableName}' does not exist yet. Skipping load for '${modelName}'.`);
          continue;
        }
        throw err;
      }
    }
  }

  // -------------------------------------------------------------------------
  // Private — persist helpers
  // -------------------------------------------------------------------------

  private async _persistCreate(modelName: string, context: PersistContext, response: PersistResponse): Promise<void> {
    const schemas = this.deps.introspectModels();
    const schema = schemas[modelName];
    if (!schema) return;

    const recordId = response?.data?.id;
    const storeRef = this.deps.store as unknown as { get(name: string, id: unknown): OrmRecord | null };
    const record = recordId != null ? storeRef.get(modelName, recordId) : null;
    if (!record) return;

    const isPendingId = context.rawData?.__pendingSqlId === true;
    const tableName = sanitizeTableName(this.deps.getPluralName(modelName));

    // For numeric-ID models with a pending ID, generate a ULID
    let finalId: unknown = record.id;
    if (isPendingId) {
      finalId = generateUlid();
    }

    const item = this._recordToItem(record, schema, context.rawData);
    item.id = finalId;

    const { PutCommand } = await this.deps.loadDocClientCommands();
    const params = this.deps.buildPutItem(tableName, item, 'attribute_not_exists(id)');
    await this.requireClient().send(new PutCommand(params));

    // Re-key the store record if we generated a new ID
    if (isPendingId) {
      const pendingId = record.id;
      const modelStoreMap = (this.deps.store as unknown as { get(name: string): Map<unknown, unknown> }).get(modelName);
      modelStoreMap.delete(pendingId);
      record.__data.id = finalId as string | number;
      record.id = finalId as string | number;
      modelStoreMap.set(finalId as string | number, record);

      if (response?.data) response.data.id = finalId;
      delete record.__data.__pendingSqlId;
    }
  }

  private async _persistUpdate(modelName: string, context: PersistContext): Promise<void> {
    const schemas = this.deps.introspectModels();
    const schema = schemas[modelName];
    if (!schema) return;

    const record = context.record;
    if (!record) return;

    const tableName = sanitizeTableName(this.deps.getPluralName(modelName));
    const id = record.id;
    const oldState = context.oldState || {};
    const currentData = record.__data;

    // Build diff of changed columns
    const changedData: Record<string, unknown> = {};

    for (const col of Object.keys(schema.columns)) {
      if (currentData[col] !== oldState[col]) {
        changedData[col] = currentData[col] ?? null;
      }
    }

    // FK changes
    for (const fkCol of Object.keys(schema.foreignKeys)) {
      const relName = fkCol.replace(/_id$/, '');
      const relValue = record.__relationships[relName];
      const currentFkValue = relValue && typeof relValue === 'object' && relValue !== null
        ? (relValue as { id: unknown }).id ?? null
        : relValue ?? record.__data[relName] ?? null;
      const oldFkValue = oldState[relName] ?? null;

      if (currentFkValue !== oldFkValue) changedData[fkCol] = currentFkValue;
    }

    if (Object.keys(changedData).length === 0) return;

    const { UpdateCommand } = await this.deps.loadDocClientCommands();
    const params = this.deps.buildUpdateItem(tableName, { id }, changedData);
    await this.requireClient().send(new UpdateCommand(params));
  }

  private async _persistDelete(modelName: string, context: PersistContext): Promise<void> {
    const schemas = this.deps.introspectModels();
    const schema = schemas[modelName];
    if (!schema) return;

    const id = context.recordId;
    if (id == null) return;

    const tableName = sanitizeTableName(this.deps.getPluralName(modelName));
    const { DeleteCommand } = await this.deps.loadDocClientCommands();
    const params = this.deps.buildDeleteItem(tableName, { id });
    await this.requireClient().send(new DeleteCommand(params));
  }

  // -------------------------------------------------------------------------
  // Private — pagination helpers
  // -------------------------------------------------------------------------

  private async _paginatedScan(tableName: string, conditions?: Record<string, unknown>): Promise<Record<string, unknown>[]> {
    const { ScanCommand } = await this.deps.loadDocClientCommands();
    const items: Record<string, unknown>[] = [];
    let lastKey: Record<string, unknown> | undefined;

    do {
      const params = this.deps.buildScan(tableName, conditions, lastKey);
      const result = await this.requireClient().send(new ScanCommand(params)) as {
        Items?: Record<string, unknown>[];
        LastEvaluatedKey?: Record<string, unknown>;
      };

      if (result.Items) items.push(...result.Items);
      lastKey = result.LastEvaluatedKey;
    } while (lastKey);

    return items;
  }

  private async _paginatedQuery(tableName: string, indexName: string, keyConditions: Record<string, unknown>): Promise<Record<string, unknown>[]> {
    const { QueryCommand } = await this.deps.loadDocClientCommands();
    const items: Record<string, unknown>[] = [];
    let lastKey: Record<string, unknown> | undefined;

    do {
      const params = this.deps.buildQuery(tableName, indexName, keyConditions, lastKey);
      const result = await this.requireClient().send(new QueryCommand(params)) as {
        Items?: Record<string, unknown>[];
        LastEvaluatedKey?: Record<string, unknown>;
      };

      if (result.Items) items.push(...result.Items);
      lastKey = result.LastEvaluatedKey;
    } while (lastKey);

    return items;
  }

  // -------------------------------------------------------------------------
  // Private — GSI registry
  // -------------------------------------------------------------------------

  /**
   * Build the GSI registry from model introspection.
   * Registry: modelName → attrName → gsiName
   *
   * FK columns (belonging to belongsTo relationships) get a GSI automatically.
   */
  private _buildGsiRegistry(): void {
    const schemas = this.deps.introspectModels();

    for (const [modelName, schema] of Object.entries(schemas)) {
      const tableName = sanitizeTableName(this.deps.getPluralName(modelName));
      const modelGsis = new Map<string, string>();

      for (const fkCol of Object.keys(schema.foreignKeys)) {
        const gsiName = `${tableName}-${fkCol}-index`;
        modelGsis.set(fkCol, gsiName);
      }

      this._gsiRegistry.set(modelName, modelGsis);
    }
  }

  /**
   * Find a GSI that can serve the given conditions.
   */
  private _findGsiMatch(modelName: string, conditions: Record<string, unknown>): {
    indexName: string;
    keyConditions: Record<string, unknown>;
    remainingConditions: Record<string, unknown>;
  } | null {
    const modelGsis = this._gsiRegistry.get(modelName);
    if (!modelGsis) return null;

    for (const [attrName, indexName] of modelGsis) {
      if (conditions[attrName] !== undefined) {
        const keyConditions: Record<string, unknown> = { [attrName]: conditions[attrName] };
        const remainingConditions: Record<string, unknown> = {};

        for (const [k, v] of Object.entries(conditions)) {
          if (k !== attrName) remainingConditions[k] = v;
        }

        return { indexName, keyConditions, remainingConditions };
      }
    }

    return null;
  }

  // -------------------------------------------------------------------------
  // Private — table provisioning helpers
  // -------------------------------------------------------------------------

  private _buildAttributeDefinitions(schema: ModelSchema): Array<{ AttributeName: string; AttributeType: string }> {
    const defs: Array<{ AttributeName: string; AttributeType: string }> = [
      { AttributeName: 'id', AttributeType: this.deps.getDynamoKeyType(schema.idType) },
    ];

    for (const fkCol of Object.keys(schema.foreignKeys)) {
      defs.push({ AttributeName: fkCol, AttributeType: 'S' });
    }

    // Deduplicate
    const seen = new Set<string>();
    return defs.filter(d => {
      if (seen.has(d.AttributeName)) return false;
      seen.add(d.AttributeName);
      return true;
    });
  }

  private _buildGsiDefinitions(modelName: string, schema: ModelSchema): unknown[] {
    const tableName = sanitizeTableName(this.deps.getPluralName(modelName));
    const gsis: unknown[] = [];

    for (const fkCol of Object.keys(schema.foreignKeys)) {
      const gsiName = `${tableName}-${fkCol}-index`;
      gsis.push({
        IndexName: gsiName,
        KeySchema: [{ AttributeName: fkCol, KeyType: 'HASH' }],
        Projection: { ProjectionType: 'ALL' },
      });
    }

    return gsis;
  }

  private async _waitForTableActive(
    rawClient: { send(cmd: unknown): Promise<unknown> },
    tableName: string,
    DescribeTableCommand: new (p: unknown) => unknown,
  ): Promise<void> {
    const MAX_POLLS = 60;
    const POLL_INTERVAL = 2000;

    for (let i = 0; i < MAX_POLLS; i++) {
      const desc = await rawClient.send(new DescribeTableCommand({ TableName: tableName })) as {
        Table?: { TableStatus?: string };
      };

      if (desc.Table?.TableStatus === 'ACTIVE') return;
      await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL));
    }

    throw new Error(`DynamoDB table '${tableName}' did not become ACTIVE within ${MAX_POLLS * POLL_INTERVAL / 1000}s`);
  }

  // -------------------------------------------------------------------------
  // Private — data conversion
  // -------------------------------------------------------------------------

  private _itemToRawData(item: Record<string, unknown>, schema: ModelSchema): Record<string, unknown> {
    const rawData: Record<string, unknown> = { ...item };

    // Map FK columns back to relationship keys (matching PostgresDB pattern)
    for (const [fkCol] of Object.entries(schema.foreignKeys)) {
      const relName = fkCol.replace(/_id$/, '');
      if (rawData[fkCol] !== undefined) {
        rawData[relName] = rawData[fkCol];
        delete rawData[fkCol];
      }
    }

    return rawData;
  }

  private _recordToItem(record: OrmRecord, schema: ModelSchema, rawData?: Record<string, unknown>): Record<string, unknown> {
    const item: Record<string, unknown> = {};
    const data = record.__data;

    if (data.id !== undefined) item.id = data.id;

    for (const col of Object.keys(schema.columns)) {
      if (data[col] !== undefined) item[col] = data[col];
    }

    for (const fkCol of Object.keys(schema.foreignKeys)) {
      const relName = fkCol.replace(/_id$/, '');
      const related = record.__relationships[relName];

      if (related && typeof related === 'object' && related !== null) {
        item[fkCol] = (related as { id: unknown }).id;
      } else if (related != null) {
        item[fkCol] = related;
      } else if (data[relName] !== undefined) {
        item[fkCol] = data[relName];
      } else if (rawData?.[relName] !== undefined) {
        item[fkCol] = rawData[relName];
      }
    }

    return item;
  }

  // -------------------------------------------------------------------------
  // Private — store eviction
  // -------------------------------------------------------------------------

  private _evictIfNotMemory(modelName: string, record: OrmRecord): void {
    const storeRef = this.deps.store as {
      _memoryResolver?: (name: string) => boolean;
      get?: (name: string) => Map<unknown, unknown> | undefined;
      data?: { get(name: string): Map<unknown, unknown> | undefined };
    };

    if (storeRef._memoryResolver && !storeRef._memoryResolver(modelName)) {
      const modelStore = storeRef.get?.(modelName) ?? storeRef.data?.get(modelName);
      if (modelStore) modelStore.delete(record.id);
    }
  }

  // -------------------------------------------------------------------------
  // Deprecated alias
  // -------------------------------------------------------------------------

  async loadAllRecords(): Promise<void> {
    return this.loadMemoryRecords();
  }
}
