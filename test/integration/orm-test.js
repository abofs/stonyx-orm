import QUnit from 'qunit';
import Orm, { createRecord, updateRecord, store } from '@stonyx/orm';
import Cron from '@stonyx/cron';
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
        traits: [],
        categories: [],
        userProfiles: []
      });
    });

    test('data is retrievable via db record', function(assert) {
      const record = Orm.db.record;

      assert.ok(Array.isArray(record.owners));
      assert.ok(Array.isArray(record.animals));
    });

    test('autosave is not registered when disabled', function(assert) {
      // Default config has autosave disabled
      const cron = new Cron();
      const saveJob = cron.jobs['save'];

      assert.notOk(saveJob, 'save cron job is not registered when autosave is disabled');
    });

    test('autosave triggers db.save() at configured interval', async function(assert) {
      const cron = new Cron();

      // Track save calls
      let saveCallCount = 0;
      const originalSave = Orm.db.save.bind(Orm.db);
      Orm.db.save = async function() {
        saveCallCount++;
        return originalSave();
      };

      // Register autosave with a very short interval (1 second)
      const saveInterval = 1;
      cron.register('save', Orm.db.save.bind(Orm.db), saveInterval);

      assert.ok(cron.jobs['save'], 'save cron job is registered');
      assert.equal(cron.jobs['save'].interval, saveInterval, 'uses configured saveInterval');

      // Wait for the cron job to trigger (interval + buffer)
      await new Promise(resolve => setTimeout(resolve, 1500));

      assert.ok(saveCallCount >= 1, `autosave triggered db.save() (called ${saveCallCount} times)`);

      // Cleanup
      cron.unregister('save');
      Orm.db.save = originalSave;
    });
  });

  module('Data', function(hooks) {
    hooks.before(function() {
      // Create categories first so traits can reference them
      for (const category of serialized.categories) {
        createRecord('category', category);
      }

      // Create user-profiles
      for (const profile of serialized.userProfiles) {
        createRecord('user-profile', profile);
      }

      // Use original raw data approach (goes through serializers)
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

    test('creating a record with a pending relationship works as expected', function(assert) {
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

    test('computed properties are available in JSON output as expected', function(assert) {
      const animal = store.get('animal', 2).toJSON();

      assert.equal(animal.attributes.tag, `michael's medium dog`);
    });
  });

  module('JSON API', function(hooks) {
    hooks.before(function() {
      // Create categories for trait->category relationship testing
      for (const category of serialized.categories) {
        createRecord('category', category);
      }
    });

    test('get call for schema records work as expected', async function(assert) {
      const response = await fetch(`${endpoint}/owners`);
      const { data } = await response.json();

      assert.equal(response.status, 200);
      assert.equal(data.length, 3, 'excludes angela due to access filter');
      assert.deepEqual(data.map(record => record.id), [ 'gina', 'michael', 'bob' ]);

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

      assert.equal(data.type, 'owner');
      assert.equal(data.id, 'gina');
      assert.ok(data.attributes);
      assert.ok(data.relationships);
      assert.equal(data.attributes.gender, 'female');
      assert.equal(data.attributes.age, 34);
    });

    test('get call for invalid records return a 404', async function(assert) {
      const response = await fetch(`${endpoint}/owners/rex`);

      assert.equal(response.status, 404);
    });

    test('dasherized model names are correctly pluralized in routes', async function(assert) {
      // Create test user-profile records
      createRecord('user-profile', { id: 1, name: 'John Doe', email: 'john@example.com' });
      createRecord('user-profile', { id: 2, name: 'Jane Smith', email: 'jane@example.com' });

      // Test collection route - should be /user-profiles (not /user-profile)
      const collectionResponse = await fetch(`${endpoint}/user-profiles`);
      const { data: collection } = await collectionResponse.json();

      assert.equal(collectionResponse.status, 200, 'collection route responds successfully');
      assert.equal(collection.length, 2, 'returns both user-profile records');
      assert.equal(collection[0].type, 'user-profile', 'type is user-profile');
      assert.equal(collection[0].attributes.name, 'John Doe');

      // Test individual record route - should be /user-profiles/:id
      const individualResponse = await fetch(`${endpoint}/user-profiles/1`);
      const { data: individual } = await individualResponse.json();

      assert.equal(individualResponse.status, 200, 'individual route responds successfully');
      assert.equal(individual.id, 1);
      assert.equal(individual.type, 'user-profile');
      assert.equal(individual.attributes.email, 'john@example.com');

      // Cleanup
      store.remove('user-profile', 1);
      store.remove('user-profile', 2);
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
      assert.equal(data.type, 'animal');
      assert.equal(data.id, expectedId);
      assert.ok(data.attributes);
    });

    test('post call with fields parameter returns only specified fields', async function(assert) {
      const newAnimal = {
        data: {
          type: 'animal',
          attributes: { type: 'cat', age: 2, size: 'small', owner: 'gina' }
        }
      };
      const response = await fetch(`${endpoint}/animals?fields[animals]=type,age`, {
        method: 'post',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newAnimal)
      });

      const { data } = await response.json();

      assert.equal(response.status, 200);
      assert.equal(data.type, 'animal');
      assert.ok(data.id);

      // Should only include requested fields
      assert.ok('type' in data.attributes, 'type field is present');
      assert.ok('age' in data.attributes, 'age field is present');

      // Should NOT include other fields
      assert.notOk('size' in data.attributes, 'size field is excluded');
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

    test('deleted record is not accessible via GET', async function(assert) {
      const targetId = 4;

      // Verify record exists
      const getBeforeResponse = await fetch(`${endpoint}/animals/${targetId}`);
      assert.equal(getBeforeResponse.status, 200, 'record exists before delete');

      // Delete the record
      const deleteResponse = await fetch(`${endpoint}/animals/${targetId}`, { method: 'DELETE' });
      assert.equal(deleteResponse.status, 200, 'delete returns 200');

      // Verify GET returns 404 after deletion
      const getAfterResponse = await fetch(`${endpoint}/animals/${targetId}`);
      assert.equal(getAfterResponse.status, 404, 'GET returns 404 after delete');
    });

    test('get call with include parameter sideloads relationships', async function(assert) {
      const response = await fetch(`${endpoint}/animals/1?include=owner,traits`);
      const { data, included } = await response.json();

      assert.equal(response.status, 200);
      assert.ok(included, 'included array exists');
      assert.equal(included.length, 3, 'includes owner + 2 traits');

      // Verify owner is included with full attributes
      const owner = included.find(r => r.type === 'owner' && r.id === 'angela');
      assert.ok(owner, 'owner is included');
      assert.equal(owner.attributes.age, 36);
      assert.ok(owner.relationships, 'included records have relationships');

      // Verify traits are included
      const trait1 = included.find(r => r.type === 'trait' && r.id === 1);
      const trait2 = included.find(r => r.type === 'trait' && r.id === 2);
      assert.ok(trait1, 'trait 1 is included');
      assert.ok(trait2, 'trait 2 is included');
      assert.equal(trait1.attributes.type, 'habitat');
      assert.equal(trait2.attributes.type, 'color');
    });

    test('get collection with include parameter deduplicates relationships', async function(assert) {
      const response = await fetch(`${endpoint}/animals?include=owner`);
      const { data, included } = await response.json();

      assert.equal(response.status, 200);
      assert.ok(included, 'included array exists');

      // Multiple animals share owners, should deduplicate
      const ownerIds = included.filter(r => r.type === 'owner').map(r => r.id);
      const uniqueOwners = new Set(ownerIds);
      assert.equal(ownerIds.length, uniqueOwners.size, 'no duplicate owners');
      assert.ok(uniqueOwners.size <= 4, 'at most 4 unique owners');
    });

    test('request without include parameter works as before (backward compatibility)', async function(assert) {
      const response = await fetch(`${endpoint}/animals/1`);
      const result = await response.json();

      assert.equal(response.status, 200);
      assert.ok(result.data, 'has data');
      assert.notOk(result.included, 'no included array when not requested');
      assert.ok(result.data.relationships, 'relationships still present as references');
    });

    test('invalid relationship in include parameter is ignored', async function(assert) {
      const response = await fetch(`${endpoint}/animals/1?include=owner,invalidRel,traits`);
      const { data, included } = await response.json();

      assert.equal(response.status, 200);
      assert.ok(included, 'included array exists despite invalid relationship');

      // Should include valid relationships only
      const hasOwner = included.some(r => r.type === 'owner');
      const hasTraits = included.some(r => r.type === 'trait');
      assert.ok(hasOwner, 'valid owner relationship included');
      assert.ok(hasTraits, 'valid traits relationship included');
    });

    test('post call with existing id returns 409 conflict', async function(assert) {
      // First, create a record with a specific id
      const firstAnimal = {
        data: {
          type: 'animal',
          attributes: { id: 9999, type: 'dog', age: 2, size: 'small', owner: 'bob' }
        }
      };
      const firstResponse = await fetch(`${endpoint}/animals`, {
        method: 'post',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(firstAnimal)
      });

      assert.equal(firstResponse.status, 200, 'first creation succeeds');

      // Attempt to create another record with the same id
      const duplicateAnimal = {
        data: {
          type: 'animal',
          attributes: { id: 9999, type: 'cat', age: 5, size: 'large', owner: 'gina' }
        }
      };
      const duplicateResponse = await fetch(`${endpoint}/animals`, {
        method: 'post',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(duplicateAnimal)
      });

      assert.equal(duplicateResponse.status, 409, 'duplicate id returns 409 conflict');

      // Cleanup
      store.remove('animal', 9999);
    });

    test('post call without id increments from last record id', async function(assert) {
      // Get the current last trait ID to avoid conflicts
      const traitStore = store.get('trait');
      const existingIds = Array.from(traitStore.keys());
      const lastExistingId = Math.max(...existingIds);
      const testId = lastExistingId + 1;

      // Create a record with an id after the last existing one
      const firstTrait = {
        data: {
          type: 'trait',
          id: testId
        }
      };

      const firstResponse = await fetch(`${endpoint}/traits`, {
        method: 'post',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(firstTrait)
      });

      assert.equal(firstResponse.status, 200, 'first record created');

      // Now create a record without an id - should be last id + 1
      const secondTrait = {
        data: {
          type: 'trait'
        }
      };

      const secondResponse = await fetch(`${endpoint}/traits`, {
        method: 'post',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(secondTrait)
      });

      assert.equal(secondResponse.status, 200, 'second record created');

      const { data } = await secondResponse.json();
      assert.equal(data.id, testId + 1, 'auto-generated id increments from last record');

      // Cleanup
      store.remove('trait', testId);
      store.remove('trait', testId + 1);
    });

    test('post call without type returns 400 bad request', async function(assert) {
      const noTypePayload = {
        data: {
          id: 7777,
          attributes: { age: 2 }
        }
      };

      const response = await fetch(`${endpoint}/animals`, {
        method: 'post',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(noTypePayload)
      });

      assert.equal(response.status, 400, 'missing type returns 400 bad request');
    });

    test('empty relationships do not appear in included array', async function(assert) {
      // Create animal with no traits relationship
      const newAnimal = {
        data: {
          type: 'animal',
          attributes: { type: 'horse', age: 3, size: 'large', owner: 'bob' }
        }
      };

      const createResponse = await fetch(`${endpoint}/animals`, {
        method: 'post',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newAnimal)
      });

      const { data: created } = await createResponse.json();
      const response = await fetch(`${endpoint}/animals/${created.id}?include=traits,owner`);
      const { data, included } = await response.json();

      assert.equal(response.status, 200);

      // Should only include owner (which exists), not empty traits
      const ownerIncluded = included.some(r => r.type === 'owner');
      assert.ok(ownerIncluded, 'owner is included');

      assert.ok(Array.isArray(included), 'included is array');
    });

    test('get call with nested include parameter sideloads deep relationships', async function(assert) {
      // Request animal with owner AND owner's pets (nested)
      const response = await fetch(`${endpoint}/animals/1?include=owner,owner.pets`);
      const { included } = await response.json();

      assert.equal(response.status, 200);
      assert.ok(included, 'included array exists');

      // Should include: owner + all of owner's pets (other animals)
      const owner = included.find(r => r.type === 'owner' && r.id === 'angela');
      assert.ok(owner, 'owner is included');

      // Angela owns multiple animals, those should be in included
      const angelaPets = included.filter(r => r.type === 'animal' && r.relationships.owner?.data?.id === 'angela');
      assert.ok(angelaPets.length > 1, 'owner pets are included via nested relationship');
    });

    test('get call with deeply nested include parameter (3 levels)', async function(assert) {
      // Test 2-level depth with collection endpoint: owners -> pets -> traits
      const response = await fetch(`${endpoint}/owners?include=pets.traits`);
      const { data, included } = await response.json();

      assert.equal(response.status, 200);
      assert.ok(included, 'included array exists');

      // Should include all pets and all traits of those pets
      const pets = included.filter(r => r.type === 'animal');
      const traits = included.filter(r => r.type === 'trait');

      assert.ok(pets.length > 0, 'pets are included');
      assert.ok(traits.length > 0, 'traits of pets are included via nested traversal');
    });

    test('nested includes handle null relationships gracefully', async function(assert) {
      // Create an animal without traits
      const createResponse = await fetch(`${endpoint}/animals`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data: { type: 'animal', id: 999, attributes: { type: 1, age: 1, size: 'tiny', owner: 'bob' } } })
      });

      const { data: created } = await createResponse.json();

      // Try to include traits.metadata (traits doesn't exist, metadata doesn't exist)
      const response = await fetch(`${endpoint}/animals/${created.id}?include=traits,traits.metadata`);
      const { data } = await response.json();

      assert.equal(response.status, 200);
      // Should not crash even if traits.metadata doesn't exist

      // Cleanup
      store.remove('animal', 999);
    });

    test('get call with fields parameter returns only specified fields', async function(assert) {
      const response = await fetch(`${endpoint}/animals/1?fields[animals]=type,age`);
      const { data } = await response.json();

      assert.equal(response.status, 200);
      assert.equal(data.type, 'animal');
      assert.equal(data.id, 1);

      // Should only include requested fields
      assert.ok('type' in data.attributes, 'type field is present');
      assert.ok('age' in data.attributes, 'age field is present');

      // Should NOT include other fields
      assert.notOk('size' in data.attributes, 'size field is excluded');
      assert.notOk('owner' in data.attributes, 'owner field is excluded');
    });

    test('get call with fields parameter filters both attributes and relationships', async function(assert) {
      // Per JSON:API spec, fields includes both attributes and relationships
      const response = await fetch(`${endpoint}/animals/1?fields[animals]=type,age,owner`);
      const { data } = await response.json();

      assert.equal(response.status, 200);
      assert.equal(data.type, 'animal');
      assert.equal(data.id, 1);

      // Should include specified attributes
      assert.ok('type' in data.attributes, 'type attribute is present');
      assert.ok('age' in data.attributes, 'age attribute is present');
      assert.notOk('size' in data.attributes, 'size attribute is excluded');

      // Should include specified relationship
      assert.ok('owner' in data.relationships, 'owner relationship is present');

      // Should NOT include other relationships
      assert.notOk('traits' in data.relationships, 'traits relationship is excluded');
    });

    test('get collection with fields parameter returns only specified fields', async function(assert) {
      const response = await fetch(`${endpoint}/animals?fields[animals]=type,size`);
      const { data } = await response.json();

      assert.equal(response.status, 200);
      assert.ok(data.length > 0, 'returns animals');

      // Check each record has only the requested fields
      for (const record of data) {
        assert.ok('type' in record.attributes, 'type field is present');
        assert.ok('size' in record.attributes, 'size field is present');
        assert.notOk('age' in record.attributes, 'age field is excluded');
      }
    });

    test('get with filter on relationship field works as expected', async function(assert) {
      // Filter animals by owner id (owner model uses id as identifier)
      const response = await fetch(`${endpoint}/animals?filter[owner.id]=gina`);
      const { data } = await response.json();

      assert.equal(response.status, 200);
      assert.ok(data.length > 0, 'returns filtered animals');

      // All returned animals should belong to gina
      for (const record of data) {
        assert.equal(record.relationships.owner.data.id, 'gina', 'animal belongs to gina');
      }
    });

    test('get with filter on direct field works as expected', async function(assert) {
      // Note: type uses 'animal' transform which converts 'dog' to 1
      const response = await fetch(`${endpoint}/animals?filter[type]=1`);
      const { data } = await response.json();

      assert.equal(response.status, 200);
      assert.ok(data.length > 0, 'returns filtered animals');

      // All returned animals should be dogs (type=1)
      for (const record of data) {
        assert.equal(record.attributes.type, 1, 'animal is a dog');
      }
    });

    test('get with combined fields and filter parameters', async function(assert) {
      const response = await fetch(`${endpoint}/animals?fields[animals]=type,age&filter[size]=large`);
      const { data } = await response.json();

      assert.equal(response.status, 200);
      assert.ok(data.length > 0, 'returns filtered animals');

      for (const record of data) {
        // Check sparse fieldsets are applied
        assert.ok('type' in record.attributes, 'type field is present');
        assert.ok('age' in record.attributes, 'age field is present');
        assert.notOk('size' in record.attributes, 'size field is excluded from attributes');
      }
    });

    test('verify trait->category relationships are established in store', function(assert) {
      // Verify that traits have their category relationships populated
      const trait1 = store.get('trait', 1);
      const trait2 = store.get('trait', 2);
      const trait3 = store.get('trait', 3);

      assert.ok(trait1, 'trait 1 exists');
      assert.ok(trait2, 'trait 2 exists');
      assert.ok(trait3, 'trait 3 exists');

      assert.ok(trait1.category, 'trait 1 has category relationship');
      assert.ok(trait2.category, 'trait 2 has category relationship');
      assert.ok(trait3.category, 'trait 3 has category relationship');

      assert.equal(trait1.category.id, 'physical', 'trait 1 category is physical');
      assert.equal(trait2.category.id, 'appearance', 'trait 2 category is appearance');
      assert.equal(trait3.category.id, 'appearance', 'trait 3 category is appearance');
    });

    test('get call with 3-level hasMany->hasMany->belongsTo nested includes', async function(assert) {
      // This tests the specific pattern: owners -> pets (hasMany) -> traits (hasMany) -> category (belongsTo)
      // This mimics the this-is-it pattern: scene -> slides -> dialogue -> character
      const response = await fetch(`${endpoint}/owners?include=pets.traits.category`);
      const { data, included } = await response.json();

      assert.equal(response.status, 200);
      assert.ok(included, 'included array exists');

      // Should include pets, traits, and categories
      const pets = included.filter(r => r.type === 'animal');
      const traits = included.filter(r => r.type === 'trait');
      const categories = included.filter(r => r.type === 'category');

      assert.ok(pets.length > 0, 'pets are included via first level nesting');
      assert.ok(traits.length > 0, 'traits are included via second level nesting');
      assert.ok(categories.length > 0, 'categories are included via third level nesting (belongsTo from trait)');
    });
  });

  /**
   * JSON API Relationship Routes
   *
   * Per JSON API spec, these routes should be automatically available based on model relationships:
   * - GET /{type}/{id}/{relationship} - Returns the related resource(s)
   * - GET /{type}/{id}/relationships/{relationship} - Returns relationship linkage data only
   */
  module('JSON API Relationship Routes', function(hooks) {
    hooks.before(function() {
      // Ensure test data exists
      for (const category of serialized.categories) {
        if (!store.get('category', category.id)) {
          createRecord('category', category);
        }
      }
      for (const owner of raw.owners) {
        if (!store.get('owner', owner.name)) {
          createRecord('owner', owner);
        }
      }
      for (const animal of raw.animals) {
        if (!store.get('animal', animal.id)) {
          createRecord('animal', animal);
        }
      }
    });

    // ==========================================
    // Related Resource Routes: GET /{type}/{id}/{relationship}
    // These return the actual related records
    // ==========================================

    module('Related Resource Routes', function() {
      // Owner -> pets (hasMany)
      test('GET /owners/:id/pets returns related animals', async function(assert) {
        const response = await fetch(`${endpoint}/owners/angela/pets`);
        const { data } = await response.json();

        assert.equal(response.status, 200, 'returns 200 status');
        assert.ok(Array.isArray(data), 'data is an array for hasMany');
        assert.ok(data.length > 0, 'returns related pets');
        assert.ok(data.every(record => record.type === 'animal'), 'all records are animals');
      });

      test('GET /owners/:id/pets returns empty array when no related records', async function(assert) {
        // Create owner with no pets
        createRecord('owner', { name: 'lonely', gender: 'male', age: 50 });

        const response = await fetch(`${endpoint}/owners/lonely/pets`);
        const { data } = await response.json();

        assert.equal(response.status, 200, 'returns 200 status');
        assert.ok(Array.isArray(data), 'data is an array');
        assert.equal(data.length, 0, 'returns empty array');

        store.remove('owner', 'lonely');
      });

      test('GET /owners/:id/pets returns 404 for non-existent owner', async function(assert) {
        const response = await fetch(`${endpoint}/owners/nonexistent/pets`);

        assert.equal(response.status, 404, 'returns 404 for non-existent parent');
      });

      // Animal -> owner (belongsTo)
      test('GET /animals/:id/owner returns related owner', async function(assert) {
        const response = await fetch(`${endpoint}/animals/1/owner`);
        const { data } = await response.json();

        assert.equal(response.status, 200, 'returns 200 status');
        assert.notOk(Array.isArray(data), 'data is not an array for belongsTo');
        assert.equal(data.type, 'owner', 'returns owner record');
        assert.equal(data.id, 'angela', 'returns correct owner');
      });

      test('GET /animals/:id/owner returns null when no related record', async function(assert) {
        // Create animal with no owner
        createRecord('animal', { id: 9000, type: 'dog', age: 1, size: 'small' });

        const response = await fetch(`${endpoint}/animals/9000/owner`);
        const { data } = await response.json();

        assert.equal(response.status, 200, 'returns 200 status');
        assert.equal(data, null, 'returns null for missing belongsTo');

        store.remove('animal', 9000);
      });

      test('GET /animals/:id/owner returns 404 for non-existent animal', async function(assert) {
        const response = await fetch(`${endpoint}/animals/99999/owner`);

        assert.equal(response.status, 404, 'returns 404 for non-existent parent');
      });

      // Animal -> traits (hasMany)
      test('GET /animals/:id/traits returns related traits', async function(assert) {
        const response = await fetch(`${endpoint}/animals/1/traits`);
        const { data } = await response.json();

        assert.equal(response.status, 200, 'returns 200 status');
        assert.ok(Array.isArray(data), 'data is an array for hasMany');
        assert.ok(data.length > 0, 'returns related traits');
        assert.ok(data.every(record => record.type === 'trait'), 'all records are traits');
      });

      // Trait -> category (belongsTo)
      test('GET /traits/:id/category returns related category', async function(assert) {
        const response = await fetch(`${endpoint}/traits/1/category`);
        const { data } = await response.json();

        assert.equal(response.status, 200, 'returns 200 status');
        assert.notOk(Array.isArray(data), 'data is not an array for belongsTo');
        assert.equal(data.type, 'category', 'returns category record');
      });

      // Owner -> testModels (camelCase property should generate dasherized route)
      // Model has: testModels = hasMany('test-model')
      // Expected route: /owners/:id/test-models (dasherized)
      test('GET /owners/:id/test-models works when model property is camelCase testModels', async function(assert) {
        // Create test-model record tied to existing owner
        createRecord('test-model', { id: 'tm-1', label: 'primary', owner: 'gina' });

        // Request using dasherized route (JSON:API convention)
        const response = await fetch(`${endpoint}/owners/gina/test-models`);
        const { data } = await response.json();

        assert.equal(response.status, 200, 'dasherized route /test-models should work for camelCase property testModels');
        assert.ok(Array.isArray(data), 'data is an array for hasMany');
        assert.ok(data.length > 0, 'returns related test-models');
        assert.equal(data[0].type, 'test-model', 'record type is test-model');
        assert.equal(data[0].id, 'tm-1', 'record id matches created record');

        // Cleanup
        store.remove('test-model', 'tm-1');
      });
    });

    // ==========================================
    // Relationship Linkage Routes: GET /{type}/{id}/relationships/{relationship}
    // These return only the relationship linkage (type + id), not full records
    // ==========================================

    module('Relationship Linkage Routes', function() {
      // Owner -> pets (hasMany)
      test('GET /owners/:id/relationships/pets returns relationship linkage', async function(assert) {
        const response = await fetch(`${endpoint}/owners/angela/relationships/pets`);
        const { data } = await response.json();

        assert.equal(response.status, 200, 'returns 200 status');
        assert.ok(Array.isArray(data), 'data is an array for hasMany');
        assert.ok(data.length > 0, 'returns relationship linkage');
        assert.ok(data.every(item => item.type && item.id), 'each item has type and id');
        assert.ok(data.every(item => item.type === 'animal'), 'all items reference animals');
        assert.notOk(data[0].attributes, 'linkage does not include attributes');
      });

      test('GET /owners/:id/relationships/pets returns 404 for non-existent owner', async function(assert) {
        const response = await fetch(`${endpoint}/owners/nonexistent/relationships/pets`);

        assert.equal(response.status, 404, 'returns 404 for non-existent parent');
      });

      // Animal -> owner (belongsTo)
      test('GET /animals/:id/relationships/owner returns relationship linkage', async function(assert) {
        const response = await fetch(`${endpoint}/animals/1/relationships/owner`);
        const { data } = await response.json();

        assert.equal(response.status, 200, 'returns 200 status');
        assert.notOk(Array.isArray(data), 'data is not an array for belongsTo');
        assert.equal(data.type, 'owner', 'linkage references owner type');
        assert.equal(data.id, 'angela', 'linkage has correct id');
        assert.notOk(data.attributes, 'linkage does not include attributes');
      });

      test('GET /animals/:id/relationships/owner returns null when no relationship', async function(assert) {
        createRecord('animal', { id: 9001, type: 'cat', age: 2, size: 'medium' });

        const response = await fetch(`${endpoint}/animals/9001/relationships/owner`);
        const { data } = await response.json();

        assert.equal(response.status, 200, 'returns 200 status');
        assert.equal(data, null, 'returns null for missing belongsTo');

        store.remove('animal', 9001);
      });

      // Animal -> traits (hasMany)
      test('GET /animals/:id/relationships/traits returns relationship linkage', async function(assert) {
        const response = await fetch(`${endpoint}/animals/1/relationships/traits`);
        const { data } = await response.json();

        assert.equal(response.status, 200, 'returns 200 status');
        assert.ok(Array.isArray(data), 'data is an array for hasMany');
        assert.ok(data.length > 0, 'returns relationship linkage');
        assert.ok(data.every(item => item.type === 'trait'), 'all items reference traits');
      });

      // Trait -> category (belongsTo)
      test('GET /traits/:id/relationships/category returns relationship linkage', async function(assert) {
        const response = await fetch(`${endpoint}/traits/1/relationships/category`);
        const { data } = await response.json();

        assert.equal(response.status, 200, 'returns 200 status');
        assert.notOk(Array.isArray(data), 'data is not an array for belongsTo');
        assert.equal(data.type, 'category', 'linkage references category type');
        assert.notOk(data.attributes, 'linkage does not include attributes');
      });

      // Invalid relationship name
      test('GET /{type}/:id/relationships/{invalid} returns 404', async function(assert) {
        const response = await fetch(`${endpoint}/owners/angela/relationships/invalid`);

        assert.equal(response.status, 404, 'returns 404 for invalid relationship name');
      });

      test('GET /{type}/:id/{invalid} returns 404 for invalid relationship', async function(assert) {
        const response = await fetch(`${endpoint}/owners/angela/invalid`);

        assert.equal(response.status, 404, 'returns 404 for invalid relationship name');
      });
    });
  });

  /**
   * JSON API Links
   *
   * Per JSON API spec, responses should include a `links` object:
   * - Top-level `links.self` - URL that generated the response
   * - Resource `links.self` - URL to the resource
   * - Relationship `links.self` - URL to the relationship itself
   * - Relationship `links.related` - URL to the related resource(s)
   */
  module('JSON API Links', function() {
    // ==========================================
    // Top-level Links
    // ==========================================

    module('Top-level Links', function() {
      test('GET collection response includes links.self', async function(assert) {
        const response = await fetch(`${endpoint}/animals`);
        const json = await response.json();

        assert.ok(json.links, 'response has links object');
        assert.ok(json.links.self, 'links has self property');
        assert.ok(json.links.self.includes('/animals'), 'self link points to collection');
      });

      test('GET single resource response includes links.self', async function(assert) {
        const response = await fetch(`${endpoint}/animals/1`);
        const json = await response.json();

        assert.ok(json.links, 'response has links object');
        assert.ok(json.links.self, 'links has self property');
        assert.ok(json.links.self.includes('/animals/1'), 'self link points to resource');
      });

      test('GET related resource response includes links.self', async function(assert) {
        const response = await fetch(`${endpoint}/animals/1/owner`);
        const json = await response.json();

        assert.ok(json.links, 'response has links object');
        assert.ok(json.links.self, 'links has self property');
        assert.ok(json.links.self.includes('/animals/1/owner'), 'self link points to related resource URL');
      });

      test('GET relationship linkage response includes links.self and links.related', async function(assert) {
        const response = await fetch(`${endpoint}/animals/1/relationships/owner`);
        const json = await response.json();

        assert.ok(json.links, 'response has links object');
        assert.ok(json.links.self, 'links has self property');
        assert.ok(json.links.self.includes('/animals/1/relationships/owner'), 'self link points to relationship URL');
        assert.ok(json.links.related, 'links has related property');
        assert.ok(json.links.related.includes('/animals/1/owner'), 'related link points to related resource URL');
      });
    });

    // ==========================================
    // Resource Links
    // ==========================================

    module('Resource Links', function() {
      test('individual resource in collection includes links.self', async function(assert) {
        const response = await fetch(`${endpoint}/animals`);
        const { data } = await response.json();

        assert.ok(data.length > 0, 'has resources');
        const resource = data[0];
        assert.ok(resource.links, 'resource has links object');
        assert.ok(resource.links.self, 'resource has links.self');
        assert.ok(resource.links.self.includes(`/animals/${resource.id}`), 'self link points to resource URL');
      });

      test('single resource response data includes links.self', async function(assert) {
        const response = await fetch(`${endpoint}/animals/1`);
        const { data } = await response.json();

        assert.ok(data.links, 'resource has links object');
        assert.ok(data.links.self, 'resource has links.self');
        assert.ok(data.links.self.includes('/animals/1'), 'self link points to resource URL');
      });

      test('included resources have links.self', async function(assert) {
        const response = await fetch(`${endpoint}/animals/1?include=owner`);
        const { included } = await response.json();

        assert.ok(included, 'response has included array');
        assert.ok(included.length > 0, 'has included resources');

        const owner = included.find(r => r.type === 'owner');
        assert.ok(owner, 'owner is included');
        assert.ok(owner.links, 'included resource has links object');
        assert.ok(owner.links.self, 'included resource has links.self');
        assert.ok(owner.links.self.includes(`/owners/${owner.id}`), 'self link points to resource URL');
      });
    });

    // ==========================================
    // Relationship Links
    // ==========================================

    module('Relationship Links', function() {
      test('belongsTo relationship includes links.self and links.related', async function(assert) {
        const response = await fetch(`${endpoint}/animals/1`);
        const { data } = await response.json();

        assert.ok(data.relationships, 'resource has relationships');
        assert.ok(data.relationships.owner, 'has owner relationship');

        const ownerRel = data.relationships.owner;
        assert.ok(ownerRel.links, 'relationship has links object');
        assert.ok(ownerRel.links.self, 'relationship has links.self');
        assert.ok(ownerRel.links.self.includes('/animals/1/relationships/owner'), 'self points to relationship URL');
        assert.ok(ownerRel.links.related, 'relationship has links.related');
        assert.ok(ownerRel.links.related.includes('/animals/1/owner'), 'related points to related resource URL');
      });

      test('hasMany relationship includes links.self and links.related', async function(assert) {
        const response = await fetch(`${endpoint}/animals/1`);
        const { data } = await response.json();

        assert.ok(data.relationships, 'resource has relationships');
        assert.ok(data.relationships.traits, 'has traits relationship');

        const traitsRel = data.relationships.traits;
        assert.ok(traitsRel.links, 'relationship has links object');
        assert.ok(traitsRel.links.self, 'relationship has links.self');
        assert.ok(traitsRel.links.self.includes('/animals/1/relationships/traits'), 'self points to relationship URL');
        assert.ok(traitsRel.links.related, 'relationship has links.related');
        assert.ok(traitsRel.links.related.includes('/animals/1/traits'), 'related points to related resource URL');
      });

      test('owner hasMany pets relationship includes proper links', async function(assert) {
        const response = await fetch(`${endpoint}/owners/bob`);
        const { data } = await response.json();

        assert.ok(data.relationships, 'resource has relationships');
        assert.ok(data.relationships.pets, 'has pets relationship');

        const petsRel = data.relationships.pets;
        assert.ok(petsRel.links, 'relationship has links object');
        assert.ok(petsRel.links.self, 'relationship has links.self');
        assert.ok(petsRel.links.self.includes('/owners/bob/relationships/pets'), 'self points to relationship URL');
        assert.ok(petsRel.links.related, 'relationship has links.related');
        assert.ok(petsRel.links.related.includes('/owners/bob/pets'), 'related points to related resource URL');
      });

      test('trait belongsTo category relationship includes proper links', async function(assert) {
        const response = await fetch(`${endpoint}/traits/1`);
        const { data } = await response.json();

        assert.ok(data.relationships, 'resource has relationships');
        assert.ok(data.relationships.category, 'has category relationship');

        const categoryRel = data.relationships.category;
        assert.ok(categoryRel.links, 'relationship has links object');
        assert.ok(categoryRel.links.self, 'relationship has links.self');
        assert.ok(categoryRel.links.self.includes('/traits/1/relationships/category'), 'self points to relationship URL');
        assert.ok(categoryRel.links.related, 'relationship has links.related');
        assert.ok(categoryRel.links.related.includes('/traits/1/category'), 'related points to related resource URL');
      });
    });
  });
});
