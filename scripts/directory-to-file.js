#!/usr/bin/env node

/**
 * Standalone migration script: directory → file mode
 *
 * Reads each collection .json file from the directory, assembles them into
 * a single object, writes to db.json, and removes the directory.
 *
 * Env vars:
 *   DB_FILE       – path to db.json (default: 'db.json')
 *   DB_DIRECTORY   – directory name for collection files (default: 'db')
 *
 * Usage:
 *   node node_modules/@stonyx/orm/scripts/directory-to-file.js
 */

import { promises as fsp } from 'fs';
import path from 'path';

const rootPath = process.cwd();
const dbFile = process.env.DB_FILE || 'db.json';
const directory = process.env.DB_DIRECTORY || 'db';

const dbFilePath = path.resolve(rootPath, dbFile);
const dbDir = path.dirname(dbFilePath);
const dirPath = path.join(dbDir, directory);

try {
  const files = await fsp.readdir(dirPath);
  const jsonFiles = files.filter(f => f.endsWith('.json'));

  if (!jsonFiles.length) {
    console.log(`Nothing to migrate — ${directory}/ has no .json files.`);
    process.exit(0);
  }

  // Read each collection file and assemble
  const assembled = {};

  await Promise.all(jsonFiles.map(async file => {
    const key = file.replace('.json', '');
    const raw = await fsp.readFile(path.join(dirPath, file), 'utf8');
    assembled[key] = JSON.parse(raw);
  }));

  // Write assembled data to db.json
  await fsp.writeFile(dbFilePath, JSON.stringify(assembled, null, '\t'), 'utf8');

  // Remove the directory
  await fsp.rm(dirPath, { recursive: true, force: true });

  const collectionKeys = Object.keys(assembled);
  console.log(`Migrated ${collectionKeys.length} collections from ${directory}/ → ${dbFile}`);
  console.log(`  Collections: ${collectionKeys.join(', ')}`);
} catch (error) {
  console.error('Migration failed:', error.message);
  process.exit(1);
}
