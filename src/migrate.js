import config from 'stonyx/config';
import Orm from '@stonyx/orm';
import { createFile, createDirectory, readFile, updateFile, deleteDirectory } from '@stonyx/utils/file';
import { dbKey } from './db.js';
import path from 'path';

function getCollectionKeys() {
  const SchemaClass = Orm.instance.models[`${dbKey}Model`];
  const instance = new SchemaClass();
  const keys = [];

  for (const key of Object.keys(instance)) {
    if (key === '__name' || key === 'id') continue;
    if (typeof instance[key] === 'function') keys.push(key);
  }

  return keys;
}

function getDirPath() {
  const { rootPath } = config;
  const { file, directory } = config.orm.db;
  const dbDir = path.dirname(path.resolve(`${rootPath}/${file}`));

  return path.join(dbDir, directory);
}

export async function fileToDirectory() {
  const { rootPath } = config;
  const { file } = config.orm.db;
  const dbFilePath = path.resolve(`${rootPath}/${file}`);
  const collectionKeys = getCollectionKeys();
  const dirPath = getDirPath();

  // Read full data from db.json
  const data = await readFile(dbFilePath, { json: true });

  // Create directory and write each collection
  await createDirectory(dirPath);

  await Promise.all(collectionKeys.map(key =>
    createFile(path.join(dirPath, `${key}.json`), data[key] || [], { json: true })
  ));

  // Overwrite db.json with empty-array skeleton
  const skeleton = {};
  for (const key of collectionKeys) skeleton[key] = [];

  await updateFile(dbFilePath, skeleton, { json: true });
}

export async function directoryToFile() {
  const { rootPath } = config;
  const { file } = config.orm.db;
  const dbFilePath = path.resolve(`${rootPath}/${file}`);
  const collectionKeys = getCollectionKeys();
  const dirPath = getDirPath();

  // Read each collection from the directory
  const assembled = {};

  await Promise.all(collectionKeys.map(async key => {
    const filePath = path.join(dirPath, `${key}.json`);
    assembled[key] = await readFile(filePath, { json: true });
  }));

  // Overwrite db.json with full assembled data
  await updateFile(dbFilePath, assembled, { json: true });

  // Remove the directory
  await deleteDirectory(dirPath);
}
