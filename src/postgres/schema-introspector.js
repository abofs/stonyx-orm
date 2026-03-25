import Orm from '@stonyx/orm';
import { getPostgresType } from './type-map.js';
import { camelCaseToKebabCase } from '@stonyx/utils/string';
import { getPluralName } from '../plural-registry.js';
import { dbKey } from '../db.js';
import { AggregateProperty } from '../aggregates.js';

function getRelationshipInfo(property) {
  if (typeof property !== 'function') return null;
  const fnStr = property.toString();
  const modelName = property.__relatedModelName || null;

  if (fnStr.includes(`getRelationships('belongsTo',`)) return { type: 'belongsTo', modelName };
  if (fnStr.includes(`getRelationships('hasMany',`)) return { type: 'hasMany', modelName };

  return null;
}

function sanitizeTableName(name) {
  return name.replace(/[-/]/g, '_');
}

function parseInterval(shorthand) {
  const match = shorthand.match(/^(\d+)\s*([a-zA-Z]+)$/);
  if (!match) return shorthand;

  const value = match[1];
  const unit = match[2].toLowerCase();

  const unitMap = {
    d: 'days',
    day: 'days',
    days: 'days',
    h: 'hours',
    hour: 'hours',
    hours: 'hours',
    m: 'minutes',
    min: 'minutes',
    mins: 'minutes',
    minute: 'minutes',
    minutes: 'minutes',
    w: 'weeks',
    week: 'weeks',
    weeks: 'weeks',
  };

  const fullUnit = unitMap[unit] || unit;
  return `${value} ${fullUnit}`;
}

export function introspectModels() {
  const { models } = Orm.instance;
  const schemas = {};

  for (const [modelKey, modelClass] of Object.entries(models)) {
    const name = camelCaseToKebabCase(modelKey.slice(0, -5));

    if (name === dbKey) continue;

    const model = new modelClass(modelKey);
    const columns = {};
    const foreignKeys = {};
    const relationships = { belongsTo: {}, hasMany: {} };
    let idType = 'number';

    const transforms = Orm.instance.transforms;

    for (const [key, property] of Object.entries(model)) {
      if (key.startsWith('__')) continue;

      const relInfo = getRelationshipInfo(property);

      if (relInfo?.type === 'belongsTo') {
        relationships.belongsTo[key] = relInfo.modelName;
      } else if (relInfo?.type === 'hasMany') {
        relationships.hasMany[key] = relInfo.modelName;
      } else if (property?.constructor?.name === 'ModelProperty') {
        if (key === 'id') {
          idType = property.type;
        } else {
          columns[key] = getPostgresType(property.type, transforms[property.type]);
        }
      }
    }

    // Build foreign keys from belongsTo relationships
    for (const [relName, targetModelName] of Object.entries(relationships.belongsTo)) {
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
      memory: modelClass.memory === true,
      timeSeries: modelClass.timeSeries || null,
      compression: modelClass.compression || null,
    };
  }

  return schemas;
}

export function buildTableDDL(name, schema, allSchemas = {}) {
  const { idType, columns, foreignKeys } = schema;
  const table = sanitizeTableName(schema.table);
  const isHypertable = !!schema.timeSeries;
  const lines = [];

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
  lines.push('  "created_at" TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP');
  lines.push('  "updated_at" TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP');

  // Foreign key constraints (omit for hypertables — TimescaleDB limitation)
  if (!isHypertable) {
    for (const [fkCol, fkDef] of Object.entries(foreignKeys)) {
      const refTable = sanitizeTableName(fkDef.references);
      lines.push(`  FOREIGN KEY ("${fkCol}") REFERENCES "${refTable}"("${fkDef.column}") ON DELETE SET NULL`);
    }
  }

  let ddl = `CREATE TABLE IF NOT EXISTS "${table}" (\n${lines.join(',\n')}\n)`;

  // Hypertable DDL
  if (isHypertable) {
    ddl += `;\nSELECT create_hypertable('${table}', '${schema.timeSeries}')`;
  }

  // Compression DDL
  if (isHypertable && schema.compression) {
    const fkColumns = Object.keys(foreignKeys);
    ddl += `;\nALTER TABLE "${table}" SET (\n  timescaledb.compress,\n  timescaledb.compress_segmentby = '${fkColumns.join(', ')}'\n);\nSELECT add_compression_policy('${table}', INTERVAL '${parseInterval(schema.compression.after)}')`;
  }

  return ddl;
}

function getReferencedIdType(tableName, allSchemas) {
  // Look up the referenced table's PK type from schemas
  for (const schema of Object.values(allSchemas)) {
    if (schema.table === tableName) {
      return schema.idType === 'string' ? 'VARCHAR(255)' : 'INTEGER';
    }
  }

  // Default to INTEGER if referenced table not found in schemas
  return 'INTEGER';
}

export function getTopologicalOrder(schemas) {
  const visited = new Set();
  const order = [];

  function visit(name) {
    if (visited.has(name)) return;
    visited.add(name);

    const schema = schemas[name];
    if (!schema) return;

    // Visit dependencies (belongsTo targets) first
    for (const targetModelName of Object.values(schema.relationships.belongsTo)) {
      visit(targetModelName);
    }

    order.push(name);
  }

  for (const name of Object.keys(schemas)) {
    visit(name);
  }

  return order;
}

export function introspectViews() {
  const orm = Orm.instance;
  if (!orm.views) return {};

  const schemas = {};

  for (const [viewKey, viewClass] of Object.entries(orm.views)) {
    const name = camelCaseToKebabCase(viewKey.slice(0, -4)); // Remove 'View' suffix

    const source = viewClass.source;
    if (!source) continue;

    const model = new viewClass(name);
    const columns = {};
    const foreignKeys = {};
    const aggregates = {};
    const relationships = { belongsTo: {}, hasMany: {} };

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
        const fkColumn = `${key}_id`;
        foreignKeys[fkColumn] = {
          references: sanitizeTableName(getPluralName(relInfo.modelName)),
          column: 'id',
        };
      } else if (relInfo?.type === 'hasMany') {
        relationships.hasMany[key] = relInfo.modelName;
      } else if (property?.constructor?.name === 'ModelProperty') {
        const transforms = Orm.instance.transforms;
        columns[key] = getPostgresType(property.type, transforms[property.type]);
      }
    }

    schemas[name] = {
      viewName: sanitizeTableName(getPluralName(name)),
      source,
      groupBy: viewClass.groupBy || undefined,
      columns,
      foreignKeys,
      aggregates,
      relationships,
      isView: true,
      memory: viewClass.memory !== false ? false : false, // Views default to memory:false
    };
  }

  return schemas;
}

// Uses mysqlFunction property — values are standard SQL (COUNT, SUM, etc.), named in aggregates.js
export function buildViewDDL(name, viewSchema, modelSchemas = {}) {
  if (!viewSchema.source) {
    throw new Error(`View '${name}' must define a source model`);
  }

  const sourceModelName = viewSchema.source;
  const sourceSchema = modelSchemas[sourceModelName];
  const sourceTable = sanitizeTableName(sourceSchema
    ? sourceSchema.table
    : getPluralName(sourceModelName));

  const selectColumns = [];
  const joins = [];
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
    if (aggProp.relationship === undefined) {
      // Field-level aggregate (groupBy views)
      if (aggProp.aggregateType === 'count') {
        selectColumns.push(`COUNT(*) AS "${key}"`);
      } else {
        selectColumns.push(`${aggProp.mysqlFunction}("${sourceTable}"."${aggProp.field}") AS "${key}"`);
      }
    } else {
      // Relationship aggregate
      const relName = aggProp.relationship;
      const relTable = sanitizeTableName(getPluralName(relName));

      if (aggProp.aggregateType === 'count') {
        selectColumns.push(`${aggProp.mysqlFunction}("${relTable}"."id") AS "${key}"`);
      } else {
        const field = aggProp.field;
        selectColumns.push(`${aggProp.mysqlFunction}("${relTable}"."${field}") AS "${key}"`);
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

  // Regular columns (from resolve map string paths or direct attr fields)
  for (const [key, pgType] of Object.entries(viewSchema.columns || {})) {
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

export function viewSchemasToSnapshot(viewSchemas) {
  const snapshot = {};

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

export function schemasToSnapshot(schemas) {
  const snapshot = {};

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
