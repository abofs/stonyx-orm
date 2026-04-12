import Orm from '@stonyx/orm';
import { getMysqlType } from './type-map.js';
import { camelCaseToKebabCase } from '@stonyx/utils/string';
import { getPluralName } from '../plural-registry.js';
import { dbKey } from '../db.js';
import { AggregateProperty } from '../aggregates.js';
import type { ForeignKeyDef, ModelSchema, ViewSchema, SnapshotEntry } from '../types/orm-types.js';
import ModelProperty from '../model-property.js';

interface RelationshipInfo {
  type: 'belongsTo' | 'hasMany';
  modelName: string | null;
}

interface JoinClause {
  table: string;
  condition: string;
}

interface RelationshipProperty {
  __relatedModelName?: string | null;
  __relationshipType?: string;
}

function getRelationshipInfo(property: unknown): RelationshipInfo | null {
  if (typeof property !== 'function') return null;
  const relType = (property as RelationshipProperty).__relationshipType;
  const modelName = (property as RelationshipProperty).__relatedModelName || null;

  if (relType === 'belongsTo') return { type: 'belongsTo', modelName };
  if (relType === 'hasMany') return { type: 'hasMany', modelName };

  return null;
}

function sanitizeTableName(name: string): string {
  return name.replace(/[-/]/g, '_');
}

export function introspectModels(): Record<string, ModelSchema> {
  const { models } = (Orm as unknown as { instance: { models: Record<string, unknown>; transforms: Record<string, unknown> } }).instance;
  const schemas: Record<string, ModelSchema> = {};

  for (const [modelKey, modelClass] of Object.entries(models)) {
    const name = camelCaseToKebabCase(modelKey.slice(0, -5));

    if (name === dbKey) continue;

    const model = new (modelClass as new (key: string) => Record<string, unknown>)(modelKey);
    const columns: Record<string, string> = {};
    const foreignKeys: Record<string, ForeignKeyDef> = {};
    const relationships: { belongsTo: Record<string, string | null>; hasMany: Record<string, string | null> } = { belongsTo: {}, hasMany: {} };
    let idType = 'number';

    const transforms = (Orm as unknown as { instance: { transforms: Record<string, unknown> } }).instance.transforms;

    for (const [key, property] of Object.entries(model)) {
      if (key.startsWith('__')) continue;

      const relInfo = getRelationshipInfo(property);

      if (relInfo?.type === 'belongsTo') {
        relationships.belongsTo[key] = relInfo.modelName;
      } else if (relInfo?.type === 'hasMany') {
        relationships.hasMany[key] = relInfo.modelName;
      } else if (property instanceof ModelProperty) {
        if (key === 'id') {
          idType = (property as ModelProperty).type;
        } else {
          columns[key] = getMysqlType((property as ModelProperty).type, transforms[(property as ModelProperty).type] as ((...args: unknown[]) => unknown) & { mysqlType?: string });
        }
      }
    }

    // Build foreign keys from belongsTo relationships
    for (const [relName, targetModelName] of Object.entries(relationships.belongsTo)) {
      if (!targetModelName) continue;
      const fkColumn = `${relName}_id`;
      foreignKeys[fkColumn] = {
        references: sanitizeTableName(getPluralName(targetModelName)),
        column: 'id',
      };
    }

    schemas[name] = {
      table: sanitizeTableName(getPluralName(name)),
      idType,
      columns,
      foreignKeys,
      relationships,
      memory: (modelClass as { memory?: boolean }).memory === true,
    };
  }

  return schemas;
}

export function buildTableDDL(name: string, schema: ModelSchema, allSchemas: Record<string, ModelSchema> = {}): string {
  const { idType, columns, foreignKeys } = schema;
  const table = sanitizeTableName(schema.table);
  const lines: string[] = [];

  // Primary key
  if (idType === 'string') {
    lines.push('  `id` VARCHAR(255) PRIMARY KEY');
  } else {
    lines.push('  `id` INT AUTO_INCREMENT PRIMARY KEY');
  }

  // Attribute columns
  for (const [col, mysqlType] of Object.entries(columns)) {
    lines.push(`  \`${col}\` ${mysqlType}`);
  }

  // Foreign key columns
  for (const [fkCol, fkDef] of Object.entries(foreignKeys)) {
    const refIdType = getReferencedIdType(fkDef.references, allSchemas);
    lines.push(`  \`${fkCol}\` ${refIdType}`);
  }

  // Timestamps
  lines.push('  `created_at` DATETIME DEFAULT CURRENT_TIMESTAMP');
  lines.push('  `updated_at` DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP');

  // Foreign key constraints
  for (const [fkCol, fkDef] of Object.entries(foreignKeys)) {
    const refTable = sanitizeTableName(fkDef.references);
    lines.push(`  FOREIGN KEY (\`${fkCol}\`) REFERENCES \`${refTable}\`(\`${fkDef.column}\`) ON DELETE SET NULL`);
  }

  return `CREATE TABLE IF NOT EXISTS \`${table}\` (\n${lines.join(',\n')}\n)`;
}

function getReferencedIdType(tableName: string, allSchemas: Record<string, ModelSchema>): string {
  // Look up the referenced table's PK type from schemas
  for (const schema of Object.values(allSchemas)) {
    if (schema.table === tableName) {
      return schema.idType === 'string' ? 'VARCHAR(255)' : 'INT';
    }
  }

  // Default to INT if referenced table not found in schemas
  return 'INT';
}

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

export function introspectViews(): Record<string, ViewSchema> {
  const orm = (Orm as unknown as { instance: { views?: Record<string, unknown>; transforms: Record<string, unknown> } }).instance;
  if (!orm.views) return {};

  const schemas: Record<string, ViewSchema> = {};

  for (const [viewKey, viewClass] of Object.entries(orm.views)) {
    const name = camelCaseToKebabCase(viewKey.slice(0, -4)); // Remove 'View' suffix

    const source = (viewClass as { source?: string }).source;
    if (!source) continue;

    const model = new (viewClass as new (name: string) => Record<string, unknown>)(name);
    const columns: Record<string, string> = {};
    const foreignKeys: Record<string, ForeignKeyDef> = {};
    const aggregates: Record<string, AggregateProperty> = {};
    const relationships: { belongsTo: Record<string, string | null>; hasMany: Record<string, string | null> } = { belongsTo: {}, hasMany: {} };

    for (const [key, property] of Object.entries(model)) {
      if (key.startsWith('__')) continue;
      if (key === 'id') continue;

      if (property instanceof AggregateProperty) {
        aggregates[key] = property;
        continue;
      }

      const relInfo = getRelationshipInfo(property);

      if (relInfo?.type === 'belongsTo') {
        relationships.belongsTo[key] = relInfo.modelName;
        if (relInfo.modelName) {
          const fkColumn = `${key}_id`;
          foreignKeys[fkColumn] = {
            references: sanitizeTableName(getPluralName(relInfo.modelName)),
            column: 'id',
          };
        }
      } else if (relInfo?.type === 'hasMany') {
        relationships.hasMany[key] = relInfo.modelName;
      } else if (property instanceof ModelProperty) {
        const transforms = orm.transforms;
        columns[key] = getMysqlType((property as ModelProperty).type, transforms[(property as ModelProperty).type] as ((...args: unknown[]) => unknown) & { mysqlType?: string });
      }
    }

    schemas[name] = {
      viewName: sanitizeTableName(getPluralName(name)),
      source,
      groupBy: (viewClass as { groupBy?: string }).groupBy || undefined,
      columns,
      foreignKeys,
      aggregates,
      relationships,
      isView: true,
      memory: false,
    };
  }

  return schemas;
}

export function buildViewDDL(name: string, viewSchema: ViewSchema, modelSchemas: Record<string, ModelSchema> = {}): string {
  if (!viewSchema.source) {
    throw new Error(`View '${name}' must define a source model`);
  }

  const sourceModelName = viewSchema.source;
  const sourceSchema = modelSchemas[sourceModelName];
  const sourceTable = sanitizeTableName(sourceSchema
    ? sourceSchema.table
    : getPluralName(sourceModelName));

  const selectColumns: string[] = [];
  const joins: JoinClause[] = [];
  const hasAggregates = Object.keys(viewSchema.aggregates || {}).length > 0;
  const groupByField = viewSchema.groupBy;

  // ID column: groupBy field or source table PK
  if (groupByField) {
    selectColumns.push(`\`${sourceTable}\`.\`${groupByField}\` AS \`id\``);
  } else {
    selectColumns.push(`\`${sourceTable}\`.\`id\` AS \`id\``);
  }

  // Aggregate columns
  for (const [key, aggProp] of Object.entries(viewSchema.aggregates || {})) {
    if (aggProp.relationship === undefined) {
      // Field-level aggregate (groupBy views)
      if (aggProp.aggregateType === 'count') {
        selectColumns.push(`COUNT(*) AS \`${key}\``);
      } else {
        selectColumns.push(`${aggProp.mysqlFunction}(\`${sourceTable}\`.\`${aggProp.field}\`) AS \`${key}\``);
      }
    } else {
      // Relationship aggregate
      const relName = aggProp.relationship;
      const relTable = sanitizeTableName(getPluralName(relName));

      if (aggProp.aggregateType === 'count') {
        selectColumns.push(`${aggProp.mysqlFunction}(\`${relTable}\`.\`id\`) AS \`${key}\``);
      } else {
        const field = aggProp.field;
        selectColumns.push(`${aggProp.mysqlFunction}(\`${relTable}\`.\`${field}\`) AS \`${key}\``);
      }

      // Add LEFT JOIN for the relationship if not already added
      const joinKey = `${relTable}`;
      if (!joins.find(j => j.table === joinKey)) {
        const fkColumn = `${sourceModelName}_id`;
        joins.push({
          table: relTable,
          condition: `\`${relTable}\`.\`${fkColumn}\` = \`${sourceTable}\`.\`id\``
        });
      }
    }
  }

  // Regular columns (from resolve map string paths or direct attr fields)
  for (const [key] of Object.entries(viewSchema.columns || {})) {
    selectColumns.push(`\`${sourceTable}\`.\`${key}\` AS \`${key}\``);
  }

  // Build JOIN clauses
  const joinClauses = joins.map(j =>
    `LEFT JOIN \`${j.table}\` ON ${j.condition}`
  ).join('\n  ');

  // Build GROUP BY
  let groupBy = '';
  if (groupByField) {
    groupBy = `\nGROUP BY \`${sourceTable}\`.\`${groupByField}\``;
  } else if (hasAggregates) {
    groupBy = `\nGROUP BY \`${sourceTable}\`.\`id\``;
  }

  const viewName = sanitizeTableName(viewSchema.viewName);
  const sql = `CREATE OR REPLACE VIEW \`${viewName}\` AS\nSELECT\n  ${selectColumns.join(',\n  ')}\nFROM \`${sourceTable}\`${joinClauses ? '\n  ' + joinClauses : ''}${groupBy}`;

  return sql;
}

export function viewSchemasToSnapshot(viewSchemas: Record<string, ViewSchema>): Record<string, ViewSnapshotEntry> {
  const snapshot: Record<string, ViewSnapshotEntry> = {};

  for (const [name, schema] of Object.entries(viewSchemas)) {
    snapshot[name] = {
      viewName: schema.viewName,
      source: schema.source,
      ...(schema.groupBy ? { groupBy: schema.groupBy } : {}),
      columns: { ...schema.columns },
      foreignKeys: { ...schema.foreignKeys },
      isView: true,
      viewQuery: buildViewDDL(name, schema),
    };
  }

  return snapshot;
}

interface ViewSnapshotEntry {
  viewName: string;
  source: string;
  groupBy?: string;
  columns: Record<string, string>;
  foreignKeys: Record<string, ForeignKeyDef>;
  isView: true;
  viewQuery: string;
}

export function schemasToSnapshot(schemas: Record<string, ModelSchema>): Record<string, SnapshotEntry> {
  const snapshot: Record<string, SnapshotEntry> = {};

  for (const [name, schema] of Object.entries(schemas)) {
    snapshot[name] = {
      table: schema.table,
      idType: schema.idType,
      columns: { ...schema.columns },
      foreignKeys: { ...schema.foreignKeys },
    };
  }

  return snapshot;
}

export type { ModelSchema, ViewSchema, ForeignKeyDef, SnapshotEntry } from '../types/orm-types.js';
export type { ViewSnapshotEntry };
