import QUnit from 'qunit';
import { execFile } from 'child_process';
import { promisify } from 'util';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const exec = promisify(execFile);
const { module, test } = QUnit;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const cliPath = path.resolve(__dirname, '../../dist/cli.js');
const tmpDir = path.join(__dirname, '..', '.tmp-cli-test');

async function runCLI(args, env = {}) {
  return exec('node', [cliPath, ...args], {
    env: { ...process.env, ...env },
    cwd: tmpDir
  });
}

module('[Unit] CLI', function(hooks) {
  hooks.beforeEach(async function() {
    await fs.mkdir(tmpDir, { recursive: true });
  });

  hooks.afterEach(async function() {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  test('--help prints usage', async function(assert) {
    // Run from project root since --help doesn't need DB
    const { stdout } = await exec('node', [cliPath, '--help'], {
      env: process.env
    });

    assert.ok(stdout.includes('Usage:'), 'prints usage text');
    assert.ok(stdout.includes('create'), 'mentions create command');
    assert.ok(stdout.includes('list'), 'mentions list command');
    assert.ok(stdout.includes('get'), 'mentions get command');
    assert.ok(stdout.includes('delete'), 'mentions delete command');
  });

  module('file mode', function(hooks) {
    hooks.beforeEach(async function() {
      const dbPath = path.join(tmpDir, 'db.json');
      await fs.writeFile(dbPath, JSON.stringify({ owners: [], animals: [] }));
    });

    test('create a record', async function(assert) {
      const { stdout } = await runCLI(
        ['create', 'owners', '{"name":"Alice"}'],
        { DB_MODE: 'file', DB_PATH: path.join(tmpDir, 'db.json') }
      );

      const record = JSON.parse(stdout);
      assert.equal(record.id, 1);
      assert.equal(record.name, 'Alice');
    });

    test('list records', async function(assert) {
      // Seed data
      await fs.writeFile(
        path.join(tmpDir, 'db.json'),
        JSON.stringify({ owners: [{ id: 1, name: 'Alice' }] })
      );

      const { stdout } = await runCLI(
        ['list', 'owners'],
        { DB_MODE: 'file', DB_PATH: path.join(tmpDir, 'db.json') }
      );

      const records = JSON.parse(stdout);
      assert.equal(records.length, 1);
      assert.equal(records[0].name, 'Alice');
    });

    test('get a record by id', async function(assert) {
      await fs.writeFile(
        path.join(tmpDir, 'db.json'),
        JSON.stringify({ owners: [{ id: 1, name: 'Alice' }, { id: 2, name: 'Bob' }] })
      );

      const { stdout } = await runCLI(
        ['get', 'owners', '2'],
        { DB_MODE: 'file', DB_PATH: path.join(tmpDir, 'db.json') }
      );

      const record = JSON.parse(stdout);
      assert.equal(record.name, 'Bob');
    });

    test('get exits with error for missing record', async function(assert) {
      await fs.writeFile(
        path.join(tmpDir, 'db.json'),
        JSON.stringify({ owners: [] })
      );

      try {
        await runCLI(
          ['get', 'owners', '999'],
          { DB_MODE: 'file', DB_PATH: path.join(tmpDir, 'db.json') }
        );
        assert.ok(false, 'should have thrown');
      } catch (err) {
        assert.ok(err.stderr.includes('not found'), 'error message mentions not found');
      }
    });

    test('delete a record', async function(assert) {
      await fs.writeFile(
        path.join(tmpDir, 'db.json'),
        JSON.stringify({ owners: [{ id: 1, name: 'Alice' }, { id: 2, name: 'Bob' }] })
      );

      const { stdout } = await runCLI(
        ['delete', 'owners', '1'],
        { DB_MODE: 'file', DB_PATH: path.join(tmpDir, 'db.json') }
      );

      const removed = JSON.parse(stdout);
      assert.equal(removed.name, 'Alice');

      // Verify it was removed from the file
      const data = JSON.parse(await fs.readFile(path.join(tmpDir, 'db.json'), 'utf-8'));
      assert.equal(data.owners.length, 1);
      assert.equal(data.owners[0].name, 'Bob');
    });
  });

  module('directory mode', function(hooks) {
    hooks.beforeEach(async function() {
      const dbDir = path.join(tmpDir, 'db');
      await fs.mkdir(dbDir, { recursive: true });
      await fs.writeFile(path.join(dbDir, 'owners.json'), '[]');
    });

    test('create a record in directory mode', async function(assert) {
      const { stdout } = await runCLI(
        ['create', 'owners', '{"name":"Alice"}'],
        { DB_MODE: 'directory', DB_PATH: path.join(tmpDir, 'db.json'), DB_DIRECTORY: 'db' }
      );

      const record = JSON.parse(stdout);
      assert.equal(record.id, 1);
      assert.equal(record.name, 'Alice');

      // Verify it was written to the correct file
      const data = JSON.parse(
        await fs.readFile(path.join(tmpDir, 'db', 'owners.json'), 'utf-8')
      );
      assert.equal(data.length, 1);
      assert.equal(data[0].name, 'Alice');
    });

    test('list records in directory mode', async function(assert) {
      await fs.writeFile(
        path.join(tmpDir, 'db', 'owners.json'),
        JSON.stringify([{ id: 1, name: 'Alice' }])
      );

      const { stdout } = await runCLI(
        ['list', 'owners'],
        { DB_MODE: 'directory', DB_PATH: path.join(tmpDir, 'db.json'), DB_DIRECTORY: 'db' }
      );

      const records = JSON.parse(stdout);
      assert.equal(records.length, 1);
      assert.equal(records[0].name, 'Alice');
    });
  });

  module('--config flag', function() {
    test('loads config from a JSON file', async function(assert) {
      // Create a db.json file
      const dbPath = path.join(tmpDir, 'mydb.json');
      await fs.writeFile(dbPath, JSON.stringify({ items: [{ id: 1, value: 'test' }] }));

      // Create config file
      const configPath = path.join(tmpDir, 'cli-config.json');
      await fs.writeFile(configPath, JSON.stringify({
        mode: 'file',
        dbPath: dbPath
      }));

      // Clear env vars so config file takes precedence
      const { stdout } = await exec('node', [cliPath, '--config', configPath, 'list', 'items'], {
        env: {
          ...process.env,
          DB_MODE: '',
          DB_PATH: '',
          DB_DIRECTORY: ''
        },
        cwd: tmpDir
      });

      const records = JSON.parse(stdout);
      assert.equal(records.length, 1);
      assert.equal(records[0].value, 'test');
    });
  });

  module('error handling', function() {
    test('unknown command exits with error', async function(assert) {
      try {
        await runCLI(['bogus', 'owners'], {
          DB_MODE: 'file',
          DB_PATH: path.join(tmpDir, 'db.json')
        });
        assert.ok(false, 'should have thrown');
      } catch (err) {
        assert.ok(err.stderr.includes('Unknown command'), 'error mentions unknown command');
      }
    });

    test('create with invalid JSON exits with error', async function(assert) {
      await fs.writeFile(path.join(tmpDir, 'db.json'), JSON.stringify({ owners: [] }));

      try {
        await runCLI(
          ['create', 'owners', 'not-json'],
          { DB_MODE: 'file', DB_PATH: path.join(tmpDir, 'db.json') }
        );
        assert.ok(false, 'should have thrown');
      } catch (err) {
        assert.ok(err.stderr.includes('Invalid JSON'), 'error mentions invalid JSON');
      }
    });

    test('missing collection argument exits with error', async function(assert) {
      try {
        await runCLI(['list'], {
          DB_MODE: 'file',
          DB_PATH: path.join(tmpDir, 'db.json')
        });
        assert.ok(false, 'should have thrown');
      } catch (err) {
        assert.ok(err.stderr.includes('No collection'), 'error mentions missing collection');
      }
    });
  });
});
