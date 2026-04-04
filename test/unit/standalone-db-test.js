import QUnit from 'qunit';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import StandaloneDB from '../../src/standalone-db.js';

const { module, test } = QUnit;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const tmpDir = path.join(__dirname, '..', '.tmp-standalone-db-test');

module('[Unit] StandaloneDB', function(hooks) {
  hooks.beforeEach(async function() {
    await fs.mkdir(tmpDir, { recursive: true });
  });

  hooks.afterEach(async function() {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  module('file mode', function() {
    test('create and list records', async function(assert) {
      const dbPath = path.join(tmpDir, 'db.json');
      await fs.writeFile(dbPath, JSON.stringify({ owners: [] }));

      const db = new StandaloneDB({ dbPath, mode: 'file' });
      const created = await db.create('owners', { name: 'Alice' });

      assert.equal(created.id, 1, 'auto-assigns id 1');
      assert.equal(created.name, 'Alice');

      const records = await db.list('owners');
      assert.equal(records.length, 1);
      assert.equal(records[0].name, 'Alice');
    });

    test('get record by id', async function(assert) {
      const dbPath = path.join(tmpDir, 'db.json');
      await fs.writeFile(dbPath, JSON.stringify({
        owners: [{ id: 1, name: 'Alice' }, { id: 2, name: 'Bob' }]
      }));

      const db = new StandaloneDB({ dbPath, mode: 'file' });
      const record = await db.get('owners', 2);

      assert.equal(record.name, 'Bob');
    });

    test('get record by string id coerced to number', async function(assert) {
      const dbPath = path.join(tmpDir, 'db.json');
      await fs.writeFile(dbPath, JSON.stringify({
        owners: [{ id: 1, name: 'Alice' }]
      }));

      const db = new StandaloneDB({ dbPath, mode: 'file' });
      const record = await db.get('owners', '1');

      assert.equal(record.name, 'Alice');
    });

    test('get returns null for missing record', async function(assert) {
      const dbPath = path.join(tmpDir, 'db.json');
      await fs.writeFile(dbPath, JSON.stringify({ owners: [] }));

      const db = new StandaloneDB({ dbPath, mode: 'file' });
      const record = await db.get('owners', 999);

      assert.strictEqual(record, null);
    });

    test('delete record', async function(assert) {
      const dbPath = path.join(tmpDir, 'db.json');
      await fs.writeFile(dbPath, JSON.stringify({
        owners: [{ id: 1, name: 'Alice' }, { id: 2, name: 'Bob' }]
      }));

      const db = new StandaloneDB({ dbPath, mode: 'file' });
      const removed = await db.delete('owners', 1);

      assert.equal(removed.name, 'Alice');

      const remaining = await db.list('owners');
      assert.equal(remaining.length, 1);
      assert.equal(remaining[0].name, 'Bob');
    });

    test('delete throws for missing record', async function(assert) {
      const dbPath = path.join(tmpDir, 'db.json');
      await fs.writeFile(dbPath, JSON.stringify({ owners: [] }));

      const db = new StandaloneDB({ dbPath, mode: 'file' });

      await assert.rejects(
        db.delete('owners', 999),
        /not found/,
        'throws when record not found'
      );
    });

    test('create prevents duplicate ids', async function(assert) {
      const dbPath = path.join(tmpDir, 'db.json');
      await fs.writeFile(dbPath, JSON.stringify({
        owners: [{ id: 1, name: 'Alice' }]
      }));

      const db = new StandaloneDB({ dbPath, mode: 'file' });

      await assert.rejects(
        db.create('owners', { id: 1, name: 'Duplicate' }),
        /already exists/,
        'throws on duplicate id'
      );
    });

    test('auto-increment id is based on max existing id', async function(assert) {
      const dbPath = path.join(tmpDir, 'db.json');
      await fs.writeFile(dbPath, JSON.stringify({
        owners: [{ id: 5, name: 'Alice' }]
      }));

      const db = new StandaloneDB({ dbPath, mode: 'file' });
      const created = await db.create('owners', { name: 'Bob' });

      assert.equal(created.id, 6, 'id is max + 1');
    });

    test('getCollections returns array keys from db.json', async function(assert) {
      const dbPath = path.join(tmpDir, 'db.json');
      await fs.writeFile(dbPath, JSON.stringify({
        owners: [],
        animals: [],
        metaString: 'not-an-array'
      }));

      const db = new StandaloneDB({ dbPath, mode: 'file' });
      const collections = await db.getCollections();

      assert.deepEqual(collections, ['owners', 'animals']);
    });
  });

  module('directory mode', function() {
    test('create and list records', async function(assert) {
      const dbDir = path.join(tmpDir, 'db');
      await fs.mkdir(dbDir, { recursive: true });
      await fs.writeFile(path.join(dbDir, 'owners.json'), '[]');

      const db = new StandaloneDB({
        dbPath: path.join(tmpDir, 'db.json'),
        mode: 'directory',
        directory: 'db'
      });

      const created = await db.create('owners', { name: 'Alice' });

      assert.equal(created.id, 1);
      assert.equal(created.name, 'Alice');

      const records = await db.list('owners');
      assert.equal(records.length, 1);
      assert.equal(records[0].name, 'Alice');
    });

    test('get record by id', async function(assert) {
      const dbDir = path.join(tmpDir, 'db');
      await fs.mkdir(dbDir, { recursive: true });
      await fs.writeFile(path.join(dbDir, 'owners.json'), JSON.stringify([
        { id: 1, name: 'Alice' },
        { id: 2, name: 'Bob' }
      ]));

      const db = new StandaloneDB({
        dbPath: path.join(tmpDir, 'db.json'),
        mode: 'directory',
        directory: 'db'
      });

      const record = await db.get('owners', 2);
      assert.equal(record.name, 'Bob');
    });

    test('delete record', async function(assert) {
      const dbDir = path.join(tmpDir, 'db');
      await fs.mkdir(dbDir, { recursive: true });
      await fs.writeFile(path.join(dbDir, 'owners.json'), JSON.stringify([
        { id: 1, name: 'Alice' },
        { id: 2, name: 'Bob' }
      ]));

      const db = new StandaloneDB({
        dbPath: path.join(tmpDir, 'db.json'),
        mode: 'directory',
        directory: 'db'
      });

      const removed = await db.delete('owners', 1);
      assert.equal(removed.name, 'Alice');

      const remaining = await db.list('owners');
      assert.equal(remaining.length, 1);
      assert.equal(remaining[0].name, 'Bob');
    });

    test('create auto-creates directory when missing', async function(assert) {
      // Don't pre-create the db dir — let writeCollection handle it
      const dbDir = path.join(tmpDir, 'db');

      const db = new StandaloneDB({
        dbPath: path.join(tmpDir, 'db.json'),
        mode: 'directory',
        directory: 'db'
      });

      // writeCollection creates the dir; but readCollection will fail on missing file.
      // So first write an empty collection to bootstrap it.
      await db.writeCollection('owners', []);

      const created = await db.create('owners', { name: 'Alice' });
      assert.equal(created.id, 1);

      // Verify the directory and file exist
      const stat = await fs.stat(path.join(dbDir, 'owners.json'));
      assert.ok(stat.isFile());
    });

    test('getCollections returns filenames from directory', async function(assert) {
      const dbDir = path.join(tmpDir, 'db');
      await fs.mkdir(dbDir, { recursive: true });
      await fs.writeFile(path.join(dbDir, 'owners.json'), '[]');
      await fs.writeFile(path.join(dbDir, 'animals.json'), '[]');

      const db = new StandaloneDB({
        dbPath: path.join(tmpDir, 'db.json'),
        mode: 'directory',
        directory: 'db'
      });

      const collections = await db.getCollections();
      assert.ok(collections.includes('owners'));
      assert.ok(collections.includes('animals'));
      assert.equal(collections.length, 2);
    });
  });

  module('defaults', function() {
    test('defaults to directory mode', function(assert) {
      const db = new StandaloneDB();

      assert.equal(db.mode, 'directory');
      assert.equal(db.dbPath, 'db.json');
      assert.equal(db.directory, 'db');
    });
  });
});
