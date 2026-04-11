import { relationships } from './main.js';

type RelationshipMap = Map<string, Map<string, Map<string, unknown>>>;

// TODO: Refactor mapping to remove a level of iteration
export function getRelationships(type: string, sourceModel: string, targetModel: string, relationshipId?: string): Map<string, unknown> | undefined {
  const allRelationships = relationships.get(type);

  // create relationship map for this type of it doesn't already exist
  if (!allRelationships!.has(sourceModel)) allRelationships!.set(sourceModel, new Map());

  const modelRelationship = allRelationships!.get(sourceModel) as Map<string, Map<string, unknown>>;

  if (!modelRelationship.has(targetModel)) modelRelationship.set(targetModel, new Map());

  const relationship = modelRelationship.get(targetModel)!;

  // TODO: Determine whether already having id should be handled differently
  //if (relationship.has(relationshipId)) return;

  return relationship;
}

export function getHasManyRelationships(sourceModel: string, targetModel: string): Map<string, unknown> | undefined {
  return (relationships.get('hasMany')?.get(sourceModel) as Map<string, unknown> | undefined)?.get(targetModel) as Map<string, unknown> | undefined;
}

export const TYPES: string[] = ['global', 'hasMany', 'belongsTo', 'pending'];
