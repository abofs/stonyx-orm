import Orm from '@stonyx/orm';
import { getMysqlType } from './type-map.js';
import { camelCaseToKebabCase } from '@stonyx/utils/string';
import { getPluralName } from '../plural-registry.js';
import { dbKey } from '../db.js';

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
      const fkColumn = `${relName}_id`;
      foreignKeys[fkColumn] = {
        references: getPluralName(relName),
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
      visit(relName);
    }

    order.push(name);
  }

  for (const name of Object.keys(schemas)) {
    visit(name);
  }

  return order;
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
