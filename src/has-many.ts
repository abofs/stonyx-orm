import { createRecord, store } from '@stonyx/orm';
import { getRelationships, getGlobalRegistry, getPendingRegistry, getBelongsToRegistry } from './relationships.js';
import { getOrSet, makeArray } from '@stonyx/utils/object';
import { dbKey } from './db.js';
import type { SourceRecord } from './types/orm-types.js';

interface HasManyOptions {
  global?: boolean;
  [key: string]: unknown;
}

interface PendingItem {
  pendingRelationship: Map<unknown, unknown[][]>;
  id: unknown;
}

type RelationshipHandler = ((sourceRecord: SourceRecord, rawData: unknown, options: HasManyOptions) => unknown[]) & {
  __relatedModelName: string;
  __relationshipType: 'hasMany';
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
  const globalRelationships = getGlobalRegistry();
  const pendingRelationships = getPendingRegistry();

  const fn = (sourceRecord: SourceRecord, rawData: unknown, options: HasManyOptions): unknown[] => {
    const { __name: sourceModelName } = sourceRecord.__model;
    const relationshipId = sourceRecord.id;
    const relationship = getRelationships('hasMany', sourceModelName, modelName, relationshipId as string) as Map<unknown, unknown[]>;
    const modelStore = store.get(modelName);
    const pendingRelationshipQueue: PendingItem[] = [];

    const output: unknown[] = !rawData ? [] : makeArray(rawData).map((elementData: unknown) => {
      let record: unknown;

      if (typeof elementData !== 'object') {
        if (!modelStore) {
          return queuePendingRelationship(pendingRelationshipQueue, pendingRelationships, modelName, elementData);
        }

        record = modelStore.get(elementData as number | string);

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
      const recordWithId = typeof record === 'object' && record !== null && 'id' in record ? record as SourceRecord : undefined;
      const otherSide = recordWithId ? getBelongsToRegistry()
        .get(modelName)?.get(sourceModelName)?.get(recordWithId.id) : undefined;

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
  Object.defineProperty(fn, '__relationshipType', { value: 'hasMany' as const });
  return fn as RelationshipHandler;
}
