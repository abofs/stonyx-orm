import { introspectModels, buildTableDDL, schemasToSnapshot, getTopologicalOrder } from './schema-introspector.js';
import { readFile, createFile, createDirectory, fileExists } from '@stonyx/utils/file';
import path from 'path';
import config from 'stonyx/config';
import log from 'stonyx/log';

export async function generateMigration(description = 'migration') {
  const { migrationsDir } = config.orm.mysql;
  const rootPath = config.rootPath;
  const migrationsPath = path.resolve(rootPath, migrationsDir);

  await createDirectory(migrationsPath);

  const schemas = introspectModels();
  const currentSnapshot = schemasToSnapshot(schemas);
  const previousSnapshot = await loadLatestSnapshot(migrationsPath);
  const diff = diffSnapshots(previousSnapshot, currentSnapshot);

  if (!diff.hasChanges) {
    log.db('No schema changes detected.');
    return null;
  }

  const upStatements = [];
  const downStatements = [];

  // New tables — in topological order (parents before children)
  const allOrder = getTopologicalOrder(schemas);
  const addedOrdered = allOrder.filter(name => diff.addedModels.includes(name));

  for (const name of addedOrdered) {
    upStatements.push(buildTableDDL(name, schemas[name], schemas) + ';');
    downStatements.unshift(`DROP TABLE IF EXISTS \`${schemas[name].table}\`;`);
  }

  // Removed tables (warn only, commented out)
  for (const name of diff.removedModels) {
    upStatements.push(`-- WARNING: Model '${name}' was removed. Uncomment to drop table:`);
    upStatements.push(`-- DROP TABLE IF EXISTS \`${previousSnapshot[name].table}\`;`);
    downStatements.push(`-- Recreate table for removed model '${name}' manually if needed`);
  }

  // Added columns
  for (const { model, column, type } of diff.addedColumns) {
    const table = currentSnapshot[model].table;
    upStatements.push(`ALTER TABLE \`${table}\` ADD COLUMN \`${column}\` ${type};`);
    downStatements.push(`ALTER TABLE \`${table}\` DROP COLUMN \`${column}\`;`);
  }

  // Removed columns
  for (const { model, column, type } of diff.removedColumns) {
    const table = previousSnapshot[model].table;
    upStatements.push(`ALTER TABLE \`${table}\` DROP COLUMN \`${column}\`;`);
    downStatements.push(`ALTER TABLE \`${table}\` ADD COLUMN \`${column}\` ${type};`);
  }

  // Changed column types
  for (const { model, column, from, to } of diff.changedColumns) {
    const table = currentSnapshot[model].table;
    upStatements.push(`ALTER TABLE \`${table}\` MODIFY COLUMN \`${column}\` ${to};`);
    downStatements.push(`ALTER TABLE \`${table}\` MODIFY COLUMN \`${column}\` ${from};`);
  }

  // Added foreign keys
  for (const { model, column, references } of diff.addedForeignKeys) {
    const table = currentSnapshot[model].table;
    // Resolve FK column type from the referenced table's PK type
    const refModel = Object.entries(currentSnapshot).find(([, s]) => s.table === references.references);
    const fkType = refModel && refModel[1].idType === 'string' ? 'VARCHAR(255)' : 'INT';
    upStatements.push(`ALTER TABLE \`${table}\` ADD COLUMN \`${column}\` ${fkType};`);
    upStatements.push(`ALTER TABLE \`${table}\` ADD FOREIGN KEY (\`${column}\`) REFERENCES \`${references.references}\`(\`${references.column}\`) ON DELETE SET NULL;`);
    downStatements.push(`ALTER TABLE \`${table}\` DROP FOREIGN KEY \`${column}\`;`);
    downStatements.push(`ALTER TABLE \`${table}\` DROP COLUMN \`${column}\`;`);
  }

  // Removed foreign keys
  for (const { model, column, references } of diff.removedForeignKeys) {
    const table = previousSnapshot[model].table;
    // Resolve FK column type from the referenced table's PK type in previous snapshot
    const refModel = Object.entries(previousSnapshot).find(([, s]) => s.table === references.references);
    const fkType = refModel && refModel[1].idType === 'string' ? 'VARCHAR(255)' : 'INT';
    upStatements.push(`ALTER TABLE \`${table}\` DROP FOREIGN KEY \`${column}\`;`);
    upStatements.push(`ALTER TABLE \`${table}\` DROP COLUMN \`${column}\`;`);
    downStatements.push(`ALTER TABLE \`${table}\` ADD COLUMN \`${column}\` ${fkType};`);
    downStatements.push(`ALTER TABLE \`${table}\` ADD FOREIGN KEY (\`${column}\`) REFERENCES \`${references.references}\`(\`${references.column}\`) ON DELETE SET NULL;`);
  }

  const sanitizedDescription = description.replace(/\s+/g, '_').replace(/[^a-zA-Z0-9_]/g, '');
  const timestamp = Math.floor(Date.now() / 1000);
  const filename = `${timestamp}_${sanitizedDescription}.sql`;
  const content = `-- UP\n${upStatements.join('\n')}\n\n-- DOWN\n${downStatements.join('\n')}\n`;

  await createFile(path.join(migrationsPath, filename), content);
  await createFile(path.join(migrationsPath, '.snapshot.json'), JSON.stringify(currentSnapshot, null, 2));

  log.db(`Migration generated: ${filename}`);

  return { filename, content, snapshot: currentSnapshot };
}

export async function loadLatestSnapshot(migrationsPath) {
  const snapshotPath = path.join(migrationsPath, '.snapshot.json');
  const exists = await fileExists(snapshotPath);

  if (!exists) return {};

  return readFile(snapshotPath, { json: true });
}

export function diffSnapshots(previous, current) {
  const addedModels = [];
  const removedModels = [];
  const addedColumns = [];
  const removedColumns = [];
  const changedColumns = [];
  const addedForeignKeys = [];
  const removedForeignKeys = [];

  // Find added models
  for (const name of Object.keys(current)) {
    if (!previous[name]) addedModels.push(name);
  }

  // Find removed models
  for (const name of Object.keys(previous)) {
    if (!current[name]) removedModels.push(name);
  }

  // Find column changes in existing models
  for (const name of Object.keys(current)) {
    if (!previous[name]) continue;

    const { columns: prevCols = {} } = previous[name];
    const { columns: currCols = {} } = current[name];

    // Added columns
    for (const [col, type] of Object.entries(currCols)) {
      if (!prevCols[col]) {
        addedColumns.push({ model: name, column: col, type });
      } else if (prevCols[col] !== type) {
        changedColumns.push({ model: name, column: col, from: prevCols[col], to: type });
      }
    }

    // Removed columns
    for (const [col, type] of Object.entries(prevCols)) {
      if (!currCols[col]) {
        removedColumns.push({ model: name, column: col, type });
      }
    }

    // Foreign key changes
    const prevFKs = previous[name].foreignKeys || {};
    const currFKs = current[name].foreignKeys || {};

    for (const [col, refs] of Object.entries(currFKs)) {
      if (!prevFKs[col]) {
        addedForeignKeys.push({ model: name, column: col, references: refs });
      }
    }

    for (const [col, refs] of Object.entries(prevFKs)) {
      if (!currFKs[col]) {
        removedForeignKeys.push({ model: name, column: col, references: refs });
      }
    }
  }

  const hasChanges = addedModels.length > 0 || removedModels.length > 0 ||
    addedColumns.length > 0 || removedColumns.length > 0 ||
    changedColumns.length > 0 || addedForeignKeys.length > 0 || removedForeignKeys.length > 0;

  return {
    hasChanges,
    addedModels,
    removedModels,
    addedColumns,
    removedColumns,
    changedColumns,
    addedForeignKeys,
    removedForeignKeys,
  };
}

export function detectSchemaDrift(schemas, snapshot) {
  const current = schemasToSnapshot(schemas);
  return diffSnapshots(snapshot, current);
}
