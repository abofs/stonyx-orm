import { pluralize } from './utils.js';

const registry = new Map();

export function registerPluralName(modelName, modelClass) {
  const plural = modelClass.pluralName || pluralize(modelName);
  registry.set(modelName, plural);
}

export function getPluralName(modelName) {
  return registry.get(modelName) || pluralize(modelName);
}
