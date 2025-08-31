import { createRecord, relationships, store } from '@stonyx/orm';
import { getRelationshipInfo } from './relationships.js';
import { getOrSet, makeArray } from '@stonyx/utils/object';
import { dbKey } from './db.js';

export default function hasMany(modelName) {
  const globalRelationships = relationships.get('global');
  const pendingRelationships = relationships.get('pending');

  return (sourceRecord, rawData, options) => {
    const { __name: sourceModelName } = sourceRecord.__model;
    const relationshipId = sourceRecord.id;
    const relationship = getRelationshipInfo('hasMany', sourceModelName, modelName, relationshipId); 
    const modelStore = store.get(modelName);
    const pendingRelationshipQueue = [];
    const output = !rawData ? [] : makeArray(rawData).map(elementData => {
      let record;

      if (typeof rawData !== 'object') {
        record = modelStore.get(rawData);

        if (!record) return null;
      } else {
        if (Number.isInteger(elementData)) {
          pendingRelationshipQueue.push({
            pendingRelationship: getOrSet(pendingRelationships, modelName, new Map()),
            id: elementData 
          });

          return null;
        }

        record = createRecord(modelName, elementData, options);
      }

      // Populate belongTo side if the relationship is defined
      const otherSide = relationships.get('belongsTo').get(modelName)?.get(sourceModelName)?.get(record.id);

      if (otherSide) Object.assign(otherSide, sourceRecord);

      return record;
    }).filter(value => value);

    relationship.set(relationshipId, output);
        
    // Assign global relationship
    if (options.global || sourceModelName === dbKey) getOrSet(globalRelationships, modelName, []).push(output);

    // Assign pending relationships
    for (const { pendingRelationship, id } of pendingRelationshipQueue) getOrSet(pendingRelationship, id, []).push(output);

    return output;
  }
}