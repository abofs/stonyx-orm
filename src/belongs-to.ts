import { store, relationships } from './main.js';
import { createRecord } from './manage-record.js';
import { getRelationships } from './relationships.js';

function getOrSet<K, V>(map: Map<K, V>, key: K, defaultValue: V): V {
  if (!map.has(key)) map.set(key, defaultValue);
  return map.get(key)!;
}

interface BelongsToOptions {
  _relationshipKey?: string;
  [key: string]: unknown;
}

interface SourceRecord {
  __model: { __name: string; [key: string]: unknown };
  __relationships: Record<string, unknown>;
  id: unknown;
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
};

export default function belongsTo(modelName: string): RelationshipHandler {
  const hasManyRelationships = relationships.get('hasMany') as Map<string, Map<string, Map<unknown, unknown[]>>>;
  const pendingHasManyQueue = relationships.get('pending') as Map<string, Map<unknown, unknown[]>>;
  const pendingBelongsToQueue = relationships.get('pendingBelongsTo') as Map<string, Map<unknown, PendingBelongsToEntry[]>>;

  const fn = (sourceRecord: SourceRecord, rawData: unknown, options: BelongsToOptions): unknown => {
    if (!rawData) return null;

    const { __name: sourceModelName } = sourceRecord.__model;
    const relationshipId = sourceRecord.id;
    const relationshipKey = options._relationshipKey;
    const relationship = getRelationships('belongsTo', sourceModelName, modelName, relationshipId as string) as Map<unknown, unknown>;
    const modelStore = store.get(modelName) as Map<unknown, unknown> | undefined;

    // Try to get existing record
    let output: unknown;

    if (typeof rawData === 'object') {
      output = createRecord(modelName, rawData as Record<string, unknown>, options);
    } else if (modelStore) {
      output = modelStore.get(rawData);
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
    const otherSide = hasManyRelationships.get(modelName)?.get(sourceModelName)?.get((output as SourceRecord)?.id) as unknown[] | undefined;

    if (otherSide) {
      otherSide.push(sourceRecord);

      // Remove pending queue if it was just fulfilled
      const pendingModelRelationships = pendingHasManyQueue.get(sourceModelName);

      if (pendingModelRelationships) pendingModelRelationships.delete(relationshipId);
    }

    return output;
  };

  Object.defineProperty(fn, '__relatedModelName', { value: modelName });
  return fn as RelationshipHandler;
}
