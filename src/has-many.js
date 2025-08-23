import { createRecord, relationships, store } from '@stonyx/orm';
import { getRelationshipInfo } from './relationships.js';
import { makeArray } from '@stonyx/utils/object';

export default function hasMany(modelName) {
  return (sourceRecord, rawData) => {
    const { __name: sourceModelName } = sourceRecord.__model;
    const relationshipId = sourceRecord.id._value;
    const relationship = getRelationshipInfo('hasMany', sourceModelName, modelName, relationshipId);    
    const modelStore = store.get(modelName);
    const output = !rawData ? [] : makeArray(rawData).map(elementData => {
      let record;

      if (typeof rawData !== 'object') {
        record = modelStore.get(rawData);

        if (!record) return null;
      } else {
        record = createRecord(modelName, elementData);
      }

      // Populate belongTo side if the relationship is defined
      const otherSide = relationships.get('belongsTo').get(modelName)?.get(sourceModelName)?.get(record.id._value);

      if (otherSide) Object.assign(otherSide, sourceRecord);

      return record;
    });

    relationship.set(relationshipId, output);

    return output;
  }
}