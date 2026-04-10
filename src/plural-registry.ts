import { pluralize } from './utils.js';

const registry: Map<string, string> = new Map();

export function registerPluralName(modelName: string, modelClass: { pluralName?: string }): void {
  const plural = modelClass.pluralName || pluralize(modelName);
  registry.set(modelName, plural);
}

export function getPluralName(modelName: string): string {
  return registry.get(modelName) || pluralize(modelName);
}
