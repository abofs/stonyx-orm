import { introspectModels, introspectViews, buildTableDDL, buildViewDDL, schemasToSnapshot, viewSchemasToSnapshot, getTopologicalOrder } from './schema-introspector.js';
import type { ModelSchema, SnapshotEntry, ViewSnapshotEntry, ForeignKeyDef } from './schema-introspector.js';
import { readFile, createFile, createDirectory, fileExists } from '@stonyx/utils/file';
import path from 'path';
import config from 'stonyx/config';
import log from 'stonyx/log';

interface ColumnChange {
  model: string;
  column: string;
  type: string;
}

interface ColumnTypeChange {
  model: string;
  column: string;
  from: string;
  to: string;
}

interface ForeignKeyChange {
  model: string;
  column: string;
  references: ForeignKeyDef;
}

interface SnapshotDiff {
  hasChanges: boolean;
  addedModels: string[];
  removedModels: string[];
  addedColumns: ColumnChange[];
  removedColumns: ColumnChange[];
  changedColumns: ColumnTypeChange[];
  addedForeignKeys: ForeignKeyChange[];
  removedForeignKeys: ForeignKeyChange[];
}

interface ViewDiff {
  hasChanges: boolean;
  addedViews: string[];
  removedViews: string[];
  changedViews: string[];
}

interface GeneratedMigration {
  filename: string;
  content: string;
  snapshot: Record<string, SnapshotEntry | ViewSnapshotEntry>;
}

type Snapshot = Record<string, SnapshotEntry & { isView?: boolean; viewName?: string; viewQuery?: string; source?: string }>;

export async function generateMigration(description: string = 'migration'): Promise<GeneratedMigration | null> {
  const mysqlConfig = config.orm.mysql;
  if (!mysqlConfig) throw new Error('MySQL configuration (config.orm.mysql) is required for migration generation');
  const { migrationsDir } = mysqlConfig;
  if (!migrationsDir) throw new Error('MySQL migrationsDir is required in config');
  const rootPath = config.rootPath;
  const migrationsPath = path.resolve(rootPath, migrationsDir);

  await createDirectory(migrationsPath);

  const schemas = introspectModels();
  const currentSnapshot = schemasToSnapshot(schemas);
  const previousSnapshot = await loadLatestSnapshot(migrationsPath) as Snapshot;
  const diff = diffSnapshots(previousSnapshot, currentSnapshot);

  // Don't return early — check view changes too before deciding
  if (!diff.hasChanges) {
    // Check if there are view changes before returning null
    const viewSchemasPrelim = introspectViews();
    const currentViewSnapshotPrelim = viewSchemasToSnapshot(viewSchemasPrelim);
    const previousViewSnapshotPrelim = extractViewsFromSnapshot(previousSnapshot);
    const viewDiffPrelim = diffViewSnapshots(previousViewSnapshotPrelim, currentViewSnapshotPrelim);

    if (!viewDiffPrelim.hasChanges) {
      log.db?.('No schema changes detected.');
      return null;
    }
  }

  const upStatements: string[] = [];
  const downStatements: string[] = [];

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
    const table = previousSnapshot[model]?.table;
    if (!table) throw new Error(`Missing table name in snapshot for model "${model}"`);
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
    const table = previousSnapshot[model]?.table;
    if (!table) throw new Error(`Missing table name in snapshot for model "${model}"`);
    // Resolve FK column type from the referenced table's PK type in previous snapshot
    const refModel = Object.entries(previousSnapshot).find(([, s]) => s.table === references.references);
    const fkType = refModel && refModel[1].idType === 'string' ? 'VARCHAR(255)' : 'INT';
    upStatements.push(`ALTER TABLE \`${table}\` DROP FOREIGN KEY \`${column}\`;`);
    upStatements.push(`ALTER TABLE \`${table}\` DROP COLUMN \`${column}\`;`);
    downStatements.push(`ALTER TABLE \`${table}\` ADD COLUMN \`${column}\` ${fkType};`);
    downStatements.push(`ALTER TABLE \`${table}\` ADD FOREIGN KEY (\`${column}\`) REFERENCES \`${references.references}\`(\`${references.column}\`) ON DELETE SET NULL;`);
  }

  // View migrations — views are created AFTER tables (dependency order)
  const viewSchemas = introspectViews();
  const currentViewSnapshot = viewSchemasToSnapshot(viewSchemas);
  const previousViewSnapshot = extractViewsFromSnapshot(previousSnapshot);
  const viewDiff = diffViewSnapshots(previousViewSnapshot, currentViewSnapshot);

  if (viewDiff.hasChanges) {
    upStatements.push('');
    upStatements.push('-- Views');
    downStatements.push('');
    downStatements.push('-- Views');

    // Added views
    for (const name of viewDiff.addedViews) {
      try {
        const ddl = buildViewDDL(name, viewSchemas[name], schemas);
        upStatements.push(ddl + ';');
        downStatements.unshift(`DROP VIEW IF EXISTS \`${viewSchemas[name].viewName}\`;`);
      } catch (error) {
        upStatements.push(`-- WARNING: Could not generate DDL for view '${name}': ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    // Removed views
    for (const name of viewDiff.removedViews) {
      upStatements.push(`-- WARNING: View '${name}' was removed. Uncomment to drop view:`);
      upStatements.push(`-- DROP VIEW IF EXISTS \`${previousViewSnapshot[name].viewName}\`;`);
      downStatements.push(`-- Recreate view for removed view '${name}' manually if needed`);
    }

    // Changed views (source or aggregates changed)
    for (const name of viewDiff.changedViews) {
      try {
        const ddl = buildViewDDL(name, viewSchemas[name], schemas);
        upStatements.push(ddl + ';');
      } catch (error) {
        upStatements.push(`-- WARNING: Could not generate DDL for changed view '${name}': ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }

  const combinedHasChanges = diff.hasChanges || viewDiff.hasChanges;

  if (!combinedHasChanges) {
    log.db?.('No schema changes detected.');
    return null;
  }

  // Merge view snapshot into the main snapshot
  const combinedSnapshot: Record<string, SnapshotEntry | ViewSnapshotEntry> = { ...currentSnapshot };
  for (const [name, viewSnap] of Object.entries(currentViewSnapshot)) {
    combinedSnapshot[name] = viewSnap;
  }

  const sanitizedDescription = description.replace(/\s+/g, '_').replace(/[^a-zA-Z0-9_]/g, '');
  const timestamp = Math.floor(Date.now() / 1000);
  const filename = `${timestamp}_${sanitizedDescription}.sql`;
  const content = `-- UP\n${upStatements.join('\n')}\n\n-- DOWN\n${downStatements.join('\n')}\n`;

  await createFile(path.join(migrationsPath, filename), content);
  await createFile(path.join(migrationsPath, '.snapshot.json'), JSON.stringify(combinedSnapshot, null, 2));

  log.db?.(`Migration generated: ${filename}`);

  return { filename, content, snapshot: combinedSnapshot };
}

export async function loadLatestSnapshot(migrationsPath: string): Promise<Record<string, unknown>> {
  const snapshotPath = path.join(migrationsPath, '.snapshot.json');
  const exists = await fileExists(snapshotPath);

  if (!exists) return {};

  return readFile(snapshotPath, { json: true }) as Promise<Record<string, unknown>>;
}

export function diffSnapshots(previous: Record<string, SnapshotEntry>, current: Record<string, SnapshotEntry>): SnapshotDiff {
  const addedModels: string[] = [];
  const removedModels: string[] = [];
  const addedColumns: ColumnChange[] = [];
  const removedColumns: ColumnChange[] = [];
  const changedColumns: ColumnTypeChange[] = [];
  const addedForeignKeys: ForeignKeyChange[] = [];
  const removedForeignKeys: ForeignKeyChange[] = [];

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

export function detectSchemaDrift(schemas: Record<string, ModelSchema>, snapshot: Record<string, SnapshotEntry>): SnapshotDiff {
  const current = schemasToSnapshot(schemas);
  return diffSnapshots(snapshot, current);
}

export function extractViewsFromSnapshot(snapshot: Record<string, unknown>): Record<string, ViewSnapshotEntry> {
  const views: Record<string, ViewSnapshotEntry> = {};
  for (const [name, entry] of Object.entries(snapshot)) {
    if ((entry as { isView?: boolean }).isView) views[name] = entry as ViewSnapshotEntry;
  }
  return views;
}

export function diffViewSnapshots(previous: Record<string, ViewSnapshotEntry>, current: Record<string, ViewSnapshotEntry>): ViewDiff {
  const addedViews: string[] = [];
  const removedViews: string[] = [];
  const changedViews: string[] = [];

  for (const name of Object.keys(current)) {
    if (!previous[name]) {
      addedViews.push(name);
    } else if (
      current[name].viewQuery !== previous[name].viewQuery ||
      current[name].source !== previous[name].source
    ) {
      changedViews.push(name);
    }
  }

  for (const name of Object.keys(previous)) {
    if (!current[name]) {
      removedViews.push(name);
    }
  }

  const hasChanges = addedViews.length > 0 || removedViews.length > 0 || changedViews.length > 0;

  return { hasChanges, addedViews, removedViews, changedViews };
}
