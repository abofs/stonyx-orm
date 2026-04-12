import Orm from '@stonyx/orm';
import { getPgType, getVectorType } from './type-map.js';
import { camelCaseToKebabCase } from '@stonyx/utils/string';
import { getPluralName } from '../plural-registry.js';
import { dbKey } from '../db.js';
import { AggregateProperty } from '../aggregates.js';
import { getRelationshipInfo, sanitizeTableName } from '../schema-helpers.js';
import type { ForeignKeyDef, ModelSchema, ViewSchema } from '../types/orm-types.js';
import ModelProperty from '../model-property.js';

interface ViewSnapshotEntry {
  viewName: string;
  source: string;
  groupBy?: string;
  columns: Record<string, string>;
  foreignKeys: Record<string, ForeignKeyDef>;
  isView: boolean;
  viewQuery: string;
}

interface ModelSnapshotEntry {
  table: string;
  idType: string;
  columns: Record<string, string>;
  foreignKeys: Record<string, ForeignKeyDef>;
  vectorColumns?: Record<string, number>;
}

interface JoinDef {
  table: string;
  condition: string;
}

export function introspectModels(): Record<string, ModelSchema> {
  const { models } = Orm.instance as { models: Record<string, unknown> };
  const schemas: Record<string, ModelSchema> = {};

  for (const [modelKey, modelClass] of Object.entries(models)) {
    const name = camelCaseToKebabCase(modelKey.slice(0, -5));

    if (name === dbKey) continue;

    const model = new (modelClass as new (key: string) => Record<string, unknown>)(modelKey);
    const columns: Record<string, string> = {};
    const foreignKeys: Record<string, ForeignKeyDef> = {};
    const relationships: { belongsTo: Record<string, string | null>; hasMany: Record<string, string | null> } = { belongsTo: {}, hasMany: {} };
    const vectorColumns: Record<string, number> = {};
    let idType = 'number';

    const transforms = (Orm.instance as { transforms: Record<string, unknown> }).transforms;

    for (const [key, property] of Object.entries(model)) {
      if (key.startsWith('__')) continue;

      const relInfo = getRelationshipInfo(property);

      if (relInfo?.type === 'belongsTo') {
        relationships.belongsTo[key] = relInfo.modelName;
      } else if (relInfo?.type === 'hasMany') {
        relationships.hasMany[key] = relInfo.modelName;
      } else if (property instanceof ModelProperty) {
        const prop = property as { type: string; dimensions?: number };
        if (key === 'id') {
          idType = prop.type;
        } else if (prop.type === 'vector') {
          const dimensions = prop.dimensions || 1536;
          columns[key] = getVectorType(dimensions);
          vectorColumns[key] = dimensions;
        } else {
          columns[key] = getPgType(prop.type, transforms[prop.type] as undefined);
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
      vectorColumns,
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
    lines.push('  "id" VARCHAR(255) PRIMARY KEY');
  } else {
    lines.push('  "id" INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY');
  }

  // Attribute columns
  for (const [col, pgType] of Object.entries(columns)) {
    lines.push(`  "${col}" ${pgType}`);
  }

  // Foreign key columns
  for (const [fkCol, fkDef] of Object.entries(foreignKeys)) {
    const refIdType = getReferencedIdType(fkDef.references, allSchemas);
    lines.push(`  "${fkCol}" ${refIdType}`);
  }

  // Timestamps
  lines.push('  "created_at" TIMESTAMPTZ DEFAULT NOW()');
  lines.push('  "updated_at" TIMESTAMPTZ DEFAULT NOW()');

  // Foreign key constraints
  for (const [fkCol, fkDef] of Object.entries(foreignKeys)) {
    const refTable = sanitizeTableName(fkDef.references);
    lines.push(`  FOREIGN KEY ("${fkCol}") REFERENCES "${refTable}"("${fkDef.column}") ON DELETE SET NULL`);
  }

  return `CREATE TABLE IF NOT EXISTS "${table}" (\n${lines.join(',\n')}\n)`;
}

/**
 * Build HNSW index DDL for vector columns on a model.
 */
export function buildVectorIndexDDL(name: string, schema: ModelSchema): string[] {
  const table = sanitizeTableName(schema.table);
  const statements: string[] = [];

  for (const [col] of Object.entries(schema.vectorColumns || {})) {
    statements.push(
      `CREATE INDEX IF NOT EXISTS "idx_${table}_${col}_hnsw" ON "${table}" USING hnsw ("${col}" vector_cosine_ops) WITH (m = 16, ef_construction = 200)`
    );
  }

  return statements;
}

function getReferencedIdType(tableName: string, allSchemas: Record<string, ModelSchema>): string {
  for (const schema of Object.values(allSchemas)) {
    if (schema.table === tableName) {
      return schema.idType === 'string' ? 'VARCHAR(255)' : 'INTEGER';
    }
  }

  return 'INTEGER';
}

export { getTopologicalOrder } from '../schema-helpers.js';

export function introspectViews(): Record<string, ViewSchema> {
  const orm = Orm.instance as { views?: Record<string, unknown> };
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
        const transforms = (Orm.instance as { transforms: Record<string, unknown> }).transforms;
        const prop = property as { type: string };
        columns[key] = getPgType(prop.type, transforms[prop.type] as undefined);
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
      memory: false, // Views default to memory:false
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
  const joins: JoinDef[] = [];
  const hasAggregates = Object.keys(viewSchema.aggregates || {}).length > 0;
  const groupByField = viewSchema.groupBy;

  // ID column: groupBy field or source table PK
  if (groupByField) {
    selectColumns.push(`"${sourceTable}"."${groupByField}" AS "id"`);
  } else {
    selectColumns.push(`"${sourceTable}"."id" AS "id"`);
  }

  // Aggregate columns
  for (const [key, aggProp] of Object.entries(viewSchema.aggregates || {})) {
    // Use pgFunction if available, fall back to mysqlFunction
    const fn = (aggProp as AggregateProperty & { pgFunction?: string }).pgFunction || aggProp.mysqlFunction;

    if (aggProp.relationship === undefined) {
      // Field-level aggregate (groupBy views)
      if (aggProp.aggregateType === 'count') {
        selectColumns.push(`COUNT(*) AS "${key}"`);
      } else {
        selectColumns.push(`${fn}("${sourceTable}"."${aggProp.field}") AS "${key}"`);
      }
    } else {
      // Relationship aggregate
      const relName = aggProp.relationship;
      const relTable = sanitizeTableName(getPluralName(relName));

      if (aggProp.aggregateType === 'count') {
        selectColumns.push(`${fn}("${relTable}"."id") AS "${key}"`);
      } else {
        const field = aggProp.field;
        selectColumns.push(`${fn}("${relTable}"."${field}") AS "${key}"`);
      }

      // Add LEFT JOIN for the relationship if not already added
      const joinKey = `${relTable}`;
      if (!joins.find(j => j.table === joinKey)) {
        const fkColumn = `${sourceModelName}_id`;
        joins.push({
          table: relTable,
          condition: `"${relTable}"."${fkColumn}" = "${sourceTable}"."id"`
        });
      }
    }
  }

  // Regular columns
  for (const [key] of Object.entries(viewSchema.columns || {})) {
    selectColumns.push(`"${sourceTable}"."${key}" AS "${key}"`);
  }

  // Build JOIN clauses
  const joinClauses = joins.map(j =>
    `LEFT JOIN "${j.table}" ON ${j.condition}`
  ).join('\n  ');

  // Build GROUP BY
  let groupBy = '';
  if (groupByField) {
    groupBy = `\nGROUP BY "${sourceTable}"."${groupByField}"`;
  } else if (hasAggregates) {
    groupBy = `\nGROUP BY "${sourceTable}"."id"`;
  }

  const viewName = sanitizeTableName(viewSchema.viewName);
  const sql = `CREATE OR REPLACE VIEW "${viewName}" AS\nSELECT\n  ${selectColumns.join(',\n  ')}\nFROM "${sourceTable}"${joinClauses ? '\n  ' + joinClauses : ''}${groupBy}`;

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

export function schemasToSnapshot(schemas: Record<string, ModelSchema>): Record<string, ModelSnapshotEntry> {
  const snapshot: Record<string, ModelSnapshotEntry> = {};

  for (const [name, schema] of Object.entries(schemas)) {
    snapshot[name] = {
      table: schema.table,
      idType: schema.idType,
      columns: { ...schema.columns },
      foreignKeys: { ...schema.foreignKeys },
      ...(schema.vectorColumns && Object.keys(schema.vectorColumns).length > 0
        ? { vectorColumns: { ...schema.vectorColumns } }
        : {}),
    };
  }

  return snapshot;
}
