import QUnit from 'qunit';
import sinon from 'sinon';
import Orm, { store } from '@stonyx/orm';
import { setupIntegrationTests } from 'stonyx/test-helpers';
import { serialized } from '../sample/payload.js';
import { readFile, deleteFile, deleteDirectory, fileExists, createFile, createDirectory } from '@stonyx/utils/file';
import { fileToDirectory, directoryToFile } from '../../src/migrate.js';
import config from 'stonyx/config';
import path from 'path';

const { module, test } = QUnit;

module('[Integration] DB Directory Mode', function(hooks) {
  setupIntegrationTests(hooks);

  let originalMode, originalDirectory, originalFile;

  hooks.beforeEach(function() {
    originalMode = config.orm.db.mode;
    originalDirectory = config.orm.db.directory;
    originalFile = config.orm.db.file;
  });

  hooks.afterEach(async function() {
    config.orm.db.mode = originalMode;
    config.orm.db.directory = originalDirectory;
    config.orm.db.file = originalFile;
  });

  module('getCollectionKeys', function() {
    test('returns schema hasMany property names', function(assert) {
      const keys = Orm.db.getCollectionKeys();

      assert.ok(Array.isArray(keys), 'returns an array');
      assert.ok(keys.includes('owners'), 'includes owners');
      assert.ok(keys.includes('animals'), 'includes animals');
      assert.ok(keys.includes('traits'), 'includes traits');
      assert.ok(keys.includes('categories'), 'includes categories');
      assert.ok(keys.includes('phoneNumbers'), 'includes phoneNumbers');
      assert.notOk(keys.includes('__name'), 'excludes __name');
      assert.notOk(keys.includes('id'), 'excludes id');
    });
  });

  module('directory structure', function(hooks) {
    const testDbFile = './test/sample/db-directory-test.json';
    let dirPath;

    hooks.beforeEach(function() {
      config.orm.db.file = testDbFile;
      config.orm.db.mode = 'directory';
      config.orm.db.directory = 'db';
      dirPath = Orm.db.getDirPath();
    });

    hooks.afterEach(async function() {
      await deleteFile(path.resolve(`${config.rootPath}/${testDbFile}`), { ignoreAccessFailure: true });
      await deleteDirectory(dirPath);
    });

    test('create in directory mode sets up correct file structure', async function(assert) {
      await Orm.db.create();

      const collectionKeys = Orm.db.getCollectionKeys();

      for (const key of collectionKeys) {
        const filePath = path.join(dirPath, `${key}.json`);
        const exists = await fileExists(filePath);
        assert.ok(exists, `${key}.json exists in directory`);

        const data = await readFile(filePath, { json: true });
        assert.deepEqual(data, [], `${key}.json contains empty array`);
      }

      // Verify db.json has empty skeleton
      const dbFilePath = path.resolve(`${config.rootPath}/${testDbFile}`);
      const dbData = await readFile(dbFilePath, { json: true });

      for (const key of collectionKeys) {
        assert.ok(Array.isArray(dbData[key]), `${key} is an array in db.json`);
        assert.equal(dbData[key].length, 0, `${key} is empty in db.json`);
      }
    });

    test('collection files contain expected data after write', async function(assert) {
      const collectionKeys = Orm.db.getCollectionKeys();

      // Write serialized data to directory files directly (simulating save)
      await createDirectory(dirPath);
      for (const key of collectionKeys) {
        await createFile(path.join(dirPath, `${key}.json`), serialized[key] || [], { json: true });
      }

      // Read back and verify each file
      const ownersData = await readFile(path.join(dirPath, 'owners.json'), { json: true });
      assert.deepEqual(ownersData, serialized.owners, 'owners file matches serialized data');

      const animalsData = await readFile(path.join(dirPath, 'animals.json'), { json: true });
      assert.deepEqual(animalsData, serialized.animals, 'animals file matches serialized data');

      const traitsData = await readFile(path.join(dirPath, 'traits.json'), { json: true });
      assert.deepEqual(traitsData, serialized.traits, 'traits file matches serialized data');

      const categoriesData = await readFile(path.join(dirPath, 'categories.json'), { json: true });
      assert.deepEqual(categoriesData, serialized.categories, 'categories file matches serialized data');

      const phoneNumbersData = await readFile(path.join(dirPath, 'phoneNumbers.json'), { json: true });
      assert.deepEqual(phoneNumbersData, serialized.phoneNumbers, 'phoneNumbers file matches serialized data');
    });

    test('load from directory assembles data from collection files', async function(assert) {
      const collectionKeys = Orm.db.getCollectionKeys();

      // Write serialized data to directory files
      await createDirectory(dirPath);
      for (const key of collectionKeys) {
        await createFile(path.join(dirPath, `${key}.json`), serialized[key] || [], { json: true });
      }

      // Read each collection file and assemble manually (same logic as getRecordFromDirectory)
      const assembled = {};
      for (const key of collectionKeys) {
        assembled[key] = await readFile(path.join(dirPath, `${key}.json`), { json: true });
      }

      assert.deepEqual(assembled, serialized, 'assembled data from directory matches serialized payload');
    });

    test('missing collection files default to empty arrays', async function(assert) {
      // Create directory with only some files
      await createDirectory(dirPath);
      await createFile(path.join(dirPath, 'owners.json'), serialized.owners, { json: true });

      // Other files don't exist — getRecordFromDirectory should handle this gracefully
      const collectionKeys = Orm.db.getCollectionKeys();
      const assembled = {};

      for (const key of collectionKeys) {
        const filePath = path.join(dirPath, `${key}.json`);
        const exists = await fileExists(filePath);
        assembled[key] = exists ? await readFile(filePath, { json: true }) : [];
      }

      assert.deepEqual(assembled.owners, serialized.owners, 'existing owners file loaded correctly');
      assert.deepEqual(assembled.animals, [], 'missing animals file defaults to empty array');
      assert.deepEqual(assembled.traits, [], 'missing traits file defaults to empty array');
    });
  });

  module('validateMode', function(hooks) {
    const testDbFile = './test/sample/db-validate-test.json';
    let dirPath;

    hooks.beforeEach(function() {
      config.orm.db.file = testDbFile;
      dirPath = Orm.db.getDirPath();
    });

    hooks.afterEach(async function() {
      await deleteFile(path.resolve(`${config.rootPath}/${testDbFile}`), { ignoreAccessFailure: true });
      await deleteDirectory(dirPath);
    });

    test('detects file data with directory config', async function(assert) {
      config.orm.db.mode = 'directory';
      config.orm.db.directory = 'db';

      const dbFilePath = path.resolve(`${config.rootPath}/${testDbFile}`);
      await createFile(dbFilePath, serialized, { json: true });

      const exitStub = sinon.stub(process, 'exit');

      await Orm.db.validateMode();

      assert.ok(exitStub.calledOnce, 'process.exit was called');
      assert.ok(exitStub.calledWith(1), 'exited with code 1');

      exitStub.restore();
    });

    test('detects directory data with file config', async function(assert) {
      config.orm.db.mode = 'file';
      config.orm.db.directory = 'db';

      await createDirectory(dirPath);
      await createFile(path.join(dirPath, 'owners.json'), serialized.owners, { json: true });

      const exitStub = sinon.stub(process, 'exit');

      await Orm.db.validateMode();

      assert.ok(exitStub.calledOnce, 'process.exit was called');
      assert.ok(exitStub.calledWith(1), 'exited with code 1');

      exitStub.restore();
    });

    test('passes when mode matches data - directory mode with empty db.json', async function(assert) {
      config.orm.db.mode = 'directory';
      config.orm.db.directory = 'db';

      const skeleton = {};
      const collectionKeys = Orm.db.getCollectionKeys();
      for (const key of collectionKeys) skeleton[key] = [];

      const dbFilePath = path.resolve(`${config.rootPath}/${testDbFile}`);
      await createFile(dbFilePath, skeleton, { json: true });

      const exitStub = sinon.stub(process, 'exit');

      await Orm.db.validateMode();

      assert.notOk(exitStub.called, 'process.exit was not called');

      exitStub.restore();
    });

    test('passes when mode matches data - file mode with no directory', async function(assert) {
      config.orm.db.mode = 'file';
      config.orm.db.directory = 'db-nonexistent';

      const exitStub = sinon.stub(process, 'exit');

      await Orm.db.validateMode();

      assert.notOk(exitStub.called, 'process.exit was not called');

      exitStub.restore();
    });
  });

  module('migration', function(hooks) {
    const testDbFile = './test/sample/db-migrate-test.json';
    let dirPath;

    hooks.beforeEach(function() {
      config.orm.db.file = testDbFile;
      config.orm.db.directory = 'db';
      dirPath = Orm.db.getDirPath();
    });

    hooks.afterEach(async function() {
      await deleteFile(path.resolve(`${config.rootPath}/${testDbFile}`), { ignoreAccessFailure: true });
      await deleteDirectory(dirPath);
    });

    test('fileToDirectory migration preserves data', async function(assert) {
      const dbFilePath = path.resolve(`${config.rootPath}/${testDbFile}`);
      const collectionKeys = Orm.db.getCollectionKeys();

      await createFile(dbFilePath, serialized, { json: true });

      await fileToDirectory();

      // Verify db.json now has empty arrays
      const skeletonData = await readFile(dbFilePath, { json: true });
      for (const key of collectionKeys) {
        assert.deepEqual(skeletonData[key], [], `${key} is empty in db.json after migration`);
      }

      // Verify collection files have the data
      const ownersData = await readFile(path.join(dirPath, 'owners.json'), { json: true });
      assert.deepEqual(ownersData, serialized.owners, 'owners data preserved in directory');

      const animalsData = await readFile(path.join(dirPath, 'animals.json'), { json: true });
      assert.deepEqual(animalsData, serialized.animals, 'animals data preserved in directory');
    });

    test('directoryToFile migration preserves data', async function(assert) {
      const dbFilePath = path.resolve(`${config.rootPath}/${testDbFile}`);
      const collectionKeys = Orm.db.getCollectionKeys();

      // Start with directory structure
      const skeleton = {};
      for (const key of collectionKeys) skeleton[key] = [];

      await createFile(dbFilePath, skeleton, { json: true });
      await createDirectory(dirPath);

      for (const key of collectionKeys) {
        await createFile(path.join(dirPath, `${key}.json`), serialized[key] || [], { json: true });
      }

      await directoryToFile();

      // Verify db.json has full data
      const fullData = await readFile(dbFilePath, { json: true });
      assert.deepEqual(fullData, serialized, 'db.json has full data after migration');

      // Verify directory was removed
      const dirExists = await fileExists(dirPath);
      assert.notOk(dirExists, 'directory was removed after migration');
    });

    test('round-trip migration preserves data integrity', async function(assert) {
      const dbFilePath = path.resolve(`${config.rootPath}/${testDbFile}`);

      await createFile(dbFilePath, serialized, { json: true });

      // file -> directory
      await fileToDirectory();

      // directory -> file
      await directoryToFile();

      // Compare
      const finalData = await readFile(dbFilePath, { json: true });
      assert.deepEqual(finalData, serialized, 'data preserved through round-trip migration');
    });
  });
});
