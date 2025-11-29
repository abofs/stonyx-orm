import { createRecord, relationships, store } from '@stonyx/orm';
import { getRelationshipInfo } from './relationships.js';

export default function belongsTo(modelName) {
  const hasManyRelationships = relationships.get('hasMany');
  const pendingRelationships = relationships.get('pending');

  return (sourceRecord, rawData, options) => {
    if (!rawData) return null;

    const { __name: sourceModelName } = sourceRecord.__model;
    const relationshipId = sourceRecord.id;
    const relationship = getRelationshipInfo('belongsTo', sourceModelName, modelName, relationshipId);
    const modelStore = store.get(modelName);
    const output = typeof rawData === 'object' ? createRecord(modelName, rawData, options) : modelStore.get(rawData) || null;

    relationship.set(relationshipId, output || {});

    // Populate belongTo side if the relationship is defined
    const otherSide = hasManyRelationships.get(modelName)?.get(sourceModelName)?.get(output?.id);

    if (otherSide) {
      otherSide.push(sourceRecord);

      // Remove pending queue if it was just fulfilled
      const pendingModelRelationships = pendingRelationships.get(sourceModelName);
      
      if (pendingModelRelationships) pendingModelRelationships.delete(relationshipId);
    }

    return output;
  }
}