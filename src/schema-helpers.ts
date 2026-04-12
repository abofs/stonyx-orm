import type { ModelSchema } from './types/orm-types.js';

export interface SchemaRelationshipInfo {
  type: 'belongsTo' | 'hasMany';
  modelName: string | null;
}

/**
 * Detect relationship type and target model from a model property function.
 * Returns null if the property is not a relationship.
 */
export function getRelationshipInfo(property: unknown): SchemaRelationshipInfo | null {
  if (typeof property !== 'function') return null;
  const relType = (property as { __relationshipType?: string }).__relationshipType;
  const modelName = (property as { __relatedModelName?: string }).__relatedModelName || null;

  if (relType === 'belongsTo') return { type: 'belongsTo', modelName };
  if (relType === 'hasMany') return { type: 'hasMany', modelName };

  return null;
}

/**
 * Sanitize a model/table name for use in SQL identifiers.
 * Replaces hyphens and slashes with underscores.
 */
export function sanitizeTableName(name: string): string {
  return name.replace(/[-/]/g, '_');
}

/**
 * Sort model schemas in dependency order (belongsTo targets before dependents).
 * Uses depth-first traversal to ensure referenced tables are created first.
 */
export function getTopologicalOrder(schemas: Record<string, ModelSchema>): string[] {
  const visited = new Set<string>();
  const order: string[] = [];

  function visit(name: string): void {
    if (visited.has(name)) return;
    visited.add(name);

    const schema = schemas[name];
    if (!schema) return;

    // Visit dependencies (belongsTo targets) first
    for (const targetModelName of Object.values(schema.relationships.belongsTo)) {
      if (targetModelName) visit(targetModelName);
    }

    order.push(name);
  }

  for (const name of Object.keys(schemas)) {
    visit(name);
  }

  return order;
}
