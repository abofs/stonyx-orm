import QUnit from 'qunit';
import { execFile } from 'child_process';
import { promises as fsp } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '../..');
const scriptsDir = path.join(projectRoot, 'scripts');
const tmpDir = path.join(projectRoot, 'test', 'sample', 'tmp-migrate');

const sampleData = {
  owners: [
    { id: 'gina', gender: 'female', age: 34 },
    { id: 'bob', gender: 'male', age: 44 }
  ],
  animals: [
    { id: 1, type: 'dog', owner: 'gina' },
    { id: 2, type: 'cat', owner: 'bob' }
  ],
  traits: [
    { id: 1, type: 'habitat', value: 'farm' }
  ]
};

function run(script, cwd, env={}) {
  return new Promise((resolve, reject) => {
    execFile('node', [script], {
      cwd,
      env: { ...process.env, ...env }
    }, (error, stdout, stderr) => {
      resolve({ error, stdout, stderr, code: error?.code ?? 0 });
    });
  });
}

const { module, test } = QUnit;

module('[Unit] Migration Scripts', function(hooks) {
  hooks.beforeEach(async function() {
    await fsp.mkdir(tmpDir, { recursive: true });
  });

  hooks.afterEach(async function() {
    await fsp.rm(tmpDir, { recursive: true, force: true });
  });

  module('file-to-directory', function() {
    test('splits db.json into collection files', async function(assert) {
      const dbFilePath = path.join(tmpDir, 'db.json');
      await fsp.writeFile(dbFilePath, JSON.stringify(sampleData, null, '\t'));

      const result = await run(
        path.join(scriptsDir, 'file-to-directory.js'),
        tmpDir,
        { DB_FILE: 'db.json', DB_DIRECTORY: 'db' }
      );

      assert.equal(result.code, 0, 'script exits successfully');
      assert.ok(result.stdout.includes('Migrated 3 collections'), 'prints migration summary');

      // Verify collection files exist with correct data
      const ownersData = JSON.parse(await fsp.readFile(path.join(tmpDir, 'db', 'owners.json'), 'utf8'));
      assert.deepEqual(ownersData, sampleData.owners, 'owners.json has correct data');

      const animalsData = JSON.parse(await fsp.readFile(path.join(tmpDir, 'db', 'animals.json'), 'utf8'));
      assert.deepEqual(animalsData, sampleData.animals, 'animals.json has correct data');

      const traitsData = JSON.parse(await fsp.readFile(path.join(tmpDir, 'db', 'traits.json'), 'utf8'));
      assert.deepEqual(traitsData, sampleData.traits, 'traits.json has correct data');

      // Verify db.json is now a skeleton
      const skeleton = JSON.parse(await fsp.readFile(dbFilePath, 'utf8'));

      for (const key of Object.keys(sampleData)) {
        assert.deepEqual(skeleton[key], [], `${key} is empty in db.json`);
      }
    });

    test('handles custom DB_FILE and DB_DIRECTORY', async function(assert) {
      const dbFilePath = path.join(tmpDir, 'custom.json');
      await fsp.writeFile(dbFilePath, JSON.stringify(sampleData, null, '\t'));

      const result = await run(
        path.join(scriptsDir, 'file-to-directory.js'),
        tmpDir,
        { DB_FILE: 'custom.json', DB_DIRECTORY: 'data' }
      );

      assert.equal(result.code, 0, 'script exits successfully');

      const ownersData = JSON.parse(await fsp.readFile(path.join(tmpDir, 'data', 'owners.json'), 'utf8'));
      assert.deepEqual(ownersData, sampleData.owners, 'custom directory has owners.json');
    });

    test('handles empty db.json gracefully', async function(assert) {
      const dbFilePath = path.join(tmpDir, 'db.json');
      await fsp.writeFile(dbFilePath, JSON.stringify({}));

      const result = await run(
        path.join(scriptsDir, 'file-to-directory.js'),
        tmpDir,
        { DB_FILE: 'db.json', DB_DIRECTORY: 'db' }
      );

      assert.equal(result.code, 0, 'script exits successfully');
      assert.ok(result.stdout.includes('Nothing to migrate'), 'prints nothing-to-migrate message');
    });

    test('fails when db.json does not exist', async function(assert) {
      const result = await run(
        path.join(scriptsDir, 'file-to-directory.js'),
        tmpDir,
        { DB_FILE: 'nonexistent.json', DB_DIRECTORY: 'db' }
      );

      assert.ok(result.code !== 0 || result.stderr.includes('Migration failed'), 'script fails');
    });

    test('output files are tab-indented JSON', async function(assert) {
      const dbFilePath = path.join(tmpDir, 'db.json');
      await fsp.writeFile(dbFilePath, JSON.stringify(sampleData, null, '\t'));

      await run(
        path.join(scriptsDir, 'file-to-directory.js'),
        tmpDir,
        { DB_FILE: 'db.json', DB_DIRECTORY: 'db' }
      );

      const raw = await fsp.readFile(path.join(tmpDir, 'db', 'owners.json'), 'utf8');
      assert.ok(raw.includes('\t'), 'collection file is tab-indented');

      const skeletonRaw = await fsp.readFile(path.join(tmpDir, 'db.json'), 'utf8');
      assert.ok(skeletonRaw.includes('\t'), 'skeleton db.json is tab-indented');
    });
  });

  module('directory-to-file', function() {
    test('merges collection files into db.json', async function(assert) {
      // Setup directory structure
      const dirPath = path.join(tmpDir, 'db');
      await fsp.mkdir(dirPath, { recursive: true });

      for (const [key, value] of Object.entries(sampleData)) {
        await fsp.writeFile(path.join(dirPath, `${key}.json`), JSON.stringify(value, null, '\t'));
      }

      // Write skeleton db.json so the file exists
      const skeleton = {};
      for (const key of Object.keys(sampleData)) skeleton[key] = [];
      await fsp.writeFile(path.join(tmpDir, 'db.json'), JSON.stringify(skeleton, null, '\t'));

      const result = await run(
        path.join(scriptsDir, 'directory-to-file.js'),
        tmpDir,
        { DB_FILE: 'db.json', DB_DIRECTORY: 'db' }
      );

      assert.equal(result.code, 0, 'script exits successfully');
      assert.ok(result.stdout.includes('Migrated 3 collections'), 'prints migration summary');

      // Verify db.json has all data
      const fullData = JSON.parse(await fsp.readFile(path.join(tmpDir, 'db.json'), 'utf8'));
      assert.deepEqual(fullData, sampleData, 'db.json has full assembled data');

      // Verify directory was removed
      try {
        await fsp.access(dirPath);
        assert.notOk(true, 'directory should have been removed');
      } catch {
        assert.ok(true, 'directory was removed');
      }
    });

    test('handles custom DB_FILE and DB_DIRECTORY', async function(assert) {
      const dirPath = path.join(tmpDir, 'data');
      await fsp.mkdir(dirPath, { recursive: true });

      for (const [key, value] of Object.entries(sampleData)) {
        await fsp.writeFile(path.join(dirPath, `${key}.json`), JSON.stringify(value, null, '\t'));
      }

      await fsp.writeFile(path.join(tmpDir, 'custom.json'), JSON.stringify({}));

      const result = await run(
        path.join(scriptsDir, 'directory-to-file.js'),
        tmpDir,
        { DB_FILE: 'custom.json', DB_DIRECTORY: 'data' }
      );

      assert.equal(result.code, 0, 'script exits successfully');

      const fullData = JSON.parse(await fsp.readFile(path.join(tmpDir, 'custom.json'), 'utf8'));
      assert.deepEqual(fullData, sampleData, 'custom db file has full data');
    });

    test('fails when directory does not exist', async function(assert) {
      const result = await run(
        path.join(scriptsDir, 'directory-to-file.js'),
        tmpDir,
        { DB_FILE: 'db.json', DB_DIRECTORY: 'nonexistent' }
      );

      assert.ok(result.code !== 0 || result.stderr.includes('Migration failed'), 'script fails');
    });

    test('handles empty directory gracefully', async function(assert) {
      const dirPath = path.join(tmpDir, 'db');
      await fsp.mkdir(dirPath, { recursive: true });

      const result = await run(
        path.join(scriptsDir, 'directory-to-file.js'),
        tmpDir,
        { DB_FILE: 'db.json', DB_DIRECTORY: 'db' }
      );

      assert.equal(result.code, 0, 'script exits successfully');
      assert.ok(result.stdout.includes('Nothing to migrate'), 'prints nothing-to-migrate message');
    });

    test('output file is tab-indented JSON', async function(assert) {
      const dirPath = path.join(tmpDir, 'db');
      await fsp.mkdir(dirPath, { recursive: true });

      for (const [key, value] of Object.entries(sampleData)) {
        await fsp.writeFile(path.join(dirPath, `${key}.json`), JSON.stringify(value, null, '\t'));
      }

      await fsp.writeFile(path.join(tmpDir, 'db.json'), JSON.stringify({}));

      await run(
        path.join(scriptsDir, 'directory-to-file.js'),
        tmpDir,
        { DB_FILE: 'db.json', DB_DIRECTORY: 'db' }
      );

      const raw = await fsp.readFile(path.join(tmpDir, 'db.json'), 'utf8');
      assert.ok(raw.includes('\t'), 'db.json is tab-indented');
    });
  });

  module('round-trip', function() {
    test('file → directory → file preserves data', async function(assert) {
      const dbFilePath = path.join(tmpDir, 'db.json');
      await fsp.writeFile(dbFilePath, JSON.stringify(sampleData, null, '\t'));

      // file → directory
      await run(
        path.join(scriptsDir, 'file-to-directory.js'),
        tmpDir,
        { DB_FILE: 'db.json', DB_DIRECTORY: 'db' }
      );

      // directory → file
      await run(
        path.join(scriptsDir, 'directory-to-file.js'),
        tmpDir,
        { DB_FILE: 'db.json', DB_DIRECTORY: 'db' }
      );

      const finalData = JSON.parse(await fsp.readFile(dbFilePath, 'utf8'));
      assert.deepEqual(finalData, sampleData, 'data preserved through round-trip');
    });
  });
});
