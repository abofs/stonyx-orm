#!/usr/bin/env node

/**
 * Standalone migration script: file → directory mode
 *
 * Reads all data from db.json and splits each collection into its own file
 * under a configurable directory. Overwrites db.json with an empty-array skeleton.
 *
 * Env vars:
 *   DB_FILE       – path to db.json (default: 'db.json')
 *   DB_DIRECTORY   – directory name for collection files (default: 'db')
 *
 * Usage:
 *   node node_modules/@stonyx/orm/scripts/file-to-directory.js
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
  const raw = await fsp.readFile(dbFilePath, 'utf8');
  const data = JSON.parse(raw);
  const collectionKeys = Object.keys(data);

  if (!collectionKeys.length) {
    console.log('Nothing to migrate — db.json has no collections.');
    process.exit(0);
  }

  // Create the directory
  await fsp.mkdir(dirPath, { recursive: true });

  // Write each collection to its own file
  await Promise.all(collectionKeys.map(key =>
    fsp.writeFile(path.join(dirPath, `${key}.json`), JSON.stringify(data[key] || [], null, '\t'), 'utf8')
  ));

  // Overwrite db.json with empty-array skeleton
  const skeleton = {};
  for (const key of collectionKeys) skeleton[key] = [];

  await fsp.writeFile(dbFilePath, JSON.stringify(skeleton, null, '\t'), 'utf8');

  console.log(`Migrated ${collectionKeys.length} collections from ${dbFile} → ${directory}/`);
  console.log(`  Collections: ${collectionKeys.join(', ')}`);
} catch (error) {
  console.error('Migration failed:', error.message);
  process.exit(1);
}
