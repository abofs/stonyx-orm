import { store, relationships } from './main.js';
import { createRecord } from './manage-record.js';
import { getRelationships } from './relationships.js';
import { getOrSet, makeArray } from '@stonyx/utils/object';
import { dbKey } from './db.js';

interface HasManyOptions {
  global?: boolean;
  [key: string]: unknown;
}

interface SourceRecord {
  __model: { __name: string; [key: string]: unknown };
  id: unknown;
  [key: string]: unknown;
}

interface PendingItem {
  pendingRelationship: Map<unknown, unknown[][]>;
  id: unknown;
}

type RelationshipHandler = ((sourceRecord: SourceRecord, rawData: unknown, options: HasManyOptions) => unknown[]) & {
  __relatedModelName: string;
};

function queuePendingRelationship(
  pendingRelationshipQueue: PendingItem[],
  pendingRelationships: Map<string, Map<unknown, unknown[][]>>,
  modelName: string,
  id: unknown
): null {
  pendingRelationshipQueue.push({
    pendingRelationship: getOrSet(pendingRelationships, modelName, new Map()),
    id
  });

  return null;
}

export default function hasMany(modelName: string): RelationshipHandler {
  const globalRelationships = relationships.get('global') as Map<string, unknown[][]>;
  const pendingRelationships = relationships.get('pending') as Map<string, Map<unknown, unknown[][]>>;

  const fn = (sourceRecord: SourceRecord, rawData: unknown, options: HasManyOptions): unknown[] => {
    const { __name: sourceModelName } = sourceRecord.__model;
    const relationshipId = sourceRecord.id;
    const relationship = getRelationships('hasMany', sourceModelName, modelName, relationshipId as string) as Map<unknown, unknown[]>;
    const modelStore = store.get(modelName) as Map<unknown, unknown> | undefined;
    const pendingRelationshipQueue: PendingItem[] = [];

    const output: unknown[] = !rawData ? [] : (makeArray(rawData) as unknown[]).map((elementData: unknown) => {
      let record: unknown;

      if (typeof elementData !== 'object') {
        if (!modelStore) {
          return queuePendingRelationship(pendingRelationshipQueue, pendingRelationships, modelName, elementData);
        }

        record = modelStore.get(elementData);

        if (!record) {
          return queuePendingRelationship(pendingRelationshipQueue, pendingRelationships, modelName, elementData);
        }
      } else {
        if (elementData !== Object(elementData)) {
          return queuePendingRelationship(pendingRelationshipQueue, pendingRelationships, modelName, elementData);
        }

        record = createRecord(modelName, elementData as Record<string, unknown>, options);
      }

      // Populate belongTo side if the relationship is defined
      const otherSide = (relationships.get('belongsTo') as Map<string, Map<string, Map<unknown, unknown>>>)
        .get(modelName)?.get(sourceModelName)?.get((record as SourceRecord).id);

      if (otherSide) Object.assign(otherSide, sourceRecord);

      return record;
    }).filter((value: unknown) => value);

    relationship.set(relationshipId, output);

    // Assign global relationship
    if (options.global || sourceModelName === dbKey) getOrSet(globalRelationships, modelName, []).push(output);

    // Assign pending relationships
    for (const { pendingRelationship, id } of pendingRelationshipQueue) getOrSet(pendingRelationship, id, []).push(output);

    return output;
  };

  Object.defineProperty(fn, '__relatedModelName', { value: modelName });
  return fn as RelationshipHandler;
}
