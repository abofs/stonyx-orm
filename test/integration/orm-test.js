import QUnit from 'qunit';
import Orm, { createRecord, updateRecord, store } from '@stonyx/orm';
import { setupIntegrationTests } from 'stonyx/test-helpers';
import { raw, serialized } from '../sample/payload.js';
import { dbKey } from '../../src/db.js';
import { readFile, deleteFile } from '@stonyx/utils/file';
import config from 'stonyx/config';
import RestServer from '@stonyx/rest-server';

const { module, test } = QUnit;
let endpoint;

//let endpoint;
let parsedFileData;

// Driven by sample requests defined in test/sample-requests
module('[Integration] ORM', function(hooks) {
  setupIntegrationTests(hooks);

  hooks.before(function() {
    endpoint = `http://localhost:${config.restServer.port}`;
  });

  hooks.after(function() {
    RestServer.close();
  });
  
  module('Db', function() {
    test('record is successfully created', async function(assert) {
      assert.ok(store.data.has(dbKey));
    });

    test('file stores expected schema structure', async function(assert) {
      await Orm.db.save();
      const fileData = await readFile(config.orm.db.file, { json: true });

      assert.deepEqual(fileData, {
        owners: [],
        animals: [],
        traits: []
      });
    });

    test('data is retrievable via db record', function(assert) {
      const record = Orm.db.record;

      assert.ok(Array.isArray(record.owners));
      assert.ok(Array.isArray(record.animals));
    });
  });

  module('Data', function(hooks) {
    hooks.before(function() {
      for (const owner of raw.owners) createRecord('owner', owner);
      for (const animal of raw.animals) createRecord('animal', animal);
    });

    hooks.after(function() {
      deleteFile(config.orm.db.file);
    })

    test('data store is populated', function(assert) {
      assert.ok(store.data.has('owner'));
      assert.ok(store.data.has('animal'));
    });

    test('getters are computed as expected', function(assert) {
      const animals = store.get('animal');

      assert.equal(animals.get(4).tag, `gina's small dog`);
      assert.equal(animals.get(8).tag, `gina's large goat`);
      assert.equal(animals.get(12).tag, `michael's large cat`);
      assert.equal(animals.get(16).tag, `michael's medium horse`);
      assert.equal(animals.get(20).tag, `angela's medium horse`);
    });

    test('relationships are established correctly', function(assert) {
      const owner1 = store.get('owner', 'angela');
      const animal1 = store.get('animal', 1);
      const owner2 = store.get('owner', 'bob');
      const animal2 = store.get('animal', 14);

      assert.equal(owner1.totalPets, 8);
      assert.equal(animal1.owner.id, owner1.id);
      assert.equal(animal1.traits[1].type, 'color');
      assert.equal(animal1.traits[1].value, 'black');
      assert.equal(owner2.totalPets, 3);
      assert.equal(animal2.owner.id, owner2.id);
      assert.equal(animal2.traits[0].type, 'habitat');
      assert.equal(animal2.traits[0].value, 'farm');
    });

    test('updating a record from raw data works as expected', function(assert) {
      const animal = store.get('animal', 5);

      assert.equal(animal.tag, `bob's medium dog`);

      updateRecord(animal, { details: { c: 'small', x: 'green' }});

      assert.equal(animal.tag, `bob's small dog`);

      // Revert change
      animal.size = 'medium';
    });

    test('db saves correct serialized data and relationships', async function(assert) {
      await Orm.db.save();
      parsedFileData = await readFile(config.orm.db.file, { json: true });

      assert.deepEqual(parsedFileData, serialized);
    });

    test('unloading individual store records works as expected', async function(assert) {
      assert.ok(store.get('animal', 10));
      assert.ok(store.get('animal', 11));

      store.remove('animal', 10);

      assert.notOk(store.get('animal', 10));
      assert.ok(store.get('animal', 11));
    });

    // Note: This test relies on the one above to prevent re-assigning parsedFileData
    test('removing records and recreating them from db storage returns the same record output', async function(assert) {
      store.unloadAllRecords(dbKey, { includeChildren: true });

      assert.notOk(store.get('owner').size);
      assert.notOk(store.get('animal').size);
      assert.notOk(store.get('trait').size);
      assert.notOk(store.get(dbKey).size);

      /**
       * Re-populate entire store from db file data
       * Note: the isDbRecord usage warning is expected
       */
      const dbRecordData = createRecord(dbKey, parsedFileData, { serialize: false, transform: false }).format();
      delete dbRecordData.id; // We compare without the id

      assert.ok(store.get('owner').size);
      assert.ok(store.get('animal').size);
      assert.ok(store.get('trait').size);
      assert.ok(store.get(dbKey).size);

      assert.deepEqual(dbRecordData, serialized);
    });

    test.skip('Creating a record with a pending relationship works as expected', function(assert) {
      // Note: pets reference animals that do not yet exist
      const record = createRecord('owner', { name: 'testOwner', pets: [ 5000, 5001 ] });

      assert.equal(record.id, 'testOwner');
      assert.notOk(record.pets.length);

      const animal = createRecord('animal', { id: 5000, type: 'dog' });

      assert.equal(record.pets.length, 1);
      assert.equal(record.pets[0].id, 5000);

      store.remove('owner', 'testOwner');
      store.remove('animal', 5000);
    });

    test.skip('Computed properties are available in JSON output as expected', function(assert) {
      const animal = store.get('animal', 2).toJSON();

      assert.equal(animal.attributes.tag, `michael's medium dog`);
    });
  });

  module('JSON API', function() {
    test('get call for schema records work as expected', async function(assert) {
      const response = await fetch(`${endpoint}/owners`);
      const { data } = await response.json();

      assert.equal(response.status, 200);
      assert.equal(data.length, 3, 'excludes angela due to access filter');
      assert.deepEqual(data.map(record => record.id), [ 'gina', 'michael', 'bob' ]);

      // Verify JSON-API structure
      const firstRecord = data[0];
      assert.equal(firstRecord.type, 'owner');
      assert.ok(firstRecord.attributes);
      assert.ok(firstRecord.relationships);
      assert.equal(firstRecord.id, 'gina');
    });

    test('get call for specific records work as expected', async function(assert) {
      const response = await fetch(`${endpoint}/owners/gina`);
      const { data } = await response.json();

      assert.equal(response.status, 200);

      // Verify JSON-API structure
      assert.equal(data.type, 'owner');
      assert.equal(data.id, 'gina');
      assert.ok(data.attributes);
      assert.ok(data.relationships);

      // Verify attributes
      assert.equal(data.attributes.gender, 'female');
      assert.equal(data.attributes.age, 34);
    });

    test('get call for invalid records return a 404', async function(assert) {
      const response = await fetch(`${endpoint}/owners/rex`);
      
      assert.equal(response.status, 404);
    });

    test('post call for schema records create a new record expected', async function(assert) {
      const newAnimal = {
        data: {
          type: 'animal',
          attributes: { type: 'horse', age: 3, size: 'large', owner: 'bob' }
        }
      };
      const response = await fetch(`${endpoint}/animals`, {
        method: 'post',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newAnimal)
      });

      const { data } = await response.json();
      const expectedId = 21; // Based on sample data

      assert.equal(response.status, 200);
      assert.equal(store.get('animal', expectedId).tag, `bob's large horse`);

      // Verify JSON-API response structure
      assert.equal(data.type, 'animal');
      assert.equal(data.id, expectedId);
      assert.ok(data.attributes);
    });

    test('patch call for schema records work as expected', async function(assert) {
      const targetId = 12; // Based on michael's large cat from sample data
      const updates = {
        data: {
          type: 'animal',
          id: targetId,
          attributes: { size: 'small' }
        }
      };

      assert.equal(store.get('animal', targetId).tag, `michael's large cat`);

      const response = await fetch(`${endpoint}/animals/${targetId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates)
      });

      const { data } = await response.json();

      assert.equal(response.status, 200);
      assert.equal(store.get('animal', targetId).tag, `michael's small cat`);

      // Verify JSON-API response structure
      assert.equal(data.type, 'animal');
      assert.equal(data.id, targetId);
      assert.equal(data.attributes.size, 'small');
    });

    test('delete call for schema records work as expected', async function(assert) {
      assert.ok(store.get('animal', 3));

      const response = await fetch(`${endpoint}/animals/3`, { method: 'delete' });

      assert.equal(response.status, 200);
      assert.notOk(store.get('animal', 3));
    });
  });
});
