import QUnit from 'qunit';
import Orm, { createRecord, store } from '@stonyx/orm';
import { setupIntegrationTests } from 'stonyx/test-helpers';
import payload from '../sample/payload.js';
import { dbKey } from '../../src/db.js';
import { readFile, deleteFile } from '@stonyx/utils/file';
import config from 'stonyx/config';
import fetch from "node-fetch";
import RestServer from '@stonyx/rest-server';

const { module, test } = QUnit;
let endpoint;

// Represents expected DB output after sample schema is populated and formatted
const sampleDataOutput = {
  owners: [
    { id: 'gina', gender: 'female', age: 34, pets: [ 4, 8, 13, 18 ] },
    { id: 'michael', gender: 'male', age: 38, pets: [ 2, 6, 9, 12, 16 ] },
    { id: 'angela', gender: 'female', age: 36, pets: [ 1, 3, 7, 10, 11, 15, 17, 20 ] },
    { id: 'bob', gender: 'male', age: 44, pets: [ 5, 14, 19 ] }
  ],
  animals: [
    { id: 1, type: 1, age: 2, size: 'small', owner: 'angela' },
    { id: 2, type: 1, age: 7, size: 'medium', owner: 'michael' },
    { id: 3, type: 1, age: 5, size: 'medium', owner: 'angela' },
    { id: 4, type: 1, age: 3, size: 'small', owner: 'gina' },
    { id: 5, type: 1, age: 4, size: 'medium', owner: 'bob' },
    { id: 6, type: 3, age: 1, size: 'small', owner: 'michael' },
    { id: 7, type: 3, age: 6, size: 'medium', owner: 'angela' },
    { id: 8, type: 3, age: 8, size: 'large', owner: 'gina' },
    { id: 9, type: 3, age: 8, size: 'medium', owner: 'michael' },
    { id: 10, type: 3, age: 5, size: 'small', owner: 'angela' },
    { id: 11, type: 2, age: 2, size: 'small', owner: 'angela' },
    { id: 12, type: 2, age: 8, size: 'large', owner: 'michael' },
    { id: 13, type: 2, age: 6, size: 'medium', owner: 'gina' },
    { id: 14, type: 2, age: 3, size: 'small', owner: 'bob' },
    { id: 15, type: 2, age: 7, size: 'medium', owner: 'angela' },
    { id: 16, type: 4, age: 5, size: 'medium', owner: 'michael' },
    { id: 17, type: 4, age: 3, size: 'small', owner: 'angela' },
    { id: 18, type: 4, age: 7, size: 'large', owner: 'gina' },
    { id: 19, type: 4, age: 1, size: 'small', owner: 'bob' },
    { id: 20, type: 4, age: 4, size: 'medium', owner: 'angela' }
  ]
};

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
        animals: []
      });
    });
  });

  module('Data', function(hooks) {
    hooks.before(function() {
      for (const owner of payload.owners) createRecord('owner', owner);
      for (const animal of payload.animals) createRecord('animal', animal);
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
      assert.equal(owner2.totalPets, 3);
      assert.equal(animal2.owner.id, owner2.id);
    });

    test('db saves correct serialized data and relationships', async function(assert) {
      await Orm.db.save();
      parsedFileData = await readFile(config.orm.db.file, { json: true });

      assert.deepEqual(parsedFileData, sampleDataOutput);
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
      // Clear the store
      store.remove('owner');
      store.remove('animal');
      store.remove(dbKey);

      assert.notOk(store.get('owner').size);
      assert.notOk(store.get('animal').size);
      assert.notOk(store.get(dbKey).size);

      /**
       * Re-populate entire store from db file data
       * Note: the isDbRecord usage warning is expected
       */
      const dbRecordData = createRecord(dbKey, parsedFileData, { serialize: false, transform: false }).format();
      delete dbRecordData.id; // We compare without the id

      assert.deepEqual(dbRecordData, sampleDataOutput);
      assert.ok(store.get('owner').size);
      assert.ok(store.get('animal').size);
      assert.ok(store.get(dbKey).size);
    });
  });

  module('Rest', function() {
    test('get call for schema records work as expected', async function(assert) {
      const response = await fetch(`${endpoint}/owner`);
      const data = await response.json();

      assert.equal(response.status, 200);
      assert.deepEqual(data.owners.map(data => data.id), [ 'gina', 'michael', 'bob' ], 'excludes angela due to access filter');
    });

    test('get call for specific records work as expected', async function(assert) {
      const response = await fetch(`${endpoint}/owner/gina`);
      const data = await response.json();

      assert.equal(response.status, 200);
      assert.deepEqual(data, { owner: sampleDataOutput.owners[0] });
    });

    test('get call for invalid records return a 404', async function(assert) {
      const response = await fetch(`${endpoint}/owner/rex`);
      
      assert.equal(response.status, 404);
    });

    test('post call for schema records create a new record expected', async function(assert) {
      const newAnimal = { type: 'horse', age: 3, size: 'large', owner: 'bob' };
      const response = await fetch(`${endpoint}/animal`, {
        method: 'post',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newAnimal)
      });

      const data = await response.json();
      const expectedId = 21; // Based on sample data

      assert.equal(store.get('animal', expectedId).tag, `bob's large horse`);
      assert.equal(data.animal.id, expectedId);
    });

    test('patch call for schema records work as expected', async function(assert) {
      const targetId = 12; // Based on michael's large cat from sample data
      const updates = { size: 'small' };

      assert.equal(store.get('animal', targetId).tag, `michael's large cat`);

      const response = await fetch(`${endpoint}/animal/${targetId}`, {
        method: 'patch',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates)
      });

      assert.equal(response.status, 200);
      assert.equal(store.get('animal', targetId).tag, `michael's small cat`);
    });

    test('delete call for schema records work as expected', async function(assert) {
      assert.ok(store.get('animal', 3));

      const response = await fetch(`${endpoint}/animal/3`, { method: 'delete' });

      assert.equal(response.status, 200);
      assert.notOk(store.get('animal', 3));
    });
  });
});
