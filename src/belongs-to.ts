import { createRecord, store } from '@stonyx/orm';
import { getRelationships, getHasManyRegistry, getPendingRegistry, getPendingBelongsToRegistry } from './relationships.js';
import type { SourceRecord } from './types/orm-types.js';

function getOrSet<K, V>(map: Map<K, V>, key: K, defaultValue: V): V {
  if (!map.has(key)) map.set(key, defaultValue);
  return map.get(key)!;
}

interface BelongsToOptions {
  _relationshipKey?: string;
  [key: string]: unknown;
}

interface PendingBelongsToEntry {
  sourceRecord: SourceRecord;
  sourceModelName: string;
  relationshipKey: string | undefined;
  relationshipId: unknown;
}

type RelationshipHandler = ((sourceRecord: SourceRecord, rawData: unknown, options: BelongsToOptions) => unknown) & {
  __relatedModelName: string;
  __relationshipType: 'belongsTo';
};

export default function belongsTo(modelName: string): RelationshipHandler {
  const hasManyRelationships = getHasManyRegistry();
  const pendingHasManyQueue = getPendingRegistry();
  const pendingBelongsToQueue = getPendingBelongsToRegistry();

  const fn = (sourceRecord: SourceRecord, rawData: unknown, options: BelongsToOptions): unknown => {
    if (!rawData) return null;

    const { __name: sourceModelName } = sourceRecord.__model;
    const relationshipId = sourceRecord.id;
    const relationshipKey = options._relationshipKey;
    const relationship = getRelationships('belongsTo', sourceModelName, modelName, relationshipId as string) as Map<unknown, unknown>;
    const modelStore = store.get(modelName);

    // Try to get existing record
    let output: unknown;

    if (typeof rawData === 'object') {
      output = createRecord(modelName, rawData as Record<string, unknown>, options);
    } else if (modelStore) {
      output = modelStore.get(rawData as number | string);
    }

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
    const outputRecord = typeof output === 'object' && output !== null && 'id' in output ? output as SourceRecord : undefined;
    const otherSide = outputRecord ? hasManyRelationships.get(modelName)?.get(sourceModelName)?.get(outputRecord.id) as unknown[] | undefined : undefined;

    if (otherSide) {
      otherSide.push(sourceRecord);

      // Remove pending queue if it was just fulfilled
      const pendingModelRelationships = pendingHasManyQueue.get(sourceModelName);

      if (pendingModelRelationships) pendingModelRelationships.delete(relationshipId);
    }

    return output;
  };

  Object.defineProperty(fn, '__relatedModelName', { value: modelName });
  Object.defineProperty(fn, '__relationshipType', { value: 'belongsTo' as const });
  return fn as RelationshipHandler;
}
