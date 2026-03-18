import { createRecord, relationships, store } from '@stonyx/orm';
import { getRelationships } from './relationships.js';

function getOrSet(map, key, defaultValue) {
  if (!map.has(key)) map.set(key, defaultValue);
  return map.get(key);
}

export default function belongsTo(modelName) {
  const hasManyRelationships = relationships.get('hasMany');
  const pendingHasManyQueue = relationships.get('pending');
  const pendingBelongsToQueue = relationships.get('pendingBelongsTo');

  const fn = (sourceRecord, rawData, options) => {
    if (!rawData) return null;

    const { __name: sourceModelName } = sourceRecord.__model;
    const relationshipId = sourceRecord.id;
    const relationshipKey = options._relationshipKey;
    const relationship = getRelationships('belongsTo', sourceModelName, modelName, relationshipId);
    const modelStore = store.get(modelName);

    // Try to get existing record
    const output = typeof rawData === 'object'
      ? createRecord(modelName, rawData, options)
      : modelStore.get(rawData);

    // If not found and is a string ID, register as pending
    if (!output && typeof rawData !== 'object') {
      const targetId = rawData;

      // Register pending belongsTo
      const modelPendingMap = getOrSet(pendingBelongsToQueue, modelName, new Map());
      const targetPendingArray = getOrSet(modelPendingMap, targetId, []);

      targetPendingArray.push({
        sourceRecord,
        sourceModelName,
        relationshipKey,
        relationshipId
      });

      relationship.set(relationshipId, null);
      return null;
    }

    relationship.set(relationshipId, output || {});

    // Populate hasMany side if the relationship is defined
    const otherSide = hasManyRelationships.get(modelName)?.get(sourceModelName)?.get(output?.id);

    if (otherSide) {
      otherSide.push(sourceRecord);

      // Remove pending queue if it was just fulfilled
      const pendingModelRelationships = pendingHasManyQueue.get(sourceModelName);

      if (pendingModelRelationships) pendingModelRelationships.delete(relationshipId);
    }

    return output;
  }

  fn.__relatedModelName = modelName;
  return fn;
}