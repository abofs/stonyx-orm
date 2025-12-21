import Orm, { store, relationships } from '@stonyx/orm';
import Record from './record.js';

const defaultOptions = {
  isDbRecord: false,
  serialize: true,
  transform: true
};

export function createRecord(modelName, rawData={}, userOptions={}) {
  const orm = Orm.instance;
  const { initialized } = Orm;
  const options = { ...defaultOptions, ...userOptions };

  if (!initialized && !options.isDbRecord) throw new Error('ORM is not ready');

  const modelStore = store.get(modelName);
  const globalRelationships = relationships.get('global');
  const pendingRelationships = relationships.get('pending');

  assignRecordId(modelName, rawData);
  if (modelStore.has(rawData.id)) return modelStore.get(rawData.id);

  const { modelClass, serializerClass } = orm.getRecordClasses(modelName);

  if (!modelClass) throw new Error(`A model named '${modelName}' does not exist`);

  const model = new modelClass(modelName);
  const serializer = new serializerClass(model);
  const record = new Record(model, serializer);

  record.serialize(rawData, options);
  modelStore.set(record.id, record);

  // populate global hasMany relationships
  const globalHasMany = globalRelationships.get(modelName);
  if (globalHasMany) for (const relationship of globalHasMany) relationship.push(record);

  // populate pending hasMany relationships and clear the queue
  const pendingHasMany = pendingRelationships.get(modelName)?.get(record.id);
  if (pendingHasMany) {
    for (const relationship of pendingHasMany) relationship.push(record);
    pendingHasMany.splice(0);
  }

  // Fulfill pending belongsTo relationships
  const pendingBelongsToQueue = relationships.get('pendingBelongsTo');
  const pendingBelongsTo = pendingBelongsToQueue.get(modelName)?.get(record.id);

  if (pendingBelongsTo) {
    const belongsToReg = relationships.get('belongsTo');
    const hasManyReg = relationships.get('hasMany');

    for (const { sourceRecord, sourceModelName, relationshipKey, relationshipId } of pendingBelongsTo) {
      // Update the belongsTo relationship on the source record
      sourceRecord.__relationships[relationshipKey] = record;
      sourceRecord[relationshipKey] = record; // Also update the direct property

      // Update the belongsTo relationship registry
      const sourceModelReg = belongsToReg.get(sourceModelName);
      if (sourceModelReg) {
        const targetModelReg = sourceModelReg.get(modelName);
        if (targetModelReg) {
          targetModelReg.set(relationshipId, record);
        }
      }

      // Wire inverse hasMany if it exists
      const inverseHasMany = hasManyReg.get(modelName)?.get(sourceModelName)?.get(record.id);

      if (inverseHasMany && !inverseHasMany.includes(sourceRecord)) {
        inverseHasMany.push(sourceRecord);
      }
    }

    // Clear the pending queue
    pendingBelongsTo.length = 0;
  }

  return record;
}

export function updateRecord(record, rawData, userOptions={}) {
  if (!rawData) throw new Error('rawData must be passed in to updateRecord call');

  const options = { ...defaultOptions, ...userOptions, update:true };

  record.serialize(rawData, options);
}

/**
 * gets the next available id based on last record entry.
 * 
 * Note/TODO: Records going into a db should get their id from the db instead
 * Atm, i think the best way to do that would be as an id override that happens after the
 * record is created
 */
function assignRecordId(modelName, rawData) {
  if (rawData.id) return;

  const modelStore = Array.from(store.get(modelName).values());
  rawData.id = modelStore.length ? modelStore.at(-1).id + 1 : 1;
}
