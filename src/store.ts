import Orm, { relationships } from '@stonyx/orm';
import { TYPES, getHasManyRegistry, getBelongsToRegistry, getPendingRegistry } from './relationships.js';
import ViewResolver from './view-resolver.js';

interface UnloadOptions {
  includeChildren?: boolean;
  [key: string]: unknown;
}

interface UnloadQueueItem {
  record: StoreRecord;
  modelName: string;
  recordId: unknown;
  isRoot?: boolean;
  depth?: number;
}

interface ChildInfo {
  childRecord: StoreRecord;
  relationshipKey: string;
  type: string;
}

interface StoreRecord {
  __model: { __name: string; [key: string]: unknown };
  __data: Record<string, unknown>;
  __relationships: Record<string, unknown>;
  id: unknown;
  clean(): void;
  [key: string]: unknown;
}

function isStoreRecord(value: unknown): value is StoreRecord {
  return typeof value === 'object' && value !== null && '__data' in value;
}

export default class Store {
  static instance: Store | undefined;

  data: Map<string, Map<number | string, unknown>> = new Map();

  /**
   * Set by Orm during init — resolves memory flag for a model name.
   */
  _memoryResolver: ((modelName: string) => boolean) | null = null;

  /**
   * Set by Orm during init — reference to the SQL adapter instance for on-demand queries.
   */
  _sqlDb: { findRecord(modelName: string, id: unknown): Promise<unknown>; findAll(modelName: string, conditions?: Record<string, unknown>): Promise<unknown[]> } | null = null;

  constructor() {
    if (Store.instance) return Store.instance;
    Store.instance = this;

    this.data = new Map();
  }

  /**
   * Synchronous memory-only access.
   * Returns the record if it exists in the in-memory store, undefined otherwise.
   * Does NOT query the database. For memory:false models, use find() instead.
   */
  get(key: string): Map<number | string, unknown> | undefined;
  get(key: string, id: number | string): unknown;
  get(key: string, id?: number | string): Map<number | string, unknown> | unknown | undefined {
    if (!id) return this.data.get(key);

    return this.data.get(key)?.get(id);
  }

  /**
   * Async authoritative read. Always queries the SQL database for memory: false models.
   * For memory: true models, returns from store (already loaded on boot).
   */
  async find(modelName: string, id: number | string): Promise<unknown> {
    // For views in non-SQL mode, use view resolver
    if (Orm.instance?.isView?.(modelName) && !this._sqlDb) {
      const resolver = new ViewResolver(modelName);
      return resolver.resolveOne(id);
    }

    // For memory: true models, the store is authoritative
    if (this._isMemoryModel(modelName)) {
      return this.get(modelName, id);
    }

    // For memory: false models, always query the SQL database
    if (this._sqlDb) {
      return this._sqlDb.findRecord(modelName, id);
    }

    // Fallback to store (JSON mode or no SQL adapter)
    return this.get(modelName, id);
  }

  /**
   * Async read for all records of a model. Always queries MySQL for memory: false models.
   * For memory: true models, returns from store.
   */
  async findAll(modelName: string, conditions?: Record<string, unknown>): Promise<unknown[]> {
    // For views in non-SQL mode, use view resolver
    if (Orm.instance?.isView?.(modelName) && !this._sqlDb) {
      const resolver = new ViewResolver(modelName);
      const records = await resolver.resolveAll();

      if (!conditions || Object.keys(conditions).length === 0) return records;

      return records.filter((record: unknown) =>
        Object.entries(conditions).every(([key, value]) => isStoreRecord(record) && record.__data[key] === value)
      );
    }

    // For memory: true models without conditions, return from store
    if (this._isMemoryModel(modelName) && !conditions) {
      const modelStore = this.get(modelName);
      return modelStore ? Array.from(modelStore.values()) : [];
    }

    // For memory: false models (or filtered queries), always query the SQL database
    if (this._sqlDb) {
      return this._sqlDb.findAll(modelName, conditions);
    }

    // Fallback to store (JSON mode) — apply conditions in-memory if provided
    const modelStore = this.get(modelName);
    if (!modelStore) return [];

    const records = Array.from(modelStore.values());

    if (!conditions || Object.keys(conditions).length === 0) return records;

    return records.filter((record: unknown) =>
      Object.entries(conditions).every(([key, value]) => isStoreRecord(record) && record.__data[key] === value)
    );
  }

  /**
   * Async query — always hits MySQL, never reads from memory cache.
   * Use for complex queries, aggregations, or when you need guaranteed freshness.
   */
  async query(modelName: string, conditions: Record<string, unknown> = {}): Promise<unknown[]> {
    if (this._sqlDb) {
      return this._sqlDb.findAll(modelName, conditions);
    }

    // Fallback: filter in-memory store
    const modelStore = this.get(modelName);
    if (!modelStore) return [];

    const records = Array.from(modelStore.values());

    if (Object.keys(conditions).length === 0) return records;

    return records.filter((record: unknown) =>
      Object.entries(conditions).every(([key, value]) => isStoreRecord(record) && record.__data[key] === value)
    );
  }

  /**
   * Check if a model is configured for in-memory storage.
   * @private
   */
  private _isMemoryModel(modelName: string): boolean {
    if (this._memoryResolver) return this._memoryResolver(modelName);
    return false; // default to non-memory if resolver not set yet
  }

  set(key: string, value: Map<number | string, unknown>): void {
    this.data.set(key, value);
  }

  remove(key: string, id?: number | string): void {
    // Guard: read-only views cannot have records removed
    if (Orm.instance?.isView?.(key)) {
      throw new Error(`Cannot remove records from read-only view '${key}'`);
    }

    // Auto-persist delete to SQL
    if (id && Orm.instance?.sqlDb) {
      Orm.instance.sqlDb.persist('delete', key, { recordId: id }, {}).catch((err: unknown) => {
        Orm.instance.emitPersistError({
          operation: 'delete',
          modelName: key,
          recordId: id,
          error: err instanceof Error ? err : new Error(String(err)),
        });
      });
    }

    if (id) return this.unloadRecord(key, id);

    this.unloadAllRecords(key);
  }

  unloadRecord(model: string, id: unknown, options: UnloadOptions = {}): void {
    const modelStore = this.data.get(model);

    if (!modelStore) {
      console.warn(`[Store] Cannot unload record: model "${model}" not found in store — ensure the model is registered before unloading`);
      return;
    }

    if (typeof id !== 'string' && typeof id !== 'number') return;
    const raw = modelStore.get(id);
    if (!raw || !isStoreRecord(raw)) {
      console.warn(`[Store] Cannot unload record: ${model}:${id} not found in store — it may have already been unloaded`);
      return;
    }
    const record = raw;

    const { toUnload, visited } = options.includeChildren
      ? this._buildUnloadQueue(record, options)
      : { toUnload: [{ record, modelName: model, recordId: id }] as UnloadQueueItem[], visited: new Set([`${model}:${id}`]) };

    for (const item of toUnload.reverse()) {
      const { record: recordToUnload, modelName, recordId } = item;

      this._removeFromHasManyArrays(modelName, recordId, visited);
      this._nullifyBelongsToReferences(modelName, recordId, visited);
      this._cleanupRelationshipRegistries(modelName, recordId);
      recordToUnload.clean();

      this.data.get(modelName)?.delete(recordId as string | number);
    }
  }

  unloadAllRecords(model: string, options: UnloadOptions = {}): void {
    const modelStore = this.data.get(model);

    if (!modelStore) {
      console.warn(`[Store] Cannot unload all records: model "${model}" not found in store — ensure the model is registered before unloading`);
      return;
    }

    const recordIds = Array.from(modelStore.keys());

    for (const id of recordIds) {
      if (modelStore.has(id)) {
        this.unloadRecord(model, id, options);
      }
    }

    for (const relationshipType of TYPES) {
      const reg = relationships.get(relationshipType);
      if (reg instanceof Map) reg.delete(model);
    }
  }

  private _removeFromHasManyArrays(modelName: string, recordId: unknown, visited: Set<string>): void {
    const hasManyRegistry = getHasManyRegistry();

    for (const [sourceModel, targetModels] of hasManyRegistry) {
      const targetModelMap = targetModels.get(modelName);
      if (!targetModelMap) continue;

      for (const [sourceRecordId, hasManyArray] of targetModelMap) {
        const sourceKey = `${sourceModel}:${sourceRecordId}`;

        // Don't modify arrays of records being deleted
        if (visited.has(sourceKey)) continue;

        const index = hasManyArray.findIndex(r => r && isStoreRecord(r) && r.id === recordId);
        if (index !== -1) hasManyArray.splice(index, 1);
      }
    }
  }

  private _nullifyBelongsToReferences(modelName: string, recordId: unknown, visited: Set<string>): void {
    const belongsToRegistry = getBelongsToRegistry();

    for (const [sourceModel, targetModels] of belongsToRegistry) {
      const targetModelMap = targetModels.get(modelName);
      if (!targetModelMap) continue;

      for (const [sourceRecordId, belongsToRecord] of targetModelMap) {
        if (belongsToRecord && isStoreRecord(belongsToRecord) && belongsToRecord.id === recordId) {
          const sourceKey = `${sourceModel}:${sourceRecordId}`;

          if (visited.has(sourceKey)) continue;
          targetModelMap.set(sourceRecordId, null);

          if (typeof sourceRecordId !== 'string' && typeof sourceRecordId !== 'number') continue;
          const sourceRaw = this.get(sourceModel, sourceRecordId);
          if (!sourceRaw || !isStoreRecord(sourceRaw)) continue;
          if (sourceRaw.__relationships) {
            for (const [key, value] of Object.entries(sourceRaw.__relationships)) {
              if (value && isStoreRecord(value) && value.id === recordId) {
                sourceRaw.__relationships[key] = null;
              }
            }
          }
        }
      }
    }
  }

  private _cleanupRelationshipRegistries(modelName: string, recordId: unknown): void {
    const hasManyMap = getHasManyRegistry().get(modelName);
    if (hasManyMap) {
      for (const [, recordMap] of hasManyMap) recordMap.delete(recordId);
    }

    const belongsToMap = getBelongsToRegistry().get(modelName);
    if (belongsToMap) {
      for (const [, recordMap] of belongsToMap) recordMap.delete(recordId);
    }

    const pendingMap = getPendingRegistry().get(modelName);
    if (pendingMap) pendingMap.delete(recordId);
  }

  /**
   * Extracts hasMany and non-bidirectional belongsTo children from a record
   * @private
   */
  private _getChildren(record: StoreRecord): ChildInfo[] {
    const children: ChildInfo[] = [];

    if (!record.__relationships) return children;

    for (const [key, value] of Object.entries(record.__relationships)) {
      // hasMany children - always include
      if (Array.isArray(value)) {
        for (const childRecord of value) {
          if (childRecord && isStoreRecord(childRecord)) children.push({ childRecord, relationshipKey: key, type: 'hasMany' });
        }
      } else if (value && isStoreRecord(value) && value.__model && !this._isBidirectionalRelationship(
        record.__model.__name,
        (value as StoreRecord).__model.__name
      )) {
        children.push({ childRecord: value as StoreRecord, relationshipKey: key, type: 'belongsTo' });
      }
    }

    return children;
  }

  private _isBidirectionalRelationship(sourceModel: string, targetModel: string): boolean {
    const inverseMap = getHasManyRegistry().get(targetModel)?.get(sourceModel);

    return !!inverseMap && inverseMap.size > 0;
  }

  private _buildUnloadQueue(record: StoreRecord, options: UnloadOptions): { toUnload: UnloadQueueItem[]; visited: Set<string> } {
    const visited = new Set<string>();
    const toUnload: UnloadQueueItem[] = [];
    const queue: UnloadQueueItem[] = [{
      record,
      modelName: record.__model.__name,
      recordId: record.id,
      isRoot: true,
      depth: 0
    }];

    while (queue.length > 0) {
      const item = queue.shift();
      if (!item) break;
      const key = `${item.modelName}:${item.recordId}`;

      if (visited.has(key)) continue;
      visited.add(key);

      toUnload.push(item);

      // Add children to queue if includeChildren is enabled
      if (options.includeChildren) {
        const children = this._getChildren(item.record);
        for (const { childRecord } of children) {
          if (childRecord) {
            queue.push({
              record: childRecord,
              modelName: childRecord.__model.__name,
              recordId: childRecord.id,
              isRoot: false,
              depth: (item.depth ?? 0) + 1
            });
          }
        }
      }
    }

    return { toUnload, visited };
  }
}
