import config from 'stonyx/config';
import Orm from './main.js';
import { createFile, createDirectory, readFile, updateFile, deleteDirectory } from '@stonyx/utils/file';
import { dbKey } from './db.js';
import path from 'path';

function getCollectionKeys(): string[] {
  const SchemaClass = (Orm.instance as Orm).models[`${dbKey}Model`] as new () => Record<string, unknown>;
  const instance = new SchemaClass();
  const keys: string[] = [];

  for (const key of Object.keys(instance)) {
    if (key === '__name' || key === 'id') continue;
    if (typeof instance[key] === 'function') keys.push(key);
  }

  return keys;
}

function getDirPath(): string {
  const { rootPath } = config as { rootPath: string; orm: { db: { file: string; directory: string } } };
  const { file, directory } = (config as { orm: { db: { file: string; directory: string } } }).orm.db;
  const dbDir = path.dirname(path.resolve(`${rootPath}/${file}`));

  return path.join(dbDir, directory);
}

export async function fileToDirectory(): Promise<void> {
  const { rootPath } = config as { rootPath: string };
  const { file } = (config as { orm: { db: { file: string } } }).orm.db;
  const dbFilePath = path.resolve(`${rootPath}/${file}`);
  const collectionKeys = getCollectionKeys();
  const dirPath = getDirPath();

  // Read full data from db.json
  const data = await readFile(dbFilePath, { json: true }) as Record<string, unknown[]>;

  // Create directory and write each collection
  await createDirectory(dirPath);

  await Promise.all(collectionKeys.map(key =>
    createFile(path.join(dirPath, `${key}.json`), data[key] || [], { json: true })
  ));

  // Overwrite db.json with empty-array skeleton
  const skeleton: Record<string, unknown[]> = {};
  for (const key of collectionKeys) skeleton[key] = [];

  await updateFile(dbFilePath, skeleton, { json: true });
}

export async function directoryToFile(): Promise<void> {
  const { rootPath } = config as { rootPath: string };
  const { file } = (config as { orm: { db: { file: string } } }).orm.db;
  const dbFilePath = path.resolve(`${rootPath}/${file}`);
  const collectionKeys = getCollectionKeys();
  const dirPath = getDirPath();

  // Read each collection from the directory
  const assembled: Record<string, unknown> = {};

  await Promise.all(collectionKeys.map(async key => {
    const filePath = path.join(dirPath, `${key}.json`);
    assembled[key] = await readFile(filePath, { json: true });
  }));

  // Overwrite db.json with full assembled data
  await updateFile(dbFilePath, assembled, { json: true });

  // Remove the directory
  await deleteDirectory(dirPath);
}
