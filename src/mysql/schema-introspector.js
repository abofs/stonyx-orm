import Orm from '@stonyx/orm';
import { getMysqlType } from './type-map.js';
import { camelCaseToKebabCase } from '@stonyx/utils/string';
import { getPluralName } from '../plural-registry.js';
import { dbKey } from '../db.js';
import { AggregateProperty } from '../aggregates.js';

function getRelationshipInfo(property) {
  if (typeof property !== 'function') return null;
  const fnStr = property.toString();

  if (fnStr.includes(`getRelationships('belongsTo',`)) return 'belongsTo';
  if (fnStr.includes(`getRelationships('hasMany',`)) return 'hasMany';

  return null;
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

      const relType = getRelationshipInfo(property);

      if (relType === 'belongsTo') {
        relationships.belongsTo[key] = true;
      } else if (relType === 'hasMany') {
        relationships.hasMany[key] = true;
      } else if (property?.constructor?.name === 'ModelProperty') {
        if (key === 'id') {
          idType = property.type;
        } else {
          columns[key] = getMysqlType(property.type, transforms[property.type]);
        }
      }
    }

    // Build foreign keys from belongsTo relationships
    for (const relName of Object.keys(relationships.belongsTo)) {
      const modelName = camelCaseToKebabCase(relName);
      const fkColumn = `${relName}_id`;
      foreignKeys[fkColumn] = {
        references: getPluralName(modelName),
        column: 'id',
      };
    }

    schemas[name] = {
      table: getPluralName(name),
      idType,
      columns,
      foreignKeys,
      relationships,
      memory: modelClass.memory !== false, // default true for backward compat
    };
  }

  return schemas;
}

export function buildTableDDL(name, schema, allSchemas = {}) {
  const { table, idType, columns, foreignKeys } = schema;
  const lines = [];

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
    lines.push(`  FOREIGN KEY (\`${fkCol}\`) REFERENCES \`${fkDef.references}\`(\`${fkDef.column}\`) ON DELETE SET NULL`);
  }

  return `CREATE TABLE IF NOT EXISTS \`${table}\` (\n${lines.join(',\n')}\n)`;
}

function getReferencedIdType(tableName, allSchemas) {
  // Look up the referenced table's PK type from schemas
  for (const schema of Object.values(allSchemas)) {
    if (schema.table === tableName) {
      return schema.idType === 'string' ? 'VARCHAR(255)' : 'INT';
    }
  }

  // Default to INT if referenced table not found in schemas
  return 'INT';
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
    for (const relName of Object.keys(schema.relationships.belongsTo)) {
      visit(camelCaseToKebabCase(relName));
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

      const relType = getRelationshipInfo(property);

      if (relType === 'belongsTo') {
        relationships.belongsTo[key] = true;
        const modelName = camelCaseToKebabCase(key);
        const fkColumn = `${key}_id`;
        foreignKeys[fkColumn] = {
          references: getPluralName(modelName),
          column: 'id',
        };
      } else if (relType === 'hasMany') {
        relationships.hasMany[key] = true;
      } else if (property?.constructor?.name === 'ModelProperty') {
        const transforms = Orm.instance.transforms;
        columns[key] = getMysqlType(property.type, transforms[property.type]);
      }
    }

    schemas[name] = {
      viewName: getPluralName(name),
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

export function buildViewDDL(name, viewSchema, modelSchemas = {}) {
  if (!viewSchema.source) {
    throw new Error(`View '${name}' must define a source model`);
  }

  const sourceModelName = viewSchema.source;
  const sourceSchema = modelSchemas[sourceModelName];
  const sourceTable = sourceSchema
    ? sourceSchema.table
    : getPluralName(sourceModelName);

  const selectColumns = [];
  const joins = [];
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
      const relModelName = camelCaseToKebabCase(relName);
      const relTable = getPluralName(relModelName);

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
  for (const [key, mysqlType] of Object.entries(viewSchema.columns || {})) {
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

  const viewName = viewSchema.viewName;
  const sql = `CREATE OR REPLACE VIEW \`${viewName}\` AS\nSELECT\n  ${selectColumns.join(',\n  ')}\nFROM \`${sourceTable}\`${joinClauses ? '\n  ' + joinClauses : ''}${groupBy}`;

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
