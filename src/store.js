import Orm, { relationships } from '@stonyx/orm';
import { TYPES } from './relationships.js';
import ViewResolver from './view-resolver.js';

export default class Store {
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
  get(key, id) {
    if (!id) return this.data.get(key);

    return this.data.get(key)?.get(id);
  }

  /**
   * Async authoritative read. Always queries MySQL for memory: false models.
   * For memory: true models, returns from store (already loaded on boot).
   * @param {string} modelName - The model name
   * @param {string|number} id - The record ID
   * @returns {Promise<Record|undefined>}
   */
  async find(modelName, id) {
    // For views in non-MySQL mode, use view resolver
    if (Orm.instance?.isView?.(modelName) && !this._mysqlDb) {
      const resolver = new ViewResolver(modelName);
      return resolver.resolveOne(id);
    }

    // For memory: true models, the store is authoritative
    if (this._isMemoryModel(modelName)) {
      return this.get(modelName, id);
    }

    // For memory: false models, always query MySQL
    if (this._mysqlDb) {
      return this._mysqlDb.findRecord(modelName, id);
    }

    // Fallback to store (JSON mode or no MySQL)
    return this.get(modelName, id);
  }

  /**
   * Async read for all records of a model. Always queries MySQL for memory: false models.
   * For memory: true models, returns from store.
   * @param {string} modelName - The model name
   * @param {Object} [conditions] - Optional WHERE conditions
   * @returns {Promise<Record[]>}
   */
  async findAll(modelName, conditions) {
    // For views in non-MySQL mode, use view resolver
    if (Orm.instance?.isView?.(modelName) && !this._mysqlDb) {
      const resolver = new ViewResolver(modelName);
      const records = await resolver.resolveAll();

      if (!conditions || Object.keys(conditions).length === 0) return records;

      return records.filter(record =>
        Object.entries(conditions).every(([key, value]) => record.__data[key] === value)
      );
    }

    // For memory: true models without conditions, return from store
    if (this._isMemoryModel(modelName) && !conditions) {
      const modelStore = this.get(modelName);
      return modelStore ? Array.from(modelStore.values()) : [];
    }

    // For memory: false models (or filtered queries), always query MySQL
    if (this._mysqlDb) {
      return this._mysqlDb.findAll(modelName, conditions);
    }

    // Fallback to store (JSON mode) — apply conditions in-memory if provided
    const modelStore = this.get(modelName);
    if (!modelStore) return [];

    const records = Array.from(modelStore.values());

    if (!conditions || Object.keys(conditions).length === 0) return records;

    return records.filter(record =>
      Object.entries(conditions).every(([key, value]) => record.__data[key] === value)
    );
  }

  /**
   * Async query — always hits MySQL, never reads from memory cache.
   * Use for complex queries, aggregations, or when you need guaranteed freshness.
   * @param {string} modelName - The model name
   * @param {Object} conditions - WHERE conditions
   * @returns {Promise<Record[]>}
   */
  async query(modelName, conditions = {}) {
    if (this._mysqlDb) {
      return this._mysqlDb.findAll(modelName, conditions);
    }

    // Fallback: filter in-memory store
    const modelStore = this.get(modelName);
    if (!modelStore) return [];

    const records = Array.from(modelStore.values());

    if (Object.keys(conditions).length === 0) return records;

    return records.filter(record =>
      Object.entries(conditions).every(([key, value]) => record.__data[key] === value)
    );
  }

  /**
   * Set by Orm during init — resolves memory flag for a model name.
   * @type {Function|null}
   */
  _memoryResolver = null;

  /**
   * Set by Orm during init — reference to the MysqlDB instance for on-demand queries.
   * @type {MysqlDB|null}
   */
  _mysqlDb = null;

  /**
   * Check if a model is configured for in-memory storage.
   * @private
   */
  _isMemoryModel(modelName) {
    if (this._memoryResolver) return this._memoryResolver(modelName);
    return false; // default to non-memory if resolver not set yet
  }

  set(key, value) {
    this.data.set(key, value);
  }

  remove(key, id) {
    // Guard: read-only views cannot have records removed
    if (Orm.instance?.isView?.(key)) {
      throw new Error(`Cannot remove records from read-only view '${key}'`);
    }

    if (id) return this.unloadRecord(key, id);

    this.unloadAllRecords(key);
  }

  unloadRecord(model, id, options={}) {
    const modelStore = this.data.get(model);

    if (!modelStore) {
      console.warn(`[Store] Cannot unload record: model "${model}" not found in store`);
      return;
    }

    const record = modelStore.get(id);

    if (!record) {
      console.warn(`[Store] Cannot unload record: ${model}:${id} not found in store`);
      return;
    }

    const { toUnload, visited } = options.includeChildren
      ? this._buildUnloadQueue(record, options)
      : { toUnload: [{ record, modelName: model, recordId: id }], visited: new Set([`${model}:${id}`]) };

    for (const item of toUnload.reverse()) {
      const { record: recordToUnload, modelName, recordId } = item;

      this._removeFromHasManyArrays(modelName, recordId, visited);
      this._nullifyBelongsToReferences(modelName, recordId, visited);
      this._cleanupRelationshipRegistries(modelName, recordId);
      recordToUnload.clean();

      this.data.get(modelName).delete(recordId);
    }
  }

  unloadAllRecords(model, options={}) {
    const modelStore = this.data.get(model);

    if (!modelStore) {
      console.warn(`[Store] Cannot unload all records: model "${model}" not found in store`);
      return;
    }

    const recordIds = Array.from(modelStore.keys());

    for (const id of recordIds) {
      if (modelStore.has(id)) {
        this.unloadRecord(model, id, options);
      }
    }

    for (const relationshipType of TYPES) relationships.get(relationshipType).delete(model);
  }

  _removeFromHasManyArrays(modelName, recordId, visited) {
    const hasManyRegistry = relationships.get('hasMany');

    for (const [sourceModel, targetModels] of hasManyRegistry) {
      const targetModelMap = targetModels.get(modelName);
      if (!targetModelMap) continue;

      for (const [sourceRecordId, hasManyArray] of targetModelMap) {
        const sourceKey = `${sourceModel}:${sourceRecordId}`;

        // Don't modify arrays of records being deleted
        if (visited.has(sourceKey)) continue;

        const index = hasManyArray.findIndex(r => r && r.id === recordId);
        if (index !== -1) hasManyArray.splice(index, 1);
      }
    }
  }

  _nullifyBelongsToReferences(modelName, recordId, visited) {
    const belongsToRegistry = relationships.get('belongsTo');

    for (const [sourceModel, targetModels] of belongsToRegistry) {
      const targetModelMap = targetModels.get(modelName);
      if (!targetModelMap) continue;

      for (const [sourceRecordId, belongsToRecord] of targetModelMap) {
        if (belongsToRecord && belongsToRecord.id === recordId) {
          const sourceKey = `${sourceModel}:${sourceRecordId}`;

          if (visited.has(sourceKey)) continue;
          targetModelMap.set(sourceRecordId, null);

          const sourceRecord = this.get(sourceModel, sourceRecordId);
          if (sourceRecord && sourceRecord.__relationships) {
            for (const [key, value] of Object.entries(sourceRecord.__relationships)) {
              if (value && value.id === recordId) {
                sourceRecord.__relationships[key] = null;
              }
            }
          }
        }
      }
    }
  }

  _cleanupRelationshipRegistries(modelName, recordId) {
    const hasManyMap = relationships.get('hasMany').get(modelName);
    if (hasManyMap) {
      for (const [, recordMap] of hasManyMap) recordMap.delete(recordId);
    }

    const belongsToMap = relationships.get('belongsTo').get(modelName);
    if (belongsToMap) {
      for (const [, recordMap] of belongsToMap) recordMap.delete(recordId);
    }

    const pendingMap = relationships.get('pending').get(modelName);
    if (pendingMap) pendingMap.delete(recordId);
  }

  /**
   * Extracts hasMany and non-bidirectional belongsTo children from a record
   * @private
   */
  _getChildren(record) {
    const children = [];

    if (!record.__relationships) return children;

    for (const [key, value] of Object.entries(record.__relationships)) {
      // hasMany children - always include
      if (Array.isArray(value)) {
        for (const childRecord of value) {
          if (childRecord) children.push({ childRecord, relationshipKey: key, type: 'hasMany' });
        }
      } else if (value && !this._isBidirectionalRelationship(
        record.__model.__name,
        value.__model.__name
      )) {
        children.push({ childRecord: value, relationshipKey: key, type: 'belongsTo' });
      }
    }

    return children;
  }

  _isBidirectionalRelationship(sourceModel, targetModel) {
    const hasManyRegistry = relationships.get('hasMany');
    const inverseMap = hasManyRegistry.get(targetModel)?.get(sourceModel);

    return inverseMap && inverseMap.size > 0;
  }

  _buildUnloadQueue(record, options) {
    const visited = new Set();
    const toUnload = [];
    const queue = [{
      record,
      modelName: record.__model.__name,
      recordId: record.id,
      isRoot: true,
      depth: 0
    }];

    while (queue.length > 0) {
      const item = queue.shift();
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
              depth: item.depth + 1
            });
          }
        }
      }
    }

    return { toUnload, visited };
  }
}
