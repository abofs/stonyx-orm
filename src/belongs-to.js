import { createRecord, relationships, store } from '@stonyx/orm';
import { getRelationshipInfo } from './relationships.js';

export default function belongsTo(modelName) {
  return (sourceRecord, rawData) => {
    if (!rawData) return null;

    const { __name: sourceModelName } = sourceRecord.__model;
    const relationshipId = sourceRecord.id._value;
    const relationship = getRelationshipInfo('belongsTo', sourceModelName, modelName, relationshipId);
    const modelStore = store.get(modelName);
    const output = (typeof rawData !== 'object' ? modelStore.get(rawData) : null) || createRecord(modelName, rawData);

    relationship.set(relationshipId, output || {});

    // Populate belongTo side if the relationship is defined
    const otherSide = relationships.get('hasMany').get(modelName)?.get(sourceModelName)?.get(output?.id._value);

    if (otherSide) otherSide.push(sourceRecord);

    return output;
  }
}