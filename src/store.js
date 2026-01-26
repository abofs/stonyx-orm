import { relationships } from '@stonyx/orm';
import { TYPES } from './relationships.js';

export default class Store {
  constructor() {
    if (Store.instance) return Store.instance;
    Store.instance = this;

    this.data = new Map();
  }

  get(key, id) {
    if (!id) return this.data.get(key);

    return this.data.get(key)?.get(id);
  }

  set(key, value) {
    this.data.set(key, value);
  }

  remove(key, id) {
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
