import { relationships } from '@stonyx/orm';
import type { HasManyMap, BelongsToMap, GlobalMap, PendingMap, PendingBelongsToMap } from './types/orm-types.js';

// TODO: Refactor mapping to remove a level of iteration
export function getRelationships(type: string, sourceModel: string, targetModel: string, relationshipId?: string): Map<unknown, unknown> | undefined {
  const allRelationships = relationships.get(type) as Map<string, Map<string, Map<unknown, unknown>>> | undefined;

  // create relationship map for this type of it doesn't already exist
  if (!allRelationships!.has(sourceModel)) allRelationships!.set(sourceModel, new Map());

  const modelRelationship = allRelationships!.get(sourceModel)!;

  if (!modelRelationship.has(targetModel)) modelRelationship.set(targetModel, new Map());

  const relationship = modelRelationship.get(targetModel)!;

  // TODO: Determine whether already having id should be handled differently
  //if (relationship.has(relationshipId)) return;

  return relationship;
}

export function getHasManyRelationships(sourceModel: string, targetModel: string): Map<unknown, unknown> | undefined {
  return (relationships.get('hasMany') as HasManyMap | undefined)?.get(sourceModel)?.get(targetModel);
}

/** Typed accessors for the relationship registry */
export function getHasManyRegistry(): HasManyMap {
  return relationships.get('hasMany') as HasManyMap;
}

export function getBelongsToRegistry(): BelongsToMap {
  return relationships.get('belongsTo') as BelongsToMap;
}

export function getGlobalRegistry(): GlobalMap {
  return relationships.get('global') as GlobalMap;
}

export function getPendingRegistry(): PendingMap {
  return relationships.get('pending') as PendingMap;
}

export function getPendingBelongsToRegistry(): PendingBelongsToMap {
  return relationships.get('pendingBelongsTo') as PendingBelongsToMap;
}

export const TYPES: string[] = ['global', 'hasMany', 'belongsTo', 'pending'];
