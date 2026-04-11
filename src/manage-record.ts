import Orm, { store } from '@stonyx/orm';
import OrmRecord from './record.js';
import { getGlobalRegistry, getPendingRegistry, getPendingBelongsToRegistry, getBelongsToRegistry, getHasManyRegistry } from './relationships.js';
import type Serializer from './serializer.js';

interface CreateRecordOptions {
  isDbRecord?: boolean;
  serialize?: boolean;
  transform?: boolean;
  update?: boolean;
  [key: string]: unknown;
}

interface PendingBelongsToEntry {
  sourceRecord: OrmRecord;
  sourceModelName: string;
  relationshipKey: string;
  relationshipId: unknown;
}

const defaultOptions: CreateRecordOptions = {
  isDbRecord: false,
  serialize: true,
  transform: true
};

export function createRecord(modelName: string, rawData: { [key: string]: unknown } = {}, userOptions: CreateRecordOptions = {}): OrmRecord {
  const orm = Orm.instance;
  const { initialized } = Orm;
  const options = { ...defaultOptions, ...userOptions };

  if (!initialized && !options.isDbRecord) throw new Error('ORM is not ready');

  // Guard: read-only views cannot have records created directly
  if (orm?.isView?.(modelName) && !options.isDbRecord) {
    throw new Error(`Cannot create records for read-only view '${modelName}'`);
  }

  const modelStore = store.get(modelName);
  const globalRelationships = getGlobalRegistry();
  const pendingRelationships = getPendingRegistry();

  if (!modelStore) throw new Error(`Model store for '${modelName}' is not registered. Ensure the model is defined before creating records.`);

  assignRecordId(modelName, rawData);
  if (modelStore.has(rawData.id as number | string)) return modelStore.get(rawData.id as number | string)! as OrmRecord;

  const recordClasses = orm.getRecordClasses(modelName);
  const modelClass = recordClasses.modelClass as (new (name: string) => { __name: string; [key: string]: unknown }) | undefined;
  const serializerClass = recordClasses.serializerClass as new (model: { [key: string]: unknown }) => Serializer;

  if (!modelClass) throw new Error(`A model named '${modelName}' does not exist`);

  const model = new modelClass(modelName);
  const serializer = new serializerClass(model);
  const record = new OrmRecord(model, serializer);

  record.serialize(rawData, options);
  modelStore.set(record.id as number | string, record);

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
  const pendingBelongsToQueue = getPendingBelongsToRegistry();
  const pendingBelongsTo = pendingBelongsToQueue.get(modelName)?.get(record.id) as PendingBelongsToEntry[] | undefined;

  if (pendingBelongsTo) {
    const belongsToReg = getBelongsToRegistry();
    const hasManyReg = getHasManyRegistry();

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

export function updateRecord(record: OrmRecord, rawData: unknown, userOptions: CreateRecordOptions = {}): void {
  if (!rawData) throw new Error('rawData must be passed in to updateRecord call');

  // Guard: read-only views cannot be updated
  const modelName = record?.__model?.__name;
  if (modelName && Orm.instance?.isView?.(modelName)) {
    throw new Error(`Cannot update records for read-only view '${modelName}'`);
  }

  const options = { ...defaultOptions, ...userOptions, update: true };

  record.serialize(rawData, options);
}

/**
 * gets the next available id based on last record entry.
 *
 * In MySQL mode with numeric IDs, assigns a temporary pending ID.
 * MySQL's AUTO_INCREMENT provides the real ID after INSERT.
 */
function assignRecordId(modelName: string, rawData: { [key: string]: unknown }): void {
  if (rawData.id) return;

  // In SQL mode with numeric IDs, defer to database auto-increment
  if (Orm.instance?.sqlDb && !isStringIdModel(modelName)) {
    rawData.id = `__pending_${Date.now()}_${Math.random()}`;
    rawData.__pendingSqlId = true;
    return;
  }

  const modelStore = Array.from(store.get(modelName)!.values()) as OrmRecord[];
  rawData.id = modelStore.length ? (modelStore.at(-1)!.id as number) + 1 : 1;
}

function isStringIdModel(modelName: string): boolean {
  const modelClass = Orm.instance.getRecordClasses(modelName).modelClass as (new (name: string) => { [key: string]: unknown }) | undefined;
  if (!modelClass) return false;

  const model = new modelClass(modelName);

  return (model.id as { type?: string } | undefined)?.type === 'string';
}
