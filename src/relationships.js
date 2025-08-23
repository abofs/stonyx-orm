import { relationships } from "@stonyx/orm";

export default class Relationships {
  constructor() {
    if (Relationships.instance) return Relationships.instance;
    Relationships.instance = this;

    this.data = new Map();
  }

  get(key) {
    return this.data.get(key);
  }

  set(key, value) {
    this.data.set(key, value);
  }
}

export function getRelationshipInfo(type, sourceModel, targetModel, relationshipId) {
  const allRelationships = relationships.get(type);
  
  // create relationship map for this type of it doesn't already exist
  if (!allRelationships.has(sourceModel)) allRelationships.set(sourceModel, new Map());
  
  const modelRelationship = allRelationships.get(sourceModel);

  if (!modelRelationship.has(targetModel)) modelRelationship.set(targetModel, new Map());

  const relationship = modelRelationship.get(targetModel);

  if (relationship.has(relationshipId)) throw new Error(`record to model relationships cannot be registered more than once`);

  return relationship;
}
