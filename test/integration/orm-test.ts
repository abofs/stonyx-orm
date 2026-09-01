// @ts-nocheck
import QUnit from 'qunit';
import sinon from 'sinon';
import Orm, { createRecord, updateRecord, store, beforeHook, afterHook, clearHook, clearAllHooks } from '@stonyx/orm';
import Cron from '@stonyx/cron';
import { setupIntegrationTests } from 'stonyx/test-helpers';
import log from 'stonyx/log';
import { raw, serialized } from '../sample/payload.js';
import { dbKey } from '../../src/db.js';
import { readFile, deleteFile } from '@stonyx/utils/file';
import config from 'stonyx/config';
import RestServer from '@stonyx/rest-server';
// The BUILT OrmRequest, deliberately — see the #202 module below. `dist` is what
// the running app mounted; the `src` copy would carry its own `store` module
// instance, so a route mounted from it would serve a different, empty store.
import OrmRequest from '../../dist/orm-request.js';
import net from 'node:net';

const { module, test } = QUnit;
let endpoint;

//let endpoint;
let parsedFileData;

// Driven by sample requests defined in test/sample-requests
module('[Integration] ORM', function(hooks) {
  setupIntegrationTests(hooks);

  hooks.before(function() {
    endpoint = `http://localhost:${config.restServer.port}`;

    // abofs/stonyx-orm#240, fixture 2. Seeded HERE, in the outermost before
    // hook, so it exists before ANY nested module creates an animal: the trait
    // sub-records come out of the animal serializer, and a `belongsTo` whose
    // target record does not yet exist resolves to `null` rather than keeping
    // the raw foreign key. Seeded late, `serialized.traits[n].tag` would be
    // `null` and this fixture would be inert on every surface.
    //
    // `tag` is claimed by no access class, so nothing mounts a route for it —
    // see test/sample/models/tag.ts.
    createRecord('tag', { id: 'never-mounted', label: 'a collection the consumer never exposed' });
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
        phoneNumbers: []
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

    test('onUpdate autosave triggers db.save() after PATCH', async function(assert) {
      // Create an isolated record for this test
      createRecord('trait', { id: 8000, type: 'test', value: 'original' });

      const originalAutosave = config.orm.db.autosave;
      config.orm.db.autosave = 'onUpdate';
      const saveSpy = sinon.spy(Orm.db, 'save');

      await fetch(`${endpoint}/traits/8000`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          data: { type: 'traits', id: 8000, attributes: { value: 'changed' } }
        })
      });

      assert.ok(saveSpy.calledOnce, 'db.save() called once after PATCH');

      saveSpy.restore();
      config.orm.db.autosave = originalAutosave;
      store.remove('trait', 8000);
    });

    test('onUpdate autosave triggers db.save() after POST', async function(assert) {
      const originalAutosave = config.orm.db.autosave;
      config.orm.db.autosave = 'onUpdate';
      const saveSpy = sinon.spy(Orm.db, 'save');

      const response = await fetch(`${endpoint}/traits`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          data: { type: 'trait', id: 8001, attributes: { type: 'test', value: 'new' } }
        })
      });

      assert.ok(saveSpy.calledOnce, 'db.save() called once after POST');

      saveSpy.restore();
      config.orm.db.autosave = originalAutosave;
      store.remove('trait', 8001);
    });

    test('onUpdate autosave triggers db.save() after DELETE', async function(assert) {
      // Create an isolated record to delete
      createRecord('trait', { id: 8002, type: 'test', value: 'deleteme' });

      const originalAutosave = config.orm.db.autosave;
      config.orm.db.autosave = 'onUpdate';
      const saveSpy = sinon.spy(Orm.db, 'save');

      await fetch(`${endpoint}/traits/8002`, {
        method: 'DELETE'
      });

      assert.ok(saveSpy.calledOnce, 'db.save() called once after DELETE');

      saveSpy.restore();
      config.orm.db.autosave = originalAutosave;
    });

    test('onUpdate autosave does NOT trigger db.save() on GET', async function(assert) {
      const originalAutosave = config.orm.db.autosave;
      config.orm.db.autosave = 'onUpdate';
      const saveSpy = sinon.spy(Orm.db, 'save');

      await fetch(`${endpoint}/traits`);

      assert.notOk(saveSpy.called, 'db.save() not called on GET collection');

      saveSpy.restore();
      config.orm.db.autosave = originalAutosave;
    });
  });

  module('Data', function(hooks) {
    hooks.before(function() {
      // Create categories first so traits can reference them
      for (const category of serialized.categories) {
        createRecord('category', category);
      }

      // Create phone-numbers
      for (const phoneNumber of serialized.phoneNumbers) {
        createRecord('phone-number', phoneNumber);
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

    test('updateRecord with null clears the field', function(assert) {
      const owner = store.get('owner', 'bob');

      assert.equal(owner.age, 44, 'age starts as 44');

      updateRecord(owner, { age: null });

      assert.strictEqual(owner.age, null, 'age is null after updateRecord with null');
      assert.strictEqual(owner.__data.age, null, '__data.age is null');

      // Revert change
      owner.age = 44;
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
      // READ THE LIVE STORE BEFORE THE UNLOAD BELOW DESTROYS IT. The
      // measured-loss precondition further down used to read the STATIC
      // `serialized` import from test/sample/payload.ts, which is the one thing
      // it claims to exclude: breaking live resolution outright measured
      // 1010 / 5 with that assertion FULLY GREEN, because payload.ts says
      // `tag: 'never-mounted'` whatever the store did.
      const liveTags = [1, 2, 3].map(id => store.get('trait', id)?.tag?.id ?? null);

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

      // RE-SPECIFIED BY abofs/stonyx-orm#240, FIXTURE 2 -- AND THE
      // RE-SPECIFICATION IS THE POINT, NOT A WORKAROUND.
      //
      // `tag` is claimed by no access class and is deliberately kept OUT of
      // test/sample/db-schema.ts (putting it in costs 6 reds across two files,
      // one of them the exact-key schema pin in `file stores expected schema
      // structure`). A model absent from the
      // schema is NEVER PERSISTED, so the saved file carries no `tags`
      // collection and the reload above has no tag record to resolve
      // `trait.tag` against. It comes back `null` where the live store held
      // `'never-mounted'`.
      //
      // "An unclaimed model is not persisted with the sample db" is a true and
      // useful property of this fixture, so it is asserted DIRECTLY rather than
      // absorbed into a looser comparison that would also swallow a real
      // regression.
      assert.notOk('tags' in parsedFileData,
        'the saved file carries no `tags` collection -- an unclaimed model is absent from the schema and is therefore never persisted');
      assert.deepEqual(dbRecordData.traits.map(trait => trait.tag), [null, null, null],
        'so a belongsTo to it does not survive the round trip');
      // The measured-loss half. Without this the assertion above is satisfied
      // by a fixture that never linked a tag in the first place, which is the
      // inert-fixture failure #240 AC4 exists to prevent.
      assert.deepEqual(liveTags, [null, 'never-mounted', 'never-mounted'],
        'precondition: the LIVE store resolved two of the three, so the line above records a loss rather than an absence');

      assert.deepEqual(dbRecordData, {
        ...serialized,
        traits: serialized.traits.map(trait => ({ ...trait, tag: null })),
      }, 'and everything else round-trips byte-identically');
    });

    test('format() deduplicates records by ID in hasMany arrays', function(assert) {
      // Simulate the corruption scenario: duplicate entries in JSON for the same owner
      const duplicateData = {
        owners: [
          { id: 'gina', name: 'gina', gender: 'female', age: 30, children: 0 },
          { id: 'gina', name: 'gina', gender: 'female', age: 34, children: 0 }
        ],
        animals: [],
        traits: [],
        categories: [],
        phoneNumbers: []
      };

      // Unload all records and re-create from duplicate data
      store.unloadAllRecords(dbKey, { includeChildren: true });
      const dbRecord = createRecord(dbKey, duplicateData, { serialize: false, transform: false });
      const formatted = dbRecord.format();
      delete formatted.id;

      assert.strictEqual(formatted.owners.length, 1, 'format() deduplicates — one entry per ID');
      assert.strictEqual(formatted.owners[0].id, 'gina', 'deduped entry has correct ID');
      assert.strictEqual(formatted.owners[0].age, 34, 'last entry wins — age is 34 not 30');

      // Restore original data for subsequent tests
      store.unloadAllRecords(dbKey, { includeChildren: true });
      createRecord(dbKey, parsedFileData, { serialize: false, transform: false });
    });

    test('format() round-trip with duplicates preserves record count', function(assert) {
      // Snapshot the current serialized data
      const ownerCount = serialized.owners.length;

      // Unload and reload from serialized data
      store.unloadAllRecords(dbKey, { includeChildren: true });
      const dbRecord = createRecord(dbKey, serialized, { serialize: false, transform: false });
      const formatted = dbRecord.format();
      delete formatted.id;

      assert.strictEqual(formatted.owners.length, ownerCount, 'round-trip preserves exact owner count');

      // Second round-trip should be stable
      store.unloadAllRecords(dbKey, { includeChildren: true });
      const dbRecord2 = createRecord(dbKey, formatted, { serialize: false, transform: false });
      const formatted2 = dbRecord2.format();
      delete formatted2.id;

      assert.strictEqual(formatted2.owners.length, ownerCount, 'second round-trip is stable — no growth');

      // Restore for subsequent tests
      store.unloadAllRecords(dbKey, { includeChildren: true });
      createRecord(dbKey, parsedFileData, { serialize: false, transform: false });
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
      // Test collection route - should be /phone-numbers (not /phone-number)
      const collectionResponse = await fetch(`${endpoint}/phone-numbers`);
      const { data: collection } = await collectionResponse.json();

      assert.equal(collectionResponse.status, 200, 'collection route responds successfully');
      assert.equal(collection.length, 2, 'returns both phone-number records');
      assert.equal(collection[0].type, 'phone-number', 'type is phone-number');
      assert.equal(collection[0].attributes.areaCode, 555);

      // Test individual record route - should be /phone-numbers/:id
      const individualResponse = await fetch(`${endpoint}/phone-numbers/555-0123`);
      const { data: individual } = await individualResponse.json();

      assert.equal(individualResponse.status, 200, 'individual route responds successfully');
      assert.equal(individual.id, '555-0123');
      assert.equal(individual.type, 'phone-number');
      assert.equal(individual.attributes.areaCode, 555);
    });

    test('post call for schema records create a new record expected', async function(assert) {
      const newAnimal = {
        data: {
          type: 'animal',
          attributes: { type: 'horse', age: 3, size: 'large', owner: 'bob' }
        }
      };
      // The auto-assigned id is a LITERAL, deliberately. #190 added two fixture
      // animals (21 and 22) as the access filter's dedicated hidden subject,
      // which shifted this from 21 to 23; an earlier revision responded by
      // deriving it with `store.get('animal').values().at(-1).id + 1`, which is
      // assignRecordId's rule copied verbatim (src/manage-record.ts:218-219) and
      // therefore tautological. If insertion order ever stops guaranteeing the
      // maximum id is last, assignRecordId returns a COLLIDING id, createRecord
      // takes its "last entry wins" branch and overwrites an existing animal —
      // and a derived expectation computes the same colliding id and passes,
      // having just watched a POST destroy a record. Two assertions that fail
      // for two different reasons: the predecessor is where we think it is, and
      // the new id is what the product rule says it should be.
      const EXPECTED_ID = 23;
      assert.equal(Array.from(store.get('animal').values()).at(-1).id, EXPECTED_ID - 1,
        'the last animal in the store is the expected predecessor before the POST');

      const response = await fetch(`${endpoint}/animals`, {
        method: 'post',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newAnimal)
      });

      const { data } = await response.json();

      assert.equal(response.status, 200);
      assert.equal(store.get('animal', EXPECTED_ID).tag, `bob's large horse`);
      assert.equal(data.type, 'animal');
      assert.equal(data.id, EXPECTED_ID);
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

    test('PATCH with null attribute clears the field', async function(assert) {
      const owner = store.get('owner', 'bob');

      assert.equal(owner.age, 44, 'age starts as 44');

      const response = await fetch(`${endpoint}/owners/bob`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          data: {
            type: 'owner',
            id: 'bob',
            attributes: { age: null }
          }
        })
      });

      assert.equal(response.status, 200);
      assert.strictEqual(owner.age, null, 'age is null after PATCH with null');

      // Revert change
      owner.age = 44;
    });

    test('delete call for schema records work as expected', async function(assert) {
      assert.ok(store.get('animal', 3));

      const response = await fetch(`${endpoint}/animals/3`, { method: 'delete' });

      assert.equal(response.status, 204);
      assert.notOk(store.get('animal', 3));
    });

    test('deleted record is not accessible via GET', async function(assert) {
      const targetId = 4;

      // Verify record exists
      const getBeforeResponse = await fetch(`${endpoint}/animals/${targetId}`);
      assert.equal(getBeforeResponse.status, 200, 'record exists before delete');

      // Delete the record
      const deleteResponse = await fetch(`${endpoint}/animals/${targetId}`, { method: 'DELETE' });
      assert.equal(deleteResponse.status, 204, 'delete returns 204');

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
      // RETARGETED FROM /animals TO /traits, and the reason is a BEHAVIOUR
      // CHANGE, not a convenience. `/animals` carries a function-style `access`
      // filter in the shipped fixture, and under such a filter a client-supplied
      // POST id is now refused with 403 before the collision lookup runs — that
      // is what closes the POST existence oracle (#190), and it is asserted in
      // its own right two modules below and in the unit tier's assertion 22.
      // `/traits` is unfiltered, so this keeps asserting exactly what its name
      // says: a duplicate client-supplied id is a 409.
      const first = {
        data: { type: 'trait', id: 9999, attributes: { type: 'habitat', value: 'farm', category: 'physical' } }
      };
      const firstResponse = await fetch(`${endpoint}/traits`, {
        method: 'post',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(first)
      });

      assert.equal(firstResponse.status, 200, 'first creation succeeds');

      // Attempt to create another record with the same id
      const duplicate = {
        data: { type: 'trait', id: 9999, attributes: { type: 'color', value: 'black', category: 'appearance' } }
      };
      const duplicateResponse = await fetch(`${endpoint}/traits`, {
        method: 'post',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(duplicate)
      });

      assert.equal(duplicateResponse.status, 409, 'duplicate id returns 409 conflict');

      // And a STRING-typed duplicate is the same 409. The lookup used the raw
      // body value while the store is keyed by the coerced one, so `"9999"`
      // missed the entry, skipped the check and silently OVERWROTE the record
      // with a 200.
      const stringTyped = await fetch(`${endpoint}/traits`, {
        method: 'post',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data: { type: 'trait', id: '9999', attributes: { type: 'color', value: 'white', category: 'appearance' } } })
      });

      assert.equal(stringTyped.status, 409, 'a string-typed duplicate id is 409 too (was: 200, and the record was overwritten)');
      assert.equal(store.get('trait', 9999).value, 'farm', 'and the existing record is unchanged (was: overwritten)');

      // Cleanup
      store.remove('trait', 9999);
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

    test('post call with belongsTo in relationships object sets relationship on record', async function(assert) {
      const newTrait = {
        data: {
          type: 'trait',
          id: 7777,
          attributes: { type: 'color', value: 'orange' },
          relationships: {
            category: {
              data: { type: 'category', id: 'appearance' }
            }
          }
        }
      };
      const response = await fetch(`${endpoint}/traits`, {
        method: 'post',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newTrait)
      });

      const { data } = await response.json();

      assert.equal(response.status, 200);
      assert.equal(data.id, 7777);

      // Verify the belongsTo relationship was set on the store record
      const record = store.get('trait', 7777);
      assert.ok(record.category, 'record has category relationship');
      assert.equal(record.category.id, 'appearance', 'category points to correct record');

      // Cleanup
      store.remove('trait', 7777);
    });

    test('post call with id only in attributes does not use it as record id', async function(assert) {
      const payload = {
        data: {
          type: 'animal',
          attributes: { id: 8888, type: 'dog', age: 2, size: 'small', owner: 'bob' }
        }
      };
      const response = await fetch(`${endpoint}/animals`, {
        method: 'post',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      const { data } = await response.json();

      assert.equal(response.status, 200);
      assert.notEqual(data.id, 8888, 'id from attributes is not used as record id');

      // Cleanup
      store.remove('animal', data.id);
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
      //
      // MEMBERSHIP, AND IT IS abofs/stonyx-orm#233's REPRODUCTION -- LEAVE IT.
      // angela is 404 on `/owners/angela` and she is still a MEMBER of
      // `included`; that this is currently true is what #233 exists to change,
      // so this line must stay able to go red in Sprint 87. #235 does not move
      // it (measured green under the #235 patch), and it must not be swept up
      // in the re-specification three lines below.
      const owner = included.find(r => r.type === 'owner' && r.id === 'angela');
      assert.ok(owner, 'owner is included');

      // Angela owns multiple animals, those should be in included.
      //
      // RE-SPECIFIED BY abofs/stonyx-orm#235, AND ONLY THIS ASSERTION. It used
      // to select the sideloaded animals by
      // `r.relationships.owner?.data?.id === 'angela'` -- which is the LEAK
      // written as a requirement: it asserted that eight permitted animals each
      // publish the id of an owner this caller gets a 404 for. #235 nulls that
      // linkage, so the old selector matched nothing and the assertion went red
      // for the RIGHT reason. It is re-specified rather than deleted, and it is
      // re-specified to the property the test was actually named for: that the
      // NESTED hop (`owner.pets`) traversed and produced animals in `included`.
      //
      // Selecting on `type === 'animal'` alone is not enough on its own -- the
      // primary record's own relationships could contribute one -- so the
      // membership is checked against the store's view of angela's pets, which
      // is the set the nested hop is supposed to have produced.
      const angelaPets = included.filter(r => r.type === 'animal');
      assert.ok(angelaPets.length > 1, 'owner pets are included via nested relationship');

      const expectedPets = [...(store.get('owner', 'angela')?.pets ?? [])].map(pet => pet?.id ?? pet);
      assert.ok(expectedPets.length > 1, 'precondition: angela really does own more than one animal');
      assert.ok(expectedPets.every(id => angelaPets.some(r => r.id === id)),
        'and every one of the owner\'s pets reached included via the nested hop');
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
      // Create an animal without traits.
      //
      // No client-supplied `id`, and that is a BEHAVIOUR CHANGE rather than a
      // tidy-up: `/animals` carries a function-style `access` filter, and under
      // one a client-supplied POST id is now refused with 403 before the
      // collision lookup runs. That is what closes the POST existence oracle
      // (#190). This test is about include= resolution, not about ids, so it
      // takes the server-assigned id from the response — which it already did.
      const createResponse = await fetch(`${endpoint}/animals`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data: { type: 'animal', attributes: { type: 1, age: 1, size: 'tiny', owner: 'bob' } } })
      });

      assert.equal(createResponse.status, 200, 'a create without a client-supplied id still succeeds under a filter');
      const { data: created } = await createResponse.json();

      // Try to include traits.metadata (traits doesn't exist, metadata doesn't exist)
      const response = await fetch(`${endpoint}/animals/${created.id}?include=traits,traits.metadata`);
      const { data } = await response.json();

      assert.equal(response.status, 200);
      // Should not crash even if traits.metadata doesn't exist

      // Cleanup
      store.remove('animal', created.id);
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
      // gina, not angela: the access fixture hides angela on every /owners
      // surface as of #190, so this would 404 for a reason that has nothing to
      // do with what the test is checking.
      test('GET /owners/:id/pets returns related animals', async function(assert) {
        const response = await fetch(`${endpoint}/owners/gina/pets`);
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
      //
      // RE-SPECIFIED BY abofs/stonyx-orm#232, AS A PAIR RATHER THAN AS AN EDIT.
      // This test read `/animals/1/owner` and asserted `data.id === 'angela'` --
      // and angela is 404 on her OWN route. So it was this issue's second
      // reproduction, pinned green as correct behaviour.
      //
      // The subject moves to animal 4, whose owner `gina` is permitted, and the
      // hidden case is asserted in the SAME test rather than deleted. Both
      // directions have a tripwire: dropping the positive half reds the
      // over-denial guard, dropping the negative half leaves a test that no
      // longer covers what #232 changed, and
      // test/unit/relationship-route-access-test.ts asserts the negative half
      // is still here.
      test('GET /animals/:id/owner returns related owner', async function(assert) {
        const response = await fetch(`${endpoint}/animals/4/owner`);
        const { data } = await response.json();

        assert.equal(response.status, 200, 'returns 200 status');
        assert.notOk(Array.isArray(data), 'data is not an array for belongsTo');
        assert.equal(data.type, 'owner', 'returns owner record');
        assert.equal(data.id, 'gina', 'returns correct owner');

        // #232 -- the negative half, in the same test.
        const hidden = await fetch(`${endpoint}/animals/1/owner`);
        const hiddenJson = await hidden.json();
        assert.equal(hidden.status, 200, 'a hidden owner still answers 200 -- withholding is not an error');
        assert.strictEqual(hiddenJson.data, null,
          'and an owner hidden by her own model\'s predicate is withheld here too (was: 200 with full attributes)');
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

      // Owner -> phoneNumbers (camelCase property should generate dasherized route)
      // Model has: phoneNumbers = hasMany('phone-number')
      // Expected route: /owners/:id/phone-numbers (dasherized)
      test('GET /owners/:id/phone-numbers works when model property is camelCase phoneNumbers', async function(assert) {
        // Create phone-number record tied to existing owner
        createRecord('phone-number', { id: '415-9999', areaCode: 415, owner: 'gina' });

        // Request using dasherized route (JSON:API convention)
        const response = await fetch(`${endpoint}/owners/gina/phone-numbers`);
        const { data } = await response.json();

        assert.equal(response.status, 200, 'dasherized route /phone-numbers should work for camelCase property phoneNumbers');
        assert.ok(Array.isArray(data), 'data is an array for hasMany');
        assert.ok(data.length > 0, 'returns related phone-numbers');
        assert.equal(data[0].type, 'phone-number', 'record type is phone-number');
        assert.equal(data[0].id, '415-9999', 'record id matches created record');

        // Cleanup
        store.remove('phone-number', '415-9999');
      });
    });

    // ==========================================
    // Relationship Linkage Routes: GET /{type}/{id}/relationships/{relationship}
    // These return only the relationship linkage (type + id), not full records
    // ==========================================

    module('Relationship Linkage Routes', function() {
      // Owner -> pets (hasMany)
      test('GET /owners/:id/relationships/pets returns relationship linkage', async function(assert) {
        const response = await fetch(`${endpoint}/owners/gina/relationships/pets`);
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
      //
      // RE-SPECIFIED BY abofs/stonyx-orm#232 -- see the note on
      // `GET /animals/:id/owner returns related owner` above. Same pair, on the
      // route family that builds its linkage BY HAND.
      test('GET /animals/:id/relationships/owner returns relationship linkage', async function(assert) {
        const response = await fetch(`${endpoint}/animals/4/relationships/owner`);
        const { data } = await response.json();

        assert.equal(response.status, 200, 'returns 200 status');
        assert.notOk(Array.isArray(data), 'data is not an array for belongsTo');
        assert.equal(data.type, 'owner', 'linkage references owner type');
        assert.equal(data.id, 'gina', 'linkage has correct id');
        assert.notOk(data.attributes, 'linkage does not include attributes');

        // #232 -- the negative half, in the same test.
        const hidden = await fetch(`${endpoint}/animals/1/relationships/owner`);
        const hiddenJson = await hidden.json();
        assert.equal(hidden.status, 200, 'the linkage route answers 200 too');
        assert.strictEqual(hiddenJson.data, null,
          'and a hidden owner is withheld on the linkage route too (was: 200 with {"type":"owner","id":"angela"})');
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
      // Must use a VISIBLE owner. Against a filtered owner this would 404
      // because the parent is hidden, which passes without exercising the
      // invalid-relationship path at all.
      test('GET /{type}/:id/relationships/{invalid} returns 404', async function(assert) {
        const response = await fetch(`${endpoint}/owners/gina/relationships/invalid`);

        assert.equal(response.status, 404, 'returns 404 for invalid relationship name');
      });

      // Visible owner, for the same reason as above.
      test('GET /{type}/:id/{invalid} returns 404 for invalid relationship', async function(assert) {
        const response = await fetch(`${endpoint}/owners/gina/invalid`);

        assert.equal(response.status, 404, 'returns 404 for invalid relationship name');
      });
    });
  });

  /**
   * Access filter enforcement over the live HTTP path (#190).
   *
   * A function-style `access` filter used to be applied to collection GET and
   * nowhere else, so a record hidden from GET /animals stayed readable,
   * updatable and deletable by id, and its relationships were disclosable.
   *
   * test/unit/access-filter-enforcement-test.ts is the exhaustive suite and is
   * the only tier that can exercise the persistence half of the defect, because
   * it can stub Orm.instance.sqlDb. This module is the end-to-end counterpart:
   * it proves the guard survives the real express dispatch, real auth() wiring
   * and real serialization, which handler-level tests cannot.
   *
   * `restricted` (animals 21 and 22) is the fixture's dedicated hidden subject.
   */
  module('Access Filter Enforcement (#190)', function(accessHooks) {
    const HIDDEN = 21;      // owned by `restricted` — filtered on every surface
    const VISIBLE = 7802;   // owned by gina — seeded by this module, destroyed by this module
    const NEVER_EXISTED = 7777;
    const ARCHIVED_OWNER = 'archived'; // seeded by this module, destroyed by this module
    // A SECOND, DISTINCT OWNER whose id differs from the one above ONLY IN CASE
    // (abofs/stonyx-orm#237). Without a real record here the case contract is
    // unmeasurable: `GET /owners/ARCHIVED` answers 404 whether the rule denies
    // it or not, which is how the wrong contract was pinned at :1680 for three
    // rounds. Module-owned, like the two above, and removed in `after`.
    const ARCHIVED_UPPER = 'ARCHIVED';
    const COLLIDE = 7803;   // never created; used by the create-collision assertions

    // This module OWNS its subjects. An earlier revision used shared fixture
    // animal 13 as the visible subject and then deleted it in the last test, so
    // the module mutated global state that `JSON API Links` and the entire
    // `Hooks` module run against with no re-seed — and it declared no
    // hooks.before, unlike every sibling module in this file, so it inherited
    // whatever the previous module left behind. The next test added downstream
    // that assumes 20 animals or gina's four pets would have failed for a reason
    // a hundred lines away.
    accessHooks.before(function() {
      if (!store.get('animal', VISIBLE)) {
        createRecord('animal', { id: VISIBLE, type: 1, age: 5, size: 'small', owner: 'gina', traits: [] }, { serialize: false, _skipAutoPersist: true });
      }

      // #227 fix round. THE /archived DENY HAD NO RECORD BEHIND IT. Every
      // assertion on `GET /owners/archived` was measuring a 403 raised for a
      // record that does not exist, so it could not tell a deny apart from an
      // absence, and the claim that a context-only migration "turns this into a
      // 200" was measured at 404 by the Test Coverage phase. With the record
      // seeded the 403 is a real refusal of a real record, the deny-to-allow
      // mutation really does produce a 200 carrying the record in full, and the
      // DELETE assertion has something that can actually be destroyed.
      //
      // Module-owned, like VISIBLE above, and removed in `after` — no shared
      // fixture is mutated and no owner count anywhere else in this file moves.
      if (!store.get('owner', ARCHIVED_OWNER)) {
        createRecord('owner', { id: ARCHIVED_OWNER, gender: 'secret', age: 99, pets: [], phoneNumbers: [] }, { serialize: false, _skipAutoPersist: true });
      }

      // #237. `uppercase-secret` rather than `secret`, so the body assertions
      // can tell the two records apart: a response carrying `"secret"` could be
      // either, and the whole finding is that they are DIFFERENT records.
      if (!store.get('owner', ARCHIVED_UPPER)) {
        createRecord('owner', { id: ARCHIVED_UPPER, gender: 'uppercase-secret', age: 98, pets: [], phoneNumbers: [] }, { serialize: false, _skipAutoPersist: true });
      }
    });

    accessHooks.after(function() {
      for (const id of [VISIBLE, COLLIDE]) {
        if (store.get('animal', id)) store.remove('animal', id, { _skipAutoPersist: true });
      }

      for (const id of [ARCHIVED_OWNER, ARCHIVED_UPPER]) {
        if (store.get('owner', id)) store.remove('owner', id, { _skipAutoPersist: true });
      }
    });

    // Raw-socket dispatch through the real router. Hoisted to module scope by
    // the #227 fix round: it was defined inside the variant-5 test, forty lines
    // above the `/archived` assertions that also need it — `fetch()` cannot emit
    // an absolute-form request-target, and the only absolute-form `/archived`
    // coverage in the tree hand-supplies `request.path`, which is the exact
    // field whose production value the surviving read depends on.
    const rawRequest = (method, target, host = 'localhost') => new Promise((resolve, reject) => {
      const socket = net.connect(config.restServer.port, '127.0.0.1', () => {
        socket.write(`${method} ${target} HTTP/1.1\r\nHost: ${host}\r\nConnection: close\r\n\r\n`);
      });
      let buffer = '';
      socket.setTimeout(5000, () => { socket.destroy(); reject(new Error('raw request timed out')); });
      socket.on('data', chunk => { buffer += chunk; });
      socket.on('end', () => resolve({
        status: Number(buffer.split('\r\n')[0].split(' ')[1]),
        body: buffer.split('\r\n\r\n').slice(1).join('\r\n\r\n'),
      }));
      socket.on('error', reject);
    });

    test('[DEFECT] the filter is live: hidden animals are absent from the collection but present in the store', async function(assert) {
      const response = await fetch(`${endpoint}/animals`);
      const { data } = await response.json();

      assert.equal(response.status, 200, 'collection is reachable');
      assert.ok(store.get('animal', HIDDEN), 'the hidden record really does exist in the store');
      assert.notOk(data.some(record => Number(record.id) === HIDDEN), 'hidden record is absent from the collection');
      assert.ok(data.length < store.get('animal').size, `collection is a strict subset (${data.length} of ${store.get('animal').size})`);
    });

    test('[DEFECT] GET /animals/:id is 404 for a hidden record, byte-identical to one that never existed', async function(assert) {
      const hidden = await fetch(`${endpoint}/animals/${HIDDEN}`);
      const missing = await fetch(`${endpoint}/animals/${NEVER_EXISTED}`);

      assert.equal(hidden.status, 404, 'hidden record is 404 (was 200 with the full record)');
      assert.equal(missing.status, 404, 'never-existed record is 404');
      assert.equal(await hidden.text(), await missing.text(), 'bodies are identical — no existence oracle');
    });

    test('[DEFECT] relationship route families are 404 for a hidden record', async function(assert) {
      const related = await fetch(`${endpoint}/animals/${HIDDEN}/owner`);
      const linkage = await fetch(`${endpoint}/animals/${HIDDEN}/relationships/owner`);

      assert.equal(related.status, 404, 'GET /:id/{rel} is 404 (was 200, disclosing the owner)');
      assert.equal(linkage.status, 404, 'GET /:id/relationships/{rel} is 404 (was 200, disclosing the linkage)');
    });

    test('[DEFECT] PATCH on a hidden record is 404 and mutates nothing', async function(assert) {
      const before = store.get('animal', HIDDEN).age;

      const response = await fetch(`${endpoint}/animals/${HIDDEN}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data: { type: 'animal', id: HIDDEN, attributes: { age: 999 } } })
      });

      assert.equal(response.status, 404, 'PATCH is 404 (was 200)');
      assert.equal(store.get('animal', HIDDEN).age, before, 'age is unchanged (was mutated)');
    });

    test('[DEFECT] POST failing the filter is 403 and leaves no record behind', async function(assert) {
      // No `id` in the body. An id-bearing POST under a per-record filter is now
      // refused before createRecord runs (see the oracle assertions below), so
      // an id-bearing payload would be 403 without ever reaching the rollback —
      // green, and no longer testing the rollback it is named for.
      const before = store.get('animal').size;

      const response = await fetch(`${endpoint}/animals`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data: { type: 'animal', attributes: { type: 1, age: 1, size: 'small', owner: 'restricted' } } })
      });

      assert.equal(response.status, 403, 'denied create is 403, deliberately not 404');
      assert.equal(store.get('animal').size, before, 'the record was rolled back out of the store');
    });

    test('[GUARD] a visible record is untouched on every surface (over-blocking)', async function(assert) {
      const single = await fetch(`${endpoint}/animals/${VISIBLE}`);
      const related = await fetch(`${endpoint}/animals/${VISIBLE}/owner`);
      const linkage = await fetch(`${endpoint}/animals/${VISIBLE}/relationships/owner`);

      assert.equal(single.status, 200, 'GET /:id still works');
      assert.equal(related.status, 200, 'GET /:id/{rel} still works');
      assert.equal(linkage.status, 200, 'GET /:id/relationships/{rel} still works');
    });

    // Ordered last: it destroys records.
    test('[DEFECT] DELETE is 404 for hidden and for missing, and the hidden record survives', async function(assert) {
      const hidden = await fetch(`${endpoint}/animals/${HIDDEN}`, { method: 'DELETE' });
      const missing = await fetch(`${endpoint}/animals/${NEVER_EXISTED}`, { method: 'DELETE' });

      assert.equal(hidden.status, 404, 'denied delete is 404 (was 204)');
      assert.ok(store.get('animal', HIDDEN), 'the hidden record was NOT destroyed');

      // BEHAVIOUR CHANGE: 204 -> 404. Without it, denied-404 against missing-204
      // is a perfect existence oracle and the fix would be worthless.
      assert.equal(missing.status, 404, 'delete of a never-existed record is 404 (BEHAVIOUR CHANGE, was 204)');
      assert.equal(hidden.status, missing.status, 'the two are indistinguishable');
    });

    test('[DEFECT] the POST oracle is closed for EVERY payload, over the real dispatch', async function(assert) {
      // The previous version of this test posted twice and BOTH payloads carried
      // `owner:"restricted"` — both denied creates, both 403. It pinned the
      // branch, not the property. The oracle is payload-DEPENDENT: with a
      // payload the caller is permitted to create, the three outcomes are fully
      // distinguishable in one request per id. Measured on the reviewed head:
      //
      //   POST {id: 21,   owner:'gina'} -> 403   a HIDDEN record has this id
      //   POST {id: 7803, owner:'gina'} -> 200   this id is FREE
      //   POST {id: 7802, owner:'gina'} -> 409   a VISIBLE record has this id
      //
      // A client-supplied id under a per-record filter is now refused
      // unconditionally, before any store lookup, with the same 403 a denied
      // create returns. So no status — and no lookup cost — depends on whether
      // the id exists.
      const post = (id, owner) => fetch(`${endpoint}/animals`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data: { type: 'animal', id, attributes: { type: 1, age: 1, size: 'small', owner } } })
      });

      const readHidden = await fetch(`${endpoint}/animals/${HIDDEN}`);
      assert.equal(readHidden.status, 404, 'GET on the hidden record says it does not exist');

      const cells = [];
      for (const owner of ['gina', 'restricted']) {
        for (const id of [HIDDEN, VISIBLE, COLLIDE]) {
          for (const shape of [id, String(id)]) {
            cells.push((await post(shape, owner)).status);
          }
        }
      }

      assert.deepEqual([...new Set(cells)], [403],
        'every (payload x id x id-type) cell is 403 (was: 403 hidden / 200 free / 409 visible under an ALLOWED payload)');
      assert.ok(store.get('animal', HIDDEN), 'the hidden colliding record was not touched');
      assert.ok(store.get('animal', VISIBLE), 'nor the visible one');
      assert.notOk(store.get('animal', COLLIDE), 'and no denied create left a record behind');
    });

    test('[DEFECT] GATE 0 cannot be walked around by moving the id into `relationships`, over the real router', async function(assert) {
      // The oracle closure is only as wide as the channels it covers. GATE 0
      // reads the `id` member of the resource object; `createHandler` also
      // strips `attributes.id` — and then re-admitted a caller id through the
      // relationships loop, whose `key` is verbatim from the body and was never
      // checked. Measured on the reviewed head, unauthenticated, over this
      // router:
      //
      //   GET  /animals/21                                    -> 404  (hidden)
      //   POST /animals {"id":21, ...}                        -> 403  GATE 0 fires
      //   POST /animals {"relationships":{"id":{"data":{"id":21}}},
      //                  "attributes":{"owner":"gina"}}       -> 200  *** BYPASS ***
      //   GET  /animals/21                                    -> 200  *** de-hidden ***
      //
      // It belongs in the integration tier because the claim it falsifies is a
      // consumer-facing one — README breaking change 3 said "whatever the
      // payload" — and a consumer meets it over HTTP, not through the handler.
      const keysBefore = Array.from(store.get('animal').keys());
      const hiddenBefore = store.get('animal', HIDDEN);

      const before = await fetch(`${endpoint}/animals/${HIDDEN}`);
      assert.equal(before.status, 404, 'precondition: the hidden record reads as absent');

      const bypass = await fetch(`${endpoint}/animals`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data: {
          type: 'animal',
          relationships: { id: { data: { id: HIDDEN } } },
          attributes: { type: 1, age: 77, size: 'large', owner: 'gina' },
        } })
      });

      assert.strictEqual(store.get('animal', HIDDEN), hiddenBefore, 'the hidden record still occupies its slot');
      assert.notEqual(store.get('animal', HIDDEN).age, 77,
        'and was NOT overwritten (was: age 77, owner gina — de-hidden permanently by one moved field)');

      const body = bypass.status === 200 ? await bypass.json() : null;
      assert.notEqual(Number(body?.data?.id), HIDDEN, 'and no create landed on the caller-chosen id');

      const after = await fetch(`${endpoint}/animals/${HIDDEN}`);
      assert.equal(after.status, 404, 'the hidden record still reads as absent afterwards (was: 200)');

      for (const key of Array.from(store.get('animal').keys())) {
        if (!keysBefore.includes(key)) store.remove('animal', key, { _skipAutoPersist: true });
      }
    });

    test('[GUARD] the refusal is scoped to filtered callers: an unfiltered collection still answers 409', async function(assert) {
      // Proves the assertion above is not green merely because every POST is 403
      // now. `/traits` carries no function-style filter, so the documented
      // 409-on-duplicate is intact for the population the oracle does not exist
      // for. The pre-existing `post call with existing id returns 409 conflict`
      // covers the same ground from the other direction.
      const created = await fetch(`${endpoint}/traits`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data: { type: 'trait', id: 7810, attributes: { type: 'habitat', value: 'farm', category: 'physical' } } })
      });
      assert.equal(created.status, 200, 'an unfiltered collection still creates at a client-supplied id');

      const conflict = await fetch(`${endpoint}/traits`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data: { type: 'trait', id: 7810, attributes: { type: 'color', value: 'black', category: 'appearance' } } })
      });
      assert.equal(conflict.status, 409, 'and still answers 409 on a duplicate');

      store.remove('trait', 7810, { _skipAutoPersist: true });
    });

    test('[DEFECT] a case-varied path cannot walk past the filter, over the real router', async function(assert) {
      // THE STRONGEST FORM OF VARIANT 3, and the reason it belongs in the
      // integration tier rather than only against the matcher: `RestServer`
      // mounts with a bare `express()`, whose default is `caseSensitive: false`,
      // so express ROUTES `/ANIMALS/21` to the same handler while `originalUrl`
      // hands the sample the caller's case. A case-sensitive matcher does not
      // fire, `access()` falls through to a full CRUD grant, and there is no
      // filter on any surface at once. Measured on the reviewed head:
      //
      //   GET /animals/21 -> 404          GET /ANIMALS/21 -> 200, id=21
      //   GET /owners     -> 3 owners     GET /OWNERS     -> all 5
      //   DELETE /animals/22 -> 404       DELETE /ANIMALS/22 -> 204, DESTROYED
      //
      // That last pair is #190 verbatim, reachable by shifting one character.
      const lower = await fetch(`${endpoint}/animals/${HIDDEN}`);
      const upper = await fetch(`${endpoint}/ANIMALS/${HIDDEN}`);
      const mixed = await fetch(`${endpoint}/AnImAlS/${HIDDEN}`);

      assert.equal(lower.status, 404, 'the canonical path is 404');
      assert.equal(upper.status, 404, 'and so is the upper-cased one (was: 200, with the hidden record in full)');
      assert.equal(mixed.status, 404, 'and the mixed-case one');

      const collection = await fetch(`${endpoint}/ANIMALS`);
      const { data } = await collection.json();
      assert.equal(collection.status, 200, 'the collection still routes');
      assert.notOk(data.some(record => Number(record.id) === HIDDEN),
        'and the hidden record is absent from it (was: INCLUDED)');

      const destroy = await fetch(`${endpoint}/ANIMALS/${HIDDEN}`, { method: 'DELETE' });
      assert.equal(destroy.status, 404, 'DELETE /ANIMALS/:id on a hidden record is 404 (was: 204)');
      assert.ok(store.get('animal', HIDDEN), 'and the record survives (was: DESTROYED)');
    });

    test('[DEFECT] variant 5 — an ABSOLUTE-FORM request-target cannot walk past the filter, over the real router (NOW-VACUOUS COVERAGE, see header)', async function(assert) {
      // ======================================================================
      // #222 — THIS IS NO LONGER LIVE COVERAGE OF THE SAMPLE. READ THIS FIRST.
      //
      // Every assertion below still passes, and it is kept because a raw-socket
      // absolute-form dispatch through the whole router is worth keeping wired.
      // But it no longer exercises the defect it was written for. The shipped
      // sample was migrated to `access(request, { model, operation })` and it
      // reads NEITHER `originalUrl` NOR `baseUrl`; `model` is assigned at mount
      // time and no request target can influence it. So the absolute form
      // cannot reach a comparison there is no longer any of: variant 5 is
      // unconstructible against this predicate rather than handled by it, and
      // these assertions would pass against a predicate with no matching logic
      // whatsoever.
      //
      // Do not read a green here as evidence that a URL-parsing predicate is
      // safe, and do not delete it and call the variant covered elsewhere.
      //
      // #237 UPDATE — AND THE VACUITY IS NOW TOTAL, WHICH IS THE GOOD OUTCOME.
      // `request.path` was the one read of argument ONE that survived #222, and
      // it was the read that failed open on a percent-encoded id. #236 put the
      // decoded id on the context as `recordId` and #237 moved the rule onto
      // it, so the sample reads NOTHING off argument one. The live coverage of
      // that rule is now the `/owners/archived` pair immediately below this one
      // — the #222 tripwire, inverted, and the #237 test beside it, which drives
      // eight spellings, both relationship surfaces and the DELETE over this
      // same socket.
      // ======================================================================
      //
      // HISTORY. HTTP/1.1 permits an absolute-form request-target
      // (RFC 9112 3.2.2 — `GET http://host/path HTTP/1.1`). Express routes on
      // `parseurl(req).pathname`, so the request dispatches to the same handler,
      // but `request.originalUrl` is the RAW target. The shipped sample matched
      // on `String(request.originalUrl ?? '').split('?')[0].toLowerCase()`,
      // which for this request is `http://anything.example/animals/21` — no
      // `/animals` prefix, so `access()` fell through to the CRUD array and
      // there was no filter on ANY surface. Measured on the reviewed head:
      //
      //   GET    /animals/21                          -> 404
      //   GET    http://anything.example/animals/21    -> 200, the hidden record in full
      //   DELETE http://anything.example/animals/21    -> 204, record DESTROYED
      //
      // `fetch()` cannot express this — it always sends origin-form — so this
      // has to go over a raw socket, which is also the point: a consumer cannot
      // assume the request target is a path.
      //
      // An intermediate revision then read `request.baseUrl`, which express sets
      // from the pathname it matched, so the absolute form never reached the
      // comparison. THAT IS ALSO HISTORY: the migrated sample reads neither, as
      // the banner at the top of this test says — do not read this closing line
      // as a description of what the matcher does today.
      //
      // `rawRequest` is defined at module scope, so the `/archived` assertions
      // below can use it too.

      // Precondition: the raw socket reaches the same router the rest of this
      // module fetches from, and origin-form behaves as the fetch-based
      // assertions above already established.
      const originForm = await rawRequest('GET', `/animals/${HIDDEN}`);
      assert.equal(originForm.status, 404, 'precondition: origin-form GET on the hidden record is 404');

      const readable = await rawRequest('GET', `http://anything.example/animals/${HIDDEN}`);
      assert.equal(readable.status, 404,
        'absolute-form GET on the hidden record is 404 (was: 200, with the hidden record in full)');
      assert.notOk(readable.body.includes('"restricted"'),
        'and the response does not carry the hidden record');

      const cased = await rawRequest('GET', `http://anything.example/ANIMALS/${HIDDEN}`);
      assert.equal(cased.status, 404, 'absolute-form combined with a case-varied path is 404 too');

      const collection = await rawRequest('GET', 'http://anything.example/animals');
      assert.equal(collection.status, 200, 'the absolute-form collection still routes');
      assert.notOk(JSON.parse(collection.body).data.some(record => Number(record.id) === HIDDEN),
        'and the hidden record is absent from it (was: INCLUDED)');

      const destroyed = await rawRequest('DELETE', `http://anything.example/animals/${HIDDEN}`);
      assert.equal(destroyed.status, 404, 'absolute-form DELETE is 404 (was: 204)');
      assert.ok(store.get('animal', HIDDEN), 'and the hidden record survives (was: DESTROYED)');
    });

    test('[DEFECT] #222/#236 — the /archived deny survives the migration to the access context, over the real router', async function(assert) {
      // THE TRAP THIS STORY EXISTS TO NOT FALL INTO. #213's original AC1
      // forbade `request.path` in the migrated sample. README "What the context
      // does not tell you: which surface" -- text #202 itself shipped --
      // records that six owner surfaces produce one identical context:
      //
      //   GET /owners                          { model: 'owner', operation: 'read' }
      //   GET /owners/gina                     { model: 'owner', operation: 'read' }
      //   GET /owners/archived                 { model: 'owner', operation: 'read' }
      //
      // So the `/archived` deny COULD NOT be expressed from the context alone,
      // and the migrated sample was a HYBRID: `model` and `operation` from the
      // context, `request.path` for which sub-path.
      //
      // SUPERSEDED BY abofs/stonyx-orm#236, AND THE TRAP IT NAMES STILL HOLDS.
      // #236 added `recordId` — the DECODED route-parameter id — to that
      // context, so the deny IS now expressible from the context alone and the
      // read of `request.path` is gone. What has not changed is the reason this
      // test exists: dropping the rule does not fail loudly, it converts a DENY
      // into an ALLOW silently, and every other assertion in the suite stays
      // green while it does.
      //
      // Over the real router, because that is the only tier that proves express
      // populates `request.path` the way the predicate assumes -- a fabricated
      // request is the harness fail-open variant 5 survived four review rounds
      // inside.
      //
      // AND THERE IS A REAL RECORD BEHIND THE DENY. Until the #227 fix round
      // there was not: no fixture carried an owner with id `archived`, so every
      // assertion here was a 403 raised on behalf of a record that does not
      // exist, and the deny-to-allow mutation this test exists to catch was
      // measured at 404 rather than 200. Seeded by this module's `before`.
      //
      // "BEHIND THE DENY" IS NOT "PROTECTED BY IT", AND THE DIFFERENCE IS
      // MEASURED. The `/archived` rule is a SURFACE deny on one path, not record
      // protection: the sample's per-record filter rejects `angela` and
      // `restricted` only, so `GET /owners` returns this same record IN FULL
      // through the authorised collection route (measured over a raw socket:
      // 200, body carries `"secret"`). Nothing here asserts otherwise. A reader
      // who takes the 403 below as evidence the record is protected will not add
      // the protection they actually need — if you want that, widen the
      // per-record filter, which is a different mechanism from this deny.
      assert.ok(store.get('owner', ARCHIVED_OWNER),
        'precondition: the record the /archived deny refuses on really does exist in the store');

      const archived = await fetch(`${endpoint}/owners/archived`);
      assert.equal(archived.status, 403,
        'GET /owners/archived is 403 — the sub-path deny still fires (a context-only migration turns this into a 200 carrying the record in full)');

      const nested = await fetch(`${endpoint}/owners/archived/2024`);
      assert.equal(nested.status, 403, 'and so is a path beneath it');

      // RE-SPECIFIED BY abofs/stonyx-orm#237, AND IT IS NOT AN INVERSION —
      // the behaviour pinned here was never correct in EITHER direction.
      //
      // It asserted that `GET /owners/ARCHIVED` is 403, on the reasoning that
      // the router matched case-insensitively so the rule had to as well. That
      // reasoning confuses two different things: `case sensitive routing`
      // governs literal route SEGMENTS, and `archived` is not a segment, it is
      // the value of `:id`. Case-folding a route-parameter VALUE over-matches
      // the router rather than matching it.
      //
      // Measured, with a distinct owner now really seeded at `ARCHIVED`: the
      // `.toLowerCase()` this pin protected produced a false DENY here — 403 on
      // a record the `/archived` rule was never about — while simultaneously
      // producing a false ALLOW on `GET /owners/%41RCHIVED`, the encoded
      // spelling of that same record. One line, both errors, in opposite
      // directions. Until #237 there was no record at this id at all, so the
      // 403 could not be told apart from a 404 and the wrong contract survived
      // three rounds of review.
      //
      // The correct contract: an `/archived` rule denies the record `archived`
      // and nothing else. Both spellings of the DISTINCT record agree, and
      // neither is denied — asserted in full by the #237 test below.
      const cased = await fetch(`${endpoint}/owners/ARCHIVED`);
      assert.equal(cased.status, 200,
        'a DIFFERENT record whose id differs only in case is NOT denied by the /archived rule (was: 403 — a false deny on the wrong record, pinned as if it were correct)');
      assert.ok((await cased.text()).includes('"uppercase-secret"'),
        'and it really is the other record that came back, not the one behind the deny');

      // A DENIED DELETE MUST NOT DESTROY THE RECORD. Status alone is not
      // sufficient evidence on a destructive verb.
      const destroy = await fetch(`${endpoint}/owners/archived`, { method: 'DELETE' });

      assert.equal(destroy.status, 403, 'DELETE /owners/archived is 403');
      assert.ok(store.get('owner', ARCHIVED_OWNER), 'and the record survives the attempt');

      // OVER A RAW SOCKET, IN ABSOLUTE FORM. `fetch()` always sends origin-form,
      // and the only other absolute-form `/archived` coverage in the tree
      // HAND-SUPPLIES `request.path` — which is the one field of argument one
      // this predicate still reads, so a fabricated request is precisely the
      // harness variant 5 survived four review rounds inside. This closes it at
      // the tier that proves what express actually populates: measured on
      // express 5.2.1, `req.path` is normalised out of the absolute form while
      // `req.url` is not.
      const absolute = await rawRequest('GET', `http://anything.example/owners/${ARCHIVED_OWNER}`);

      assert.equal(absolute.status, 403,
        'an absolute-form GET on /owners/archived is 403 too — express normalises request.path, which is what the deny reads');
      assert.notOk(absolute.body.includes('"secret"'), 'and the response does not carry the record');

      // ---------------------------------------------------------------------
      // abofs/stonyx-orm#228 — THE TRIPWIRE, INVERTED. CLOSED BY #236/#237.
      //
      // #222 planted two assertions here written to the MEASURED DEFECTIVE
      // state, labelled `DEFECT #228:` and carrying the instruction "when #228
      // lands, these two red and must be inverted to 403 / not-present. Do not
      // 'repair' them by deleting them." This is that inversion, and the
      // instruction was followed literally: both assertions are still here, at
      // the same tier, over the same socket, with the same inputs. Only the
      // expected values moved.
      //
      // WHAT THE DEFECT WAS. Express sets `request.path` from the RAW, undecoded
      // pathname while the router DECODES `:id`, so the predicate compared an
      // undecoded string against a decoded dispatch and `%61rchived` walked
      // straight past the deny. #236 put the decoded id on the access context
      // as `recordId`; #237 made the sample compare against it. The predicate
      // and the dispatch now read one value.
      //
      // MEASURED HERE ON THE DEFECTIVE HEAD, for the record: 200 with the body
      // carrying `"secret"`, and `DELETE` answered 204 with the record
      // destroyed. The DELETE half was deliberately not probed by #222 because
      // it destroys the fixture; it is probed in full, with the survival check
      // AFTER the response, by the #237 test immediately below.
      //
      // THE NEGATIVE CONTROLS BELOW ARE WHAT KEEP THIS FROM BEING SATISFIABLE
      // BY DENY-ALL, and they matter more after the inversion than before: two
      // assertions expecting 403 are trivially satisfied by a broken router.
      const encoded = await rawRequest('GET', '/owners/%61rchived');

      assert.equal(encoded.status, 403,
        'GET /owners/%61rchived is 403 — percent-encoding no longer steps around the deny (was: 200, and this assertion was pinned to that 200 as the #228 tripwire)');
      assert.notOk(encoded.body.includes('"secret"'),
        'and the record does not come back through a route the deny refuses (was: it did, in full)');

      // The negative control for the pair above: the canonical spelling of the
      // same target, over the same socket, is still refused. Without it the two
      // assertions are satisfiable by a router that 200s everything.
      const canonical = await rawRequest('GET', '/owners/archived');

      assert.equal(canonical.status, 403, 'while the canonical spelling over the same socket is still 403');

      // CONFIRM THE CHECK COULD FAIL. A 403 for every /owners request would
      // satisfy the assertions above and mean nothing, so this pins that the
      // same mount, one segment different, is NOT denied: it is authorised and
      // then filtered per-record, which is a different mechanism with a
      // different status.
      const visible = await fetch(`${endpoint}/owners/gina`);
      const filtered = await fetch(`${endpoint}/owners/angela`);

      assert.equal(visible.status, 200, 'a normal owner record on the same mount is 200, so the 403s above are not a blanket deny');
      assert.equal(filtered.status, 404, 'and a record the per-record filter rejects is 404, not 403 — the two mechanisms stay distinguishable');
    });

    test('#237 — the /archived deny follows the RECORD, not the spelling, and a denied DELETE destroys nothing', async function(assert) {
      // THE SECURITY CLOSE, over a raw socket against the live router.
      //
      // `fetch()` cannot express most of what has to be measured here: it
      // percent-normalises the target, and RFC 9112 3.2.2 absolute-form is
      // unreachable through it entirely. Every probe below is therefore a raw
      // socket, and every assertion prints its INPUT beside the answer.
      //
      // WHY NOT AN ENUMERATION OF SPELLINGS. `archived` is 8 characters, each
      // independently percent-encodable, so 255 non-canonical spellings decode
      // to the same key. A deny-list is the wrong shape and an AC enumerating
      // spellings would be the wrong AC. What is asserted is the DECODED
      // COMPARISON: five spellings are sampled to show the rule is not
      // character-positional, and the contract they sample is "the verdict
      // follows the record".
      // AC1 + AC2 — THE BYPASS, CLOSED, ACROSS FIVE SPELLINGS. One encodes the
      // first character, one a middle character, one the last, one encodes
      // every character, and one adds a trailing slash — so a fix that
      // special-cased a leading `%` or anchored on an exact string reds here.
      for (const target of [
        '/owners/%61rchived',
        '/owners/a%72chived',
        '/owners/archive%64',
        '/owners/%61%72%63%68%69%76%65%64',
        '/owners/%61rchived/',
        '/owners/%61rchived?filter[age]=99',
        'http://anything.example/owners/%61rchived',
        '/OWNERS/%61rchived',
      ]) {
        const response = await rawRequest('GET', target);

        assert.equal(response.status, 403, `INPUT GET ${target} -> 403 (all eight were 200 on the defective head)`);
        assert.notOk(response.body.includes('"secret"'), `INPUT GET ${target}: and the record does not come back in full`);
      }

      // AC3 — THE DESTRUCTIVE VERB, AND THE STATUS IS NOT SUFFICIENT EVIDENCE.
      // The measured failure was 204 WITH THE RECORD DESTROYED, so the store is
      // read AFTER the response, not before it. A fix that answered 403 and
      // still deleted would pass on status alone.
      assert.ok(store.get('owner', ARCHIVED_OWNER), 'precondition: the record is in the store before the denied DELETE');

      const destroy = await rawRequest('DELETE', '/owners/%61rchived');

      assert.equal(destroy.status, 403, 'INPUT DELETE /owners/%61rchived -> 403 (was: 204)');
      assert.ok(store.get('owner', ARCHIVED_OWNER), 'and the record is STILL IN THE STORE after the response (was: DESTROYED, unauthenticated)');

      // AC4 — BOTH RELATIONSHIP SURFACES. A fix expressed as a rule about the
      // `/:id` route alone leaves these at 200 — measured on the defective head.
      // `recordId` is the same value on all three surfaces, so one rule covers
      // them without a `startsWith` clause.
      for (const target of ['/owners/%61rchived/pets', '/owners/%61rchived/relationships/pets']) {
        const response = await rawRequest('GET', target);

        assert.equal(response.status, 403, `INPUT GET ${target} -> 403 (was: 200)`);
      }

      // AC5 — EXACTLY ONE DECODE, AND THIS IS THE ASSERTION A NAIVE FIX FAILS.
      // Express decodes a route parameter once. `%2561rchived` is the literal,
      // LEGITIMATE id `%61rchived` — a record this rule was never about. A fix
      // that decoded until stable would answer 403 here, which is a NEW false
      // deny introduced by the fix for a false allow.
      const doubled = await rawRequest('GET', '/owners/%2561rchived');

      assert.equal(doubled.status, 404,
        'INPUT GET /owners/%2561rchived -> 404, NOT 403 — double-encoding is a different id, not a second-order spelling of this one');

      // AC6 — THE CASE CONTRACT, IN BOTH DIRECTIONS, AGAINST A REAL RECORD.
      // This is the pair that refutes `.toLowerCase()`. `ARCHIVED` is a
      // DISTINCT owner, seeded by this module. Under the case-folding rule the
      // canonical spelling was 403 (a false deny on the wrong record) and the
      // encoded spelling was 200 (a false allow on that same record) — the two
      // spellings of one record DISAGREED, which is the tell that the matcher
      // was normalising on a different axis from the router.
      assert.ok(store.get('owner', ARCHIVED_UPPER), 'precondition: a DISTINCT owner really is seeded at id ARCHIVED');

      const upper = await rawRequest('GET', '/owners/ARCHIVED');
      const upperEncoded = await rawRequest('GET', '/owners/%41RCHIVED');

      assert.equal(upper.status, 200, 'INPUT GET /owners/ARCHIVED -> 200 — a distinct record, and the /archived rule is not about it (was: 403)');
      assert.equal(upperEncoded.status, 200, 'INPUT GET /owners/%41RCHIVED -> 200 — the same record, encoded (was: 200 too, but for the wrong reason)');
      assert.strictEqual(upper.status, upperEncoded.status,
        'and the two spellings of ONE record now AGREE — under .toLowerCase() they were 403 and 200, wrong in opposite directions');
      assert.ok(upper.body.includes('"uppercase-secret"'), 'and it is really the other record that came back');

      // AND A DECODED SEPARATOR IS STILL ONE ID. The router splits THEN decodes,
      // so `archived%2fx` is the single id `archived/x` — a genuinely distinct
      // record. `decodeURIComponent(request.path)` decodes THEN splits and
      // over-denied it 403; measured. 404 is the honest answer.
      const separator = await rawRequest('GET', '/owners/archived%2fx');

      assert.equal(separator.status, 404,
        'INPUT GET /owners/archived%2fx -> 404 — a distinct record, not over-denied (a whole-path decode answers 403 here)');

      // AC7 — NEGATIVE CONTROLS. Six assertions expecting 403 are satisfiable
      // by a router that denies everything, so this pins that the same mount,
      // one segment different, is not denied — and that the per-record filter
      // stays a DIFFERENT mechanism with a different status.
      const canonical = await rawRequest('GET', '/owners/archived');
      const permitted = await rawRequest('GET', '/owners/gina');
      const filtered = await rawRequest('GET', '/owners/angela');
      const collection = await rawRequest('GET', '/owners');

      assert.equal(canonical.status, 403, 'INPUT GET /owners/archived -> 403 — the canonical spelling is still refused');
      assert.equal(permitted.status, 200, 'INPUT GET /owners/gina -> 200 — so the 403s above are not a blanket deny');
      assert.equal(filtered.status, 404, 'INPUT GET /owners/angela -> 404, not 403 — the per-record filter stays distinguishable from the deny');
      assert.equal(collection.status, 200,
        'INPUT GET /owners -> 200 — the collection route carries recordId `null`, and a guard written as `if (!recordId)` would 403 it');

      // DEFECT #243: AND THE COLLECTION ROUTE DISCLOSES THE RECORD THIS WHOLE
      // TEST EXISTS TO REFUSE. Pinned to the CURRENT, LEAKY behaviour on
      // purpose, in the #222 form: a deliberate tripwire, labelled, so the gap
      // cannot be closed silently and cannot regress unnoticed. INVERT these
      // three assertions when abofs/stonyx-orm#243 lands; do not delete them.
      //
      // The narration this test carries -- "the deny follows the RECORD, not
      // the spelling" -- is true of every surface addressed to the record, and
      // NOT true of the collection. The fixture hides `archived` with
      // `return false`, which is REQUEST-scoped, while the per-record filter
      // (which is record-scoped) names only `angela` and `restricted`. So the
      // record the eight body assertions above prove cannot be read at
      // /owners/{id} in any of 255 spellings comes back here in full, with its
      // `gender: 'secret'`, unauthenticated.
      //
      // Pre-existing on origin/dev at c5f7907, re-measured there: not a
      // regression from #236/#237. It is pinned HERE because #236/#237
      // re-specified the rule as record-scoped, which is what makes the
      // collection surface a contradiction rather than a different path.
      assert.ok(collection.body.includes('"secret"'),
        'DEFECT #243: GET /owners returns the `archived` record IN FULL, including `"gender":"secret"` — the /archived deny is request-scoped and the collection route does not carry it (invert this when #243 lands)');
      assert.ok(collection.body.includes('"archived"'),
        'DEFECT #243: and its id is disclosed in the same body, so this is not a partial projection (invert this when #243 lands)');

      // THE NEGATIVE CONTROL, and it is what makes the two above a statement
      // about the MECHANISM rather than about the route: the per-record filter
      // DOES reach this body. `angela` is removed from it. One collection
      // response, two records the fixture means to withhold, one of them
      // withheld.
      assert.notOk(collection.body.includes('"angela"'),
        'while `angela` — withheld by the RECORD-scoped filter rather than by the request-scoped deny — is absent from that same body, which is what makes #243 a mechanism gap and not a route gap');

      // AC8 — MALFORMED AND OVER-LONG ESCAPES ARE THE ROUTER'S ANSWER, NOT THE
      // PREDICATE'S. Express rejects these with 400 BEFORE `auth()` runs —
      // verified in refinement with an instrumented wrapper that never fired.
      // Asserted as 400 rather than 403 precisely so a predicate that started
      // throwing on them would be visible: `auth()` turns a throw into a 403,
      // so the two statuses tell those cases apart.
      for (const target of ['/owners/%c1%a1rchived', '/owners/%e0%81%a1rchived', '/owners/%zz', '/owners/%', '/owners/%6']) {
        const response = await rawRequest('GET', target);

        assert.equal(response.status, 400,
          `INPUT GET ${target} -> 400 at the router, not 403 from the predicate — over-long UTF-8 and malformed escapes never reach auth()`);
      }
    });

    test('[DEFECT] a denied write runs no consumer hook, over the real dispatch', async function(assert) {
      // The published extension point. Measured firing at 2101335: a denied
      // DELETE returned 404, the record survived, sqlDb.persist was correctly
      // skipped — and beforeDelete/afterDelete still fired with
      // context.recordId = 21 and context.oldState carrying the hidden record's
      // full contents. `afterHook('delete', ctx => cascadeDelete(ctx.recordId))`
      // destroys children behind a correct 404.
      // NOTE: every callback below has a BLOCK body on purpose. A before-hook
      // that returns anything other than undefined halts the operation and
      // becomes the response, and `Array.prototype.push` returns a number — so a
      // concise-body `ctx => fired.push(...)` silently turns into
      // "halt and respond with 1", which the rest server answers as a 500.
      const fired = [];
      const unsubscribes = [
        beforeHook('delete', 'animal', ctx => { fired.push({ phase: 'before', op: 'delete', id: ctx.recordId, oldState: ctx.oldState }); }),
        afterHook('delete', 'animal', ctx => { fired.push({ phase: 'after', op: 'delete', id: ctx.recordId, oldState: ctx.oldState }); }),
        beforeHook('update', 'animal', ctx => { fired.push({ phase: 'before', op: 'update', oldState: ctx.oldState }); }),
        afterHook('update', 'animal', ctx => { fired.push({ phase: 'after', op: 'update', oldState: ctx.oldState }); }),
      ];

      try {
        const deleted = await fetch(`${endpoint}/animals/${HIDDEN}`, { method: 'DELETE' });
        const patched = await fetch(`${endpoint}/animals/${HIDDEN}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ data: { type: 'animal', id: HIDDEN, attributes: { age: 999 } } })
        });

        assert.equal(deleted.status, 404, 'denied delete is 404');
        assert.equal(patched.status, 404, 'denied patch is 404');
        assert.ok(store.get('animal', HIDDEN), 'the hidden record survives');
        assert.equal(fired.length, 0, 'no hook fired for either denied write (was: 4)');
        assert.notOk(fired.some(f => f.oldState), 'no hook received the hidden record contents as oldState');
      } finally {
        unsubscribes.forEach(unsubscribe => unsubscribe());
      }
    });

    test('[GUARD] an ALLOWED write still runs its hooks, over the real dispatch', async function(assert) {
      // Proves the assertion above can fail in the opposite direction.
      const fired = [];
      const unsubscribes = [
        beforeHook('update', 'animal', () => { fired.push('before'); }),
        afterHook('update', 'animal', ctx => { fired.push(ctx.response ? 'after' : 'after-no-response'); }),
      ];

      try {
        const response = await fetch(`${endpoint}/animals/${VISIBLE}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ data: { type: 'animal', id: VISIBLE, attributes: { age: 6 } } })
        });

        assert.equal(response.status, 200, 'allowed patch succeeds');
        assert.deepEqual(fired, ['before', 'after'], 'both hooks fired exactly once, with a response in context');
      } finally {
        unsubscribes.forEach(unsubscribe => unsubscribe());
        store.get('animal', VISIBLE).age = 5;
      }
    });

    test('[GUARD] an allowed DELETE still works (over-blocking)', async function(assert) {
      const response = await fetch(`${endpoint}/animals/${VISIBLE}`, { method: 'DELETE' });

      assert.equal(response.status, 204, 'allowed delete is still 204');
      assert.notOk(store.get('animal', VISIBLE), 'the record was removed');
    });

  // ===========================================================================
  // #202 — access(request, { model, operation }) AND the model->predicate
  // registry surviving boot.
  //
  // The tier each AC runs at is fixed by the refinement (issue #202,
  // "Refinement — revised (Sprint 83)", §6/§7) and is NOT the implementer's
  // choice: anything that depends on request shape runs over the LIVE express
  // router, because test/unit/access-filter-enforcement-test.ts's `makeRequest`
  // fabricates `baseUrl`/`path` itself and variant 5 survived four review
  // rounds inside that harness.
  //
  // AC4 (context shape) and AC6 (static) live in
  // test/unit/access-context-test.ts — they do not depend on the router.
  //
  // ---------------------------------------------------------------------------
  // WHY THIS MODULE MOUNTS ITS OWN ROUTES
  //
  // Every AC below needs a MIGRATED predicate — one that reads `context` instead
  // of the URL — enforcing over the real router. There is no such predicate in
  // the tree: `test/sample/access/global-access.ts` is arity-1 and stays that
  // way through #202, because migrating it in lockstep with the README copy is
  // #213 and assertion 46 pins the two together (refinement §3). The refinement
  // states that consequence and accepts it: "AC1 must be exercised with a
  // test-local migrated predicate".
  //
  // So this module mounts extra routes through the SAME production call
  // `setup-rest-server.ts:82` makes — `RestServer.instance.mountRoute(OrmRequest,
  // { name, options: { model, access } })` — onto the SAME express app that is
  // already listening, and drives them over real HTTP. Nothing here fabricates a
  // request: express routes it, express builds `req`, and `auth()` is reached
  // through @stonyx/rest-server's dispatcher.
  //
  // The mount names are deliberately NOT the pluralised model name. A framework
  // that derived `context.model` from the URL, the mount, or the route name
  // would hand these predicates `'ctx-animals'`, every `model === 'animal'` test
  // would stop matching, and this module goes red — which is precisely the
  // mutant AC1 names.
  //
  // `OrmRequest` is imported from `dist/` rather than `src/`: `dist` is what the
  // running app mounted, and the source copy would carry its OWN `store` module
  // instance, so a route mounted from it would serve a different (empty) store.
  // ===========================================================================
  module('Access Context and Registry (#202)', function(ctxHooks) {
    // Subjects owned by this module. The #190 module above destroys its own
    // VISIBLE subject in its last test, so nothing here may lean on it.
    const CTX_HIDDEN = 7850;     // owned by `restricted` — must be filtered out
    const CTX_VISIBLE = 7851;    // owned by gina         — must survive the filter
    const CTX_DOOMED = 7852;     // created and deleted by the AC2 delete pass
    const SHIPPED_HIDDEN = 21;   // the shared fixture's hidden animal
    const SHIPPED_VISIBLE = 13;  // gina's cat, visible on /animals

    // The four operation verbs, and the only four (src/orm-request.ts:100-105).
    const VERBS = ['read', 'create', 'update', 'delete'];

    // Mount names. `api/` on the second one reproduces the shape
    // setup-rest-server builds under a configured ORM_REST_ROUTE
    // (`${name}/${pluralizedModel}`), which is fail-open variant 4.
    const CTX_MOUNT = 'ctx-animals';
    const CTX_PREFIXED_MOUNT = 'api/ctx-animals';
    const OP_MOUNT = 'ctx-op-animals';
    const READONLY_MOUNT = 'ctx-readonly-animals';
    const LEGACY_MOUNT = 'ctx-legacy-animals';
    const DENY_MOUNT = 'ctx-denied-animals';
    const BROKEN_MOUNT = 'ctx-broken-animals';

    // Every context the URL-free predicate was handed, with the live request
    // object that came with it.
    const observed = [];
    // Set by AC4 only: called at the instant `auth()` invokes the predicate.
    let authTimeProbe = null;

    // THE MIGRATED PREDICATE. It reads NO field of `request` — the parameter is
    // not even named — so mount-relativity, query strings, case, an
    // ORM_REST_ROUTE prefix and an absolute-form target cannot reach it by
    // construction. Everything it decides on comes from the second argument.
    function urlFreeAnimalAccess(_request, context) {
      observed.push({ context, request: _request });
      if (authTimeProbe) authTimeProbe();

      // Fail CLOSED on anything it cannot identify, so a framework that stopped
      // supplying the context — or supplied a model derived from the URL — is
      // 403 here rather than falling through to a grant.
      if (!context || context.model !== 'animal') return false;
      if (!VERBS.includes(context.operation)) return false;

      return record => record.owner?.id !== 'restricted';
    }

    // AC2/AC5: echoes the operation the framework supplied straight back as the
    // permission-array form. The request is permitted if and only if
    // `context.operation` is the SAME string `methodAccessMap[request.method]`
    // produces — so a framework emitting 'GET', 'list' or 'index' turns every
    // request on this route into a 403.
    const operationLog = [];
    function operationEchoAccess(request, context) {
      operationLog.push({
        method: request.method,
        operation: context.operation,
        hasOperationKey: 'operation' in context,
        model: context.model,
      });

      if (context.operation === undefined) return false;

      return [context.operation];
    }

    // AC2: the array form, written by hand in the same vocabulary.
    const readOnlyAccess = () => ['read'];

    // AC3: an UNMIGRATED, single-argument predicate — the shape every consumer
    // has today, and the shape the shipped fixture still has. It reads argument
    // ONE and nothing else. Deliberately the same fail-closed shape as
    // test/sample/access/global-access.ts:98-108.
    function legacySingleArgAccess(request) {
      const mount = request.baseUrl;
      if (typeof mount !== 'string' || mount === '') return false;

      return record => record.owner?.id !== 'restricted';
    }

    // AC7: the negative controls.
    const denyAccess = () => false;
    const brokenShapeAccess = () => 42;

    // Raw socket, for the absolute-form request target `fetch()` cannot express
    // (RFC 9112 3.2.2). Same shape as the variant-5 assertion above.
    function rawRequest(method, target, host = 'localhost') {
      const { port } = config.restServer;

      return new Promise((resolve, reject) => {
        const socket = net.connect(port, '127.0.0.1', () => {
          socket.write(`${method} ${target} HTTP/1.1\r\nHost: ${host}\r\nConnection: close\r\n\r\n`);
        });
        let buffer = '';
        socket.setTimeout(5000, () => { socket.destroy(); reject(new Error('raw request timed out')); });
        socket.on('data', chunk => { buffer += chunk; });
        socket.on('end', () => resolve({
          status: Number(buffer.split('\r\n')[0].split(' ')[1]),
          body: buffer.split('\r\n\r\n').slice(1).join('\r\n\r\n'),
        }));
        socket.on('error', reject);
      });
    }

    const seedAnimal = (id, owner, age = 4) => {
      if (!store.get('animal', id)) {
        createRecord('animal', { id, type: 1, age, size: 'small', owner, traits: [] }, { serialize: false, _skipAutoPersist: true });
      }
    };

    const animalIds = () => Array.from(store.get('animal').keys());

    // The registry as the BOOT left it, read before any test can touch it. AC8
    // asserts against the live `Orm.instance`; this is only used to restore it.
    let bootAnimalAccess;
    // Express router depth before this module mounted anything, so `after()`
    // can put the live app back exactly as it found it.
    let stackDepth;

    const expressRouter = () => RestServer.instance.api.router ?? RestServer.instance.api._router;

    ctxHooks.before(function() {
      seedAnimal(CTX_HIDDEN, 'restricted', 9);
      seedAnimal(CTX_VISIBLE, 'gina', 5);

      bootAnimalAccess = Orm.instance.accessFunctions.animal;
      stackDepth = expressRouter().stack.length;

      // The same call setup-rest-server.ts:82 makes, onto the same app.
      for (const [name, access] of [
        [CTX_MOUNT, urlFreeAnimalAccess],
        [CTX_PREFIXED_MOUNT, urlFreeAnimalAccess],
        [OP_MOUNT, operationEchoAccess],
        [READONLY_MOUNT, readOnlyAccess],
        [LEGACY_MOUNT, legacySingleArgAccess],
        [DENY_MOUNT, denyAccess],
        [BROKEN_MOUNT, brokenShapeAccess],
      ]) {
        RestServer.instance.mountRoute(OrmRequest, { name, options: { model: 'animal', access } });
      }
    });

    ctxHooks.after(function() {
      // Unmount, so no later module is served by a route this one added.
      expressRouter().stack.length = stackDepth;
      Orm.instance.accessFunctions.animal = bootAnimalAccess;
      authTimeProbe = null;

      for (const id of animalIds()) {
        if (typeof id === 'number' && id >= 7850 && id <= 7899) store.remove('animal', id, { _skipAutoPersist: true });
      }
    });

    test('AC1 — a URL-free predicate enforces access on all seven surfaces, over the live router', async function(assert) {
      // The seven surfaces are enumerated in README.md's `### Breaking changes`,
      // item 4 -- named rather than numbered, because the line citation that
      // stood here (`README.md:408-416`) pointed at the GlobalAccess sample and
      // had done since before dev @ 8dda5d6. The predicate under test
      // reads NOTHING off the request, so if the framework does not supply a
      // correct `context.model` it fails closed and every 200 below turns into
      // a 403 — and if the framework supplied a model derived from the URL it
      // would be 'ctx-animals', which is the same failure.
      const single = await fetch(`${endpoint}/${CTX_MOUNT}/${CTX_VISIBLE}`);
      const hiddenSingle = await fetch(`${endpoint}/${CTX_MOUNT}/${CTX_HIDDEN}`);

      assert.equal(single.status, 200, 'surface 2: GET /:id on a permitted record is 200');
      assert.equal(hiddenSingle.status, 404, 'surface 2: and 404 on a filtered one — same status as a record that does not exist');

      const collection = await fetch(`${endpoint}/${CTX_MOUNT}`);
      const { data } = await collection.json();

      assert.equal(collection.status, 200, 'surface 1: GET /:models is 200');
      assert.ok(data.some(record => Number(record.id) === CTX_VISIBLE), 'surface 1: and carries the permitted record');
      assert.notOk(data.some(record => Number(record.id) === CTX_HIDDEN), 'surface 1: and NOT the filtered one');
      assert.notOk(data.some(record => Number(record.id) === SHIPPED_HIDDEN), 'surface 1: nor the fixture animal owned by `restricted`');

      const related = await fetch(`${endpoint}/${CTX_MOUNT}/${CTX_VISIBLE}/owner`);
      const hiddenRelated = await fetch(`${endpoint}/${CTX_MOUNT}/${CTX_HIDDEN}/owner`);
      const linkage = await fetch(`${endpoint}/${CTX_MOUNT}/${CTX_VISIBLE}/relationships/owner`);
      const hiddenLinkage = await fetch(`${endpoint}/${CTX_MOUNT}/${CTX_HIDDEN}/relationships/owner`);

      assert.equal(related.status, 200, 'surface 3: GET /:id/{rel} is 200 for a permitted parent');
      assert.equal(hiddenRelated.status, 404, 'surface 3: and 404 for a filtered one');
      assert.equal(linkage.status, 200, 'surface 4: GET /:id/relationships/{rel} is 200 for a permitted parent');
      assert.equal(hiddenLinkage.status, 404, 'surface 4: and 404 for a filtered one');

      const patch = (id, age) => fetch(`${endpoint}/${CTX_MOUNT}/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data: { type: 'animal', id, attributes: { age } } })
      });

      const hiddenAgeBefore = store.get('animal', CTX_HIDDEN).age;
      const deniedPatch = await patch(CTX_HIDDEN, 999);
      const allowedPatch = await patch(CTX_VISIBLE, 6);

      assert.equal(deniedPatch.status, 404, 'surface 5: PATCH on a filtered record is 404');
      assert.equal(store.get('animal', CTX_HIDDEN).age, hiddenAgeBefore, 'surface 5: and mutates nothing');
      assert.equal(allowedPatch.status, 200, 'surface 5: PATCH on a permitted record still works');
      assert.equal(store.get('animal', CTX_VISIBLE).age, 6, 'surface 5: and really did write');

      const idsBefore = animalIds();
      const deniedCreate = await fetch(`${endpoint}/${CTX_MOUNT}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data: { type: 'animal', attributes: { type: 1, age: 1, size: 'small', owner: 'restricted' } } })
      });
      const allowedCreate = await fetch(`${endpoint}/${CTX_MOUNT}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data: { type: 'animal', attributes: { type: 1, age: 1, size: 'small', owner: 'gina' } } })
      });

      assert.equal(deniedCreate.status, 403, 'surface 7: POST of a record the filter rejects is 403');
      assert.equal(allowedCreate.status, 200, 'surface 7: POST of a permitted record succeeds');

      for (const id of animalIds()) {
        if (!idsBefore.includes(id)) store.remove('animal', id, { _skipAutoPersist: true });
      }

      const deniedDelete = await fetch(`${endpoint}/${CTX_MOUNT}/${CTX_HIDDEN}`, { method: 'DELETE' });

      assert.equal(deniedDelete.status, 404, 'surface 6: DELETE on a filtered record is 404');
      assert.ok(store.get('animal', CTX_HIDDEN), 'surface 6: and the record survives');

      // The predicate really was consulted, really was handed the context, and
      // the model it was handed is the MODEL name — not the mount, not the
      // pluralised route name, not anything the caller could influence.
      const models = [...new Set(observed.map(entry => entry.context.model))];
      assert.deepEqual(models, ['animal'],
        'every call was told model `animal` — never the mount name `ctx-animals` (the mutant AC1 names)');
      assert.ok(observed.every(entry => VERBS.includes(entry.context.operation) || entry.context.operation === undefined),
        'and an operation from the four verbs');
    });

    test('AC1 — none of the five fail-open variants changes the outcome for a URL-free predicate', async function(assert) {
      // Variants 1-5, as listed in src/orm-request.ts and reproduced in the
      // shipped sample's header. Against a predicate that reads no URL these
      // cannot reach the decision at all — this measures that claim over the
      // live router rather than asserting it.
      const seenBefore = observed.length;

      // Variant 2 — query string.
      const queried = await fetch(`${endpoint}/${CTX_MOUNT}/${CTX_HIDDEN}?filter[age]=9`);
      const queriedCollection = await fetch(`${endpoint}/${CTX_MOUNT}?filter[size]=small`);
      const queriedData = (await queriedCollection.json()).data;

      assert.equal(queried.status, 404, 'variant 2: a query string does not un-hide the filtered record');
      assert.notOk(queriedData.some(record => Number(record.id) === CTX_HIDDEN), 'variant 2: nor on the collection');

      // Variant 3 — case. Express mounts case-INSENSITIVELY, so this routes.
      const upper = await fetch(`${endpoint}/${CTX_MOUNT.toUpperCase()}/${CTX_HIDDEN}`);
      const upperVisible = await fetch(`${endpoint}/${CTX_MOUNT.toUpperCase()}/${CTX_VISIBLE}`);

      assert.equal(upperVisible.status, 200, 'variant 3: the upper-cased path really does route to the same handler');
      assert.equal(upper.status, 404, 'variant 3: and the filtered record is still 404 through it');

      // Variant 4 — a mount prefix, the shape a configured ORM_REST_ROUTE
      // produces. Same predicate object, mounted twice.
      const prefixed = await fetch(`${endpoint}/${CTX_PREFIXED_MOUNT}/${CTX_HIDDEN}`);
      const prefixedVisible = await fetch(`${endpoint}/${CTX_PREFIXED_MOUNT}/${CTX_VISIBLE}`);

      assert.equal(prefixedVisible.status, 200, 'variant 4: the prefixed mount routes');
      assert.equal(prefixed.status, 404, 'variant 4: and the verdict is identical under it');

      // Variant 5 — an absolute-form request target, over a raw socket.
      const absolute = await rawRequest('GET', `http://anything.example/${CTX_MOUNT}/${CTX_HIDDEN}`);
      const absoluteVisible = await rawRequest('GET', `http://anything.example/${CTX_MOUNT}/${CTX_VISIBLE}`);

      assert.equal(absoluteVisible.status, 200, 'variant 5: the absolute-form target reaches the handler');
      assert.equal(absolute.status, 404, 'variant 5: and the filtered record is still 404');
      assert.notOk(absolute.body.includes('"restricted"'), 'variant 5: and the body does not carry the hidden record');

      // Variant 1 — `request.url` is mount-relative. Measured on the request
      // objects express actually built for the calls above, rather than
      // asserted: the condition that made variant 1 possible is present on
      // every one of them, and none of it reached the verdict.
      const calls = observed.slice(seenBefore);
      assert.ok(calls.length >= 8, 'the predicate was consulted for each of the requests above');

      const mountRelative = calls.filter(({ request }) => request.url !== request.originalUrl);
      assert.ok(mountRelative.length > 0,
        'variant 1: express really did hand the predicate a mount-relative `url` distinct from `originalUrl`');
      assert.ok(calls.some(({ request }) => String(request.originalUrl).includes('?')),
        'variant 2: and a raw target carrying a query string');
      assert.ok(calls.some(({ request }) => String(request.baseUrl).includes('/api/')),
        'variant 4: and a prefixed baseUrl');
      assert.ok(calls.some(({ request }) => String(request.originalUrl).includes('://')),
        'variant 5: and an absolute-form originalUrl');
      assert.deepEqual([...new Set(calls.map(({ context }) => context.model))], ['animal'],
        'and through all five, `context.model` never moved off `animal`');
    });

    test('AC2 — operation is one of read/create/update/delete and no second vocabulary, over the live router', async function(assert) {
      // The predicate on this mount returns `[context.operation]` — the
      // permission-ARRAY form, written in whatever vocabulary the framework
      // just used. `auth()` then checks that array against
      // `methodAccessMap[request.method]` twenty lines further down
      // (src/orm-request.ts:1187). So each request below is permitted if and
      // only if the two agree, and a framework emitting 'GET', 'list' or
      // 'index' turns every one of them into a 403.
      const before = operationLog.length;
      seedAnimal(CTX_DOOMED, 'gina');

      const read = await fetch(`${endpoint}/${OP_MOUNT}/${CTX_VISIBLE}`);
      const list = await fetch(`${endpoint}/${OP_MOUNT}`);
      const idsBefore = animalIds();
      const create = await fetch(`${endpoint}/${OP_MOUNT}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data: { type: 'animal', attributes: { type: 1, age: 2, size: 'small', owner: 'gina' } } })
      });
      const update = await fetch(`${endpoint}/${OP_MOUNT}/${CTX_VISIBLE}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data: { type: 'animal', id: CTX_VISIBLE, attributes: { age: 7 } } })
      });
      const destroy = await fetch(`${endpoint}/${OP_MOUNT}/${CTX_DOOMED}`, { method: 'DELETE' });

      assert.equal(read.status, 200, "GET /:id is permitted by an array holding the framework's own operation string");
      assert.equal(list.status, 200, 'and so is GET /:models');
      assert.equal(create.status, 200, 'POST is permitted by it');
      assert.equal(update.status, 200, 'PATCH is permitted by it');
      assert.equal(destroy.status, 204, 'DELETE is permitted by it');

      for (const id of animalIds()) {
        if (!idsBefore.includes(id)) store.remove('animal', id, { _skipAutoPersist: true });
      }

      const calls = operationLog.slice(before);
      const byMethod = {};
      for (const call of calls) byMethod[call.method] = call.operation;

      assert.deepEqual(byMethod, { GET: 'read', POST: 'create', PATCH: 'update', DELETE: 'delete' },
        'and the operation supplied for each dispatched method is the four-verb one');
      assert.ok(calls.every(call => VERBS.includes(call.operation)),
        "no second vocabulary: never 'GET', never 'list', never 'index'");

      // The same four strings, written by hand in the ARRAY form, decide the
      // same way — which is what "one vocabulary" means operationally.
      const readable = await fetch(`${endpoint}/${READONLY_MOUNT}/${CTX_VISIBLE}`);
      const writable = await fetch(`${endpoint}/${READONLY_MOUNT}/${CTX_VISIBLE}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data: { type: 'animal', id: CTX_VISIBLE, attributes: { age: 8 } } })
      });
      const removable = await fetch(`${endpoint}/${READONLY_MOUNT}/${CTX_VISIBLE}`, { method: 'DELETE' });

      assert.equal(readable.status, 200, "a hand-written ['read'] permits the request the framework called `read`");
      assert.equal(writable.status, 403, 'and refuses the one it called `update`');
      assert.equal(removable.status, 403, 'and the one it called `delete`');
      assert.ok(store.get('animal', CTX_VISIBLE), 'the refused delete removed nothing');
    });

    test('AC3 — an existing single-argument predicate is unchanged by the new second argument', async function(assert) {
      // The breaking form of this change would have put the context in argument
      // ONE. Per fail-open variant 1, a predicate that can no longer match its
      // collection falls through to the full CRUD grant — so the "safer"
      // breaking change converts every unmigrated predicate into a fail-open.
      // This is the assertion that stops it.
      assert.equal(legacySingleArgAccess.length, 1, 'the subject really is a single-argument predicate');

      const visible = await fetch(`${endpoint}/${LEGACY_MOUNT}/${CTX_VISIBLE}`);
      const hidden = await fetch(`${endpoint}/${LEGACY_MOUNT}/${CTX_HIDDEN}`);
      const collection = await fetch(`${endpoint}/${LEGACY_MOUNT}`);
      const { data } = await collection.json();

      // Under the breaking mutant `request.baseUrl` is undefined, the fail-closed
      // guard fires, and this 200 becomes a 403. Without the guard it becomes a
      // full grant and the 404 below becomes a 200.
      assert.equal(visible.status, 200, 'argument ONE is still the request: the mount check still matches');
      assert.equal(hidden.status, 404, 'and the per-record filter it returns is still enforced');
      assert.notOk(data.some(record => Number(record.id) === CTX_HIDDEN), 'on the collection too');

      // TRIPWIRE, INVERTED BY #222. This read `.length, 1` with the comment
      // "still arity-1, deliberately (its migration is #213)" — a deliberate
      // tripwire so that migrating the fixture could not happen silently. The
      // fixture is migrated, so the pin is INVERTED rather than deleted, and it
      // still measures the LIVE BOOT REGISTRY rather than the imported class.
      //
      // Two parameters and no default: `access(request, ctx = {})` would report
      // `length === 1` here and would trip #221's boot-time arity warning on the
      // shipped sample.
      //
      // Deleting this line is not a pass. A companion assertion in
      // test/unit/access-sample-migration-test.ts reads THIS FILE and asserts
      // the literal below is present, so removing it reds a different file. It
      // is deliberately cross-file: an assertion that a pin exists cannot live
      // beside the pin, because deleting both would be silent.
      assert.equal(Orm.instance.getAccess('animal').length, 2,
        'the shipped predicate in the live registry declares the two-argument contract');

      const shippedHidden = await fetch(`${endpoint}/animals/${SHIPPED_HIDDEN}`);
      const shippedVisible = await fetch(`${endpoint}/animals/${SHIPPED_VISIBLE}`);

      assert.equal(shippedHidden.status, 404, 'and it still hides animal 21 on the real /animals route');
      assert.equal(shippedVisible.status, 200, 'while still serving a visible one');
    });

    test('AC4 — no store read is introduced at auth time by a full request through the live router', async function(assert) {
      // The mutant: an implementer reads the issue body's superseded
      // `{ model, operation, record }` text and adds a lookup at
      // src/orm-request.ts:1160 to populate it. That is a store hit on every
      // request, in the middle of an authorization path.
      const findSpy = sinon.spy(store, 'find');
      const getSpy = sinon.spy(store, 'get');
      let atAuthTime = null;

      authTimeProbe = () => {
        atAuthTime = { find: findSpy.callCount, get: getSpy.callCount };
      };

      try {
        findSpy.resetHistory();
        getSpy.resetHistory();

        const response = await fetch(`${endpoint}/${CTX_MOUNT}/${CTX_VISIBLE}`);

        assert.equal(response.status, 200, 'a full record request over the live router succeeded');
        assert.deepEqual(atAuthTime, { find: 0, get: 0 },
          'and NOTHING had been read out of the store when access() was called');

        // Confirms the check could have failed: the same spies do see the reads
        // the handler makes after auth, so a zero at auth time is a measurement
        // and not a dead counter.
        assert.ok(findSpy.callCount + getSpy.callCount > 0,
          'while the handler, downstream of auth, does read the store through these same spies');
      } finally {
        authTimeProbe = null;
        findSpy.restore();
        getSpy.restore();
      }

      const contexts = observed.map(entry => entry.context);
      assert.ok(contexts.every(context => !('record' in context)),
        'and no context handed to the predicate over this whole module ever carried a `record` key');
    });

    test('AC5 — the context never fabricates an operation for a method express delivers but methodAccessMap does not map', async function(assert) {
      // MEASURED, not assumed (refinement §4): express delivers HEAD to the GET
      // handler, so an unmapped method really does reach auth(); PUT never
      // does, because OrmRequest registers only get/patch/post/delete
      // (src/orm-request.ts:806-822) and the router 404s it first. A unit test
      // that fabricates `method: 'HEAD'` never learns either fact.
      const before = operationLog.length;

      const head = await fetch(`${endpoint}/${OP_MOUNT}/${CTX_VISIBLE}`, { method: 'HEAD' });
      const put = await fetch(`${endpoint}/${OP_MOUNT}/${CTX_VISIBLE}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data: { type: 'animal', id: CTX_VISIBLE, attributes: { age: 3 } } })
      });
      const control = await fetch(`${endpoint}/${OP_MOUNT}/${CTX_VISIBLE}`);

      const calls = operationLog.slice(before);
      const headCall = calls.find(call => call.method === 'HEAD');
      const getCall = calls.find(call => call.method === 'GET');

      assert.ok(headCall, 'express DELIVERED the HEAD request to the GET handler, so auth() really ran for it');
      assert.strictEqual(headCall.operation, undefined,
        "and `operation` is undefined for it — not defaulted to 'read', which would authorise an unclassified request");
      assert.ok(headCall.hasOperationKey, 'the key is present and undefined, rather than quietly absent');
      assert.strictEqual(headCall.model, 'animal', 'while `model` is still supplied — only the unmapped half is undefined');

      assert.notOk(calls.some(call => call.method === 'PUT'),
        'PUT never reached auth() at all — the router 404s it, so an AC written against PUT would be unfalsifiable');
      assert.equal(put.status, 404, 'and the caller sees that 404 from the router');

      // Control: the same route, same path, a MAPPED method. Without it,
      // "operation is undefined" could be true because the context is empty.
      assert.strictEqual(getCall.operation, 'read', 'a mapped method on the same route is still classified');
      assert.equal(control.status, 200, 'and still permitted');

      // The consequence, stated rather than assumed: this predicate treats an
      // unclassified request as a denial, which is the documented guidance.
      // The SHIPPED behaviour of HEAD against the method map is #215, filed
      // separately and deliberately not absorbed here.
      assert.equal(head.status, 403, 'this predicate denies the unclassified request, as the documentation instructs');
    });

    test('AC7 — negative control: a denying predicate still denies through the new path', async function(assert) {
      // Without this the whole change is satisfiable by granting everything.
      const ageBefore = store.get('animal', CTX_VISIBLE).age;

      for (const mount of [DENY_MOUNT, BROKEN_MOUNT]) {
        const shape = mount === DENY_MOUNT ? 'a `false` return' : 'an unrecognised return shape';

        const single = await fetch(`${endpoint}/${mount}/${CTX_VISIBLE}`);
        const collection = await fetch(`${endpoint}/${mount}`);
        const related = await fetch(`${endpoint}/${mount}/${CTX_VISIBLE}/owner`);
        const linkage = await fetch(`${endpoint}/${mount}/${CTX_VISIBLE}/relationships/owner`);
        const patch = await fetch(`${endpoint}/${mount}/${CTX_VISIBLE}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ data: { type: 'animal', id: CTX_VISIBLE, attributes: { age: 111 } } })
        });
        const create = await fetch(`${endpoint}/${mount}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ data: { type: 'animal', attributes: { type: 1, age: 1, size: 'small', owner: 'gina' } } })
        });
        const destroy = await fetch(`${endpoint}/${mount}/${CTX_VISIBLE}`, { method: 'DELETE' });

        assert.deepEqual(
          [single.status, collection.status, related.status, linkage.status, patch.status, create.status, destroy.status],
          [403, 403, 403, 403, 403, 403, 403],
          `${shape} denies all seven surfaces`);
      }

      assert.equal(store.get('animal', CTX_VISIBLE).age, ageBefore, 'and nothing was written behind a 403');
      assert.ok(store.get('animal', CTX_VISIBLE), 'and nothing was destroyed behind one');

      // Confirms the 403s above are the predicate's doing and not a property of
      // every route this module mounted.
      const permitted = await fetch(`${endpoint}/${CTX_MOUNT}/${CTX_VISIBLE}`);
      assert.equal(permitted.status, 200, 'while the permitting predicate on a sibling mount still answers 200');
    });

    test('AC8 — the model->predicate registry survives boot and is reachable from the live Orm instance', async function(assert) {
      // Asserted against the LIVE `Orm.instance` this suite booted, not a
      // constructed object. Before this story the registry was a function-local
      // in setup-rest-server.ts, populated per model, consumed once by the mount
      // loop and discarded when that function returned — `Orm` carried no access
      // registry of any kind, so at request time there was no route from a model
      // NAME to that model's predicate.
      const registry = Orm.instance.accessFunctions;

      assert.ok(registry && typeof registry === 'object', 'Orm.instance carries an access registry after a real boot');
      assert.deepEqual(Object.keys(registry).sort(), ['animal', 'category', 'owner', 'phone-number', 'trait'],
        'holding every model the shipped access class claims');

      // Keyed by MODEL name, which is what a consumer has. The pluralised,
      // dasherized route names the mount loop derives are NOT keys.
      assert.ok('phone-number' in registry, 'keys are model names — kebab-case, as declared and as stored');
      assert.notOk('phoneNumbers' in registry, 'not the camel-cased route name');
      assert.notOk('animals' in registry, 'not the pluralised one either');

      assert.strictEqual(typeof Orm.instance.getAccess('animal'), 'function', 'getAccess resolves a model to its predicate');
      assert.strictEqual(Orm.instance.getAccess('animal'), registry.animal, 'and resolves the very entry in the map');

      // It is a model -> access-CLASS map, not model -> that model's own
      // predicate. `GlobalAccess` claims five models and declares one `access`
      // method, so one function object is registered under five keys. Pins the
      // JSDoc on `Orm#accessFunctions`, because the wrong reading -- "the
      // resolved predicate is animal-specific" -- is the premise behind the
      // model-correctness claim this round had to correct.
      assert.strictEqual(Orm.instance.getAccess('owner'), Orm.instance.getAccess('animal'),
        'and the owner and animal entries are the SAME function object — one access class claiming five models');
      assert.ok(Orm.instance.getAccess('not-a-model') === undefined, 'and answers undefined for a model with no access class');

      // An unguarded index into a plain `{}` walks the prototype chain, so
      // `getAccess('constructor')` resolved `Object` -- callable, and the
      // documented `predicate?.(request, ctx)` pattern then returned
      // `Object(request)`, i.e. the request: TRUTHY, and the
      // `undefined`-means-deny contract bypassed. #207 takes the model name
      // from the request BODY, so this is the shape that would have made a
      // one-field body an authorization bypass. Reds when the `Object.hasOwn`
      // guard at src/main.ts is removed.
      //
      // Asserted as a BOOLEAN rather than with `strictEqual(value, undefined)`
      // on purpose: without the guard the resolved value is `Object` or
      // `Object.prototype`, and qunit's failure diagnostic tries to dump it,
      // which wedges the reporter. `ok(x === undefined)` fails loudly and
      // exits.
      for (const inherited of ['constructor', 'toString', 'valueOf', 'hasOwnProperty', 'isPrototypeOf', '__proto__']) {
        assert.ok(Orm.instance.getAccess(inherited) === undefined,
          `and resolves nothing for the inherited Object.prototype member "${inherited}" — own properties only`);
      }

      // Reachable is not enough — it has to be the predicate that is ACTUALLY
      // ENFORCING. Both halves are measured on one live dispatch: the request
      // object express built for a real `GET /animals`, and the response that
      // dispatch produced.
      let captured = null;
      const unsubscribe = beforeHook('list', 'animal', context => { captured = context.request; });

      let response;
      let body;
      try {
        response = await fetch(`${endpoint}/animals`);
        body = await response.json();
      } finally {
        unsubscribe();
      }

      assert.equal(response.status, 200, 'the live /animals collection answered');
      assert.notOk(body.data.some(record => Number(record.id) === SHIPPED_HIDDEN),
        'and the record owned by `restricted` is absent from it — the filter is live');
      assert.ok(captured && captured.baseUrl === '/animals', 'and the hook handed back the request express dispatched');

      const filter = Orm.instance.getAccess('animal')(captured, { model: 'animal', operation: 'read' });

      assert.strictEqual(typeof filter, 'function', 'the registry entry, asked about that same request, yields a per-record filter');
      assert.notOk(filter(store.get('animal', SHIPPED_HIDDEN)),
        'which rejects exactly the record the live response omitted — the registry holds the enforcing predicate, not a stale copy');
      assert.ok(filter(store.get('animal', SHIPPED_VISIBLE)), 'and admits the one it carried');
    });

    test('AC9 — another model predicate is reachable AND model-correct while servicing a request routed to a different model', async function(assert) {
      // THE ACCEPTANCE CRITERION THIS STORY EXISTS FOR. #196 and #207 both need
      // to evaluate model X's predicate while servicing a request routed to
      // model Y. The registry makes the predicate REACHABLE; the
      // { model, operation } context makes the answer MODEL-CORRECT. Neither
      // half alone unblocks anything, which is why they shipped together.
      //
      // The request object below is one express actually produced during a real
      // dispatch, taken off the hook context (src/orm-request.ts:943-947 plants
      // the live request there). It is NOT `makeRequest`: that helper fabricates
      // `baseUrl` and `path` from a url string it also invents, and fail-open
      // variant 5 survived four review rounds inside it.
      let captured = null;
      const unsubscribe = beforeHook('get', 'owner', context => { captured = context.request; });

      let ownerResponse;
      try {
        ownerResponse = await fetch(`${endpoint}/owners/angela`);
      } finally {
        unsubscribe();
      }

      assert.equal(ownerResponse.status, 404, 'a real GET /owners/angela — the owner predicate hides angela, so this dispatch really was authorised');
      assert.ok(captured, 'and the live request object was captured from that dispatch');
      assert.strictEqual(captured.baseUrl, '/owners', 'baseUrl reads /owners — express set it from the mount it matched');
      assert.strictEqual(captured.originalUrl, '/owners/angela', 'and originalUrl is the target the caller sent');
      assert.ok(captured.socket && typeof captured.socket.remoteAddress === 'string',
        'it came off a real socket — a fabricated request cannot carry one');

      // (b) THE FAILURE MODE — AND ITS FIX, ON THE SHIPPED PREDICATE, ON THIS
      // LIVE REQUEST.
      //
      // INVERTED BY #222. This used to assert that `getAccess('animal')` GRANTS
      // animal 21: the registry held a URL-identifying predicate, so asked about
      // ANIMALS while holding a request addressed to /owners it answered about
      // OWNERS, in the granting direction. That was #196's objection verbatim,
      // and it is the condition #222 exists to close.
      //
      // The read stays on the BOOT registry — not on an imported class and not
      // on an entry this test seeded — because that is what makes the swap
      // further down non-vacuous (see the comment there). What changed is the
      // answer.
      const bootRegistryEntry = Orm.instance.getAccess('animal');
      const modelCorrect = bootRegistryEntry(captured, { model: 'animal', operation: 'read' });

      assert.strictEqual(typeof modelCorrect, 'function', 'the shipped predicate returns a filter for this request');
      assert.notOk(modelCorrect(store.get('animal', SHIPPED_HIDDEN)),
        'and it REJECTS animal 21 — the ANIMAL answer, given while holding a request routed to /owners (was: GRANTED, the owner answer)');
      assert.ok(modelCorrect(store.get('animal', SHIPPED_VISIBLE)),
        'while admitting a visible animal');

      // CONFIRM THE CHECK COULD FAIL, and keep the failure mode itself covered.
      // `legacyOwnerIdentifyingAccess` is the shape the shipped predicate had
      // before #222, and the shape every unmigrated consumer predicate still
      // has. Handed this same /owners request with the same correct context and
      // asked about ANIMALS, it still answers about OWNERS. Illustration of the
      // consumer-side defect, not a framework guarantee — which is exactly why
      // #221 exists to warn about it at boot.
      const legacyOwnerIdentifyingAccess = request => {
        const mount = request.baseUrl;
        if (typeof mount !== 'string' || mount === '') return false;
        if (mount.toLowerCase().endsWith('/owners')) return record => record.id !== 'angela' && record.id !== 'restricted';

        return record => record.owner?.id !== 'restricted';
      };
      const wrongAnswer = legacyOwnerIdentifyingAccess(captured, { model: 'animal', operation: 'read' });

      assert.strictEqual(legacyOwnerIdentifyingAccess.length, 1, 'the contrast subject really is a single-argument predicate');
      assert.ok(wrongAnswer(store.get('animal', SHIPPED_HIDDEN)),
        'an arity-1 predicate GRANTS animal 21 on this same request — the owner answer. The context alone does not fix that; the predicate has to read it');

      // (a) + the fix, a second time and through a DIFFERENT predicate.
      // `urlFreeAnimalAccess` is not a mock: it is the predicate this module has
      // been enforcing over the live router for every assertion above, and the
      // two requests below re-establish that inside this test. It was written
      // for this part because when #202 landed the shipped fixture was still
      // arity-1; since #222 the shipped fixture carries the claim too (above),
      // and this half now pins the REGISTRY mechanism independently of which
      // predicate happens to be installed.
      const liveHidden = await fetch(`${endpoint}/${CTX_MOUNT}/${CTX_HIDDEN}`);
      const liveVisible = await fetch(`${endpoint}/${CTX_MOUNT}/${CTX_VISIBLE}`);

      assert.equal(liveHidden.status, 404, 'the migrated predicate is live-enforcing on /ctx-animals');
      assert.equal(liveVisible.status, 200, 'and admitting what it should');

      // WHERE AC9's REGISTRY CLAIM IS ACTUALLY CARRIED. The swap below writes an
      // entry and the next line reads it back, which taken ALONE is a test
      // seeding what production is supposed to seed. It is not vacuous, and the
      // reason is `bootRegistryEntry` above: that read comes from the BOOT registry
      // and throws when there is none, which is why removing
      // `Orm.instance.accessFunctions = ...` from setup-rest-server.ts reds AC9
      // (measured — it reds AC3, AC8 and AC9). AC8 carries the same claim
      // independently. If a future edit drops the `bootRegistryEntry` read, AC9's
      // registry half silently becomes a self-check and this comment stops
      // being true — the swap exists to substitute a MIGRATED predicate for the
      // shipped one, not to demonstrate that the registry exists.
      const restore = Orm.instance.accessFunctions.animal;
      try {
        Orm.instance.accessFunctions.animal = urlFreeAnimalAccess;

        const resolved = Orm.instance.getAccess('animal');

        assert.strictEqual(typeof resolved, 'function',
          'the animal predicate RESOLVES from the registry (red when the registry is absent: before this story the map died in setup-rest-server.ts and this was undefined)');
        assert.strictEqual(resolved, urlFreeAnimalAccess,
          'and it is the same function object the live /ctx-animals route is enforcing');

        const verdict = resolved(captured, { model: 'animal', operation: 'read' });

        assert.strictEqual(typeof verdict, 'function',
          'asked about `animal` while holding the /owners request, it returns a per-record filter — not the CRUD fall-through grant');
        assert.notOk(verdict(store.get('animal', SHIPPED_HIDDEN)),
          'and the filter REJECTS the animal owned by `restricted` — the ANIMAL answer');
        assert.ok(verdict(store.get('animal', SHIPPED_VISIBLE)), 'while admitting a visible one');

        // ILLUSTRATION, not coverage. This exercises a branch of the
        // TEST-LOCAL predicate defined in this module, so no production change
        // can make it fail. It is here to show the contrast a consumer reads
        // — the answer is not the owner answer — not to assert framework
        // behaviour. Same for the context-withheld call below.
        assert.ok(verdict(store.get('owner', 'angela')),
          "and it is not the OWNER predicate's answer, which would have rejected angela");

        assert.strictEqual(captured.baseUrl, '/owners',
          'all of which was decided while the request in hand was still routed to /owners. That contrast IS the assertion');

        // (b) again, from the other side: drop the context and the same
        // migrated predicate cannot answer at all — it fails closed rather than
        // guessing from the request. The context is what carries the model.
        //
        // ILLUSTRATION, as above: this is the test-local predicate's own
        // early-return branch, so it is the documented consumer idiom being
        // demonstrated, not a framework guarantee being asserted. The framework
        // guarantee that a caller cannot silently omit the context is the
        // REQUIRED `context` parameter on `AccessFunction`, which is a
        // compile-time fact (TS2554) and not reachable from this tier.
        assert.strictEqual(resolved(captured), false,
          'without the context there is no model to answer about, and a predicate that cannot identify its subject denies');
      } finally {
        Orm.instance.accessFunctions.animal = restore;
      }

      assert.strictEqual(Orm.instance.getAccess('animal'), restore, 'the boot registry is left exactly as it was found');
    });

    test('#236 — `recordId` is the DECODED route-parameter id express matched, over the live router', async function(assert) {
      // THE TIER THAT CAN ACTUALLY PROVE IT. The unit half
      // (test/unit/access-context-test.ts) pins what `auth()` does to a
      // `params` object it is handed. The claim this story is FOR — that what
      // express puts in `params` is the DECODED id, while `request.path` is
      // still the raw one — is only knowable from the real router, and a
      // fabricated request is the harness fail-open variant 5 survived four
      // review rounds inside.
      //
      // Raw socket, not `fetch()`: `fetch` percent-normalises the target and
      // cannot emit an absolute-form request-target at all, so the two shapes
      // this assertion most needs are unreachable through it.
      const contextFor = async (method, target) => {
        const from = observed.length;
        const response = await rawRequest(method, target);
        const seen = observed.slice(from);

        assert.equal(seen.length, 1, `INPUT ${method} ${target} -> ${response.status}: the predicate was consulted exactly once`);

        return { context: seen[0].context, request: seen[0].request, response };
      };

      // ASSERTION 2 — the decoded id, and the raw path beside it. Printing both
      // in one assertion is the whole finding: they DISAGREE, and every
      // consumer that read the left-hand one failed open.
      const encoded = await contextFor('GET', `/${CTX_MOUNT}/%61rchived`);

      assert.strictEqual(encoded.context.recordId, 'archived',
        'INPUT GET /ctx-animals/%61rchived: recordId is the DECODED `archived` — the same string the store lookup is about to use');
      assert.strictEqual(encoded.request.path, '/%61rchived',
        'while request.path on that same request is still the RAW `/%61rchived` — the disagreement this key exists to end');

      // Not a deny-list of one spelling: three more of the 255, each encoding a
      // different character, and a fully-encoded one.
      for (const target of [`/${CTX_MOUNT}/a%72chived`, `/${CTX_MOUNT}/archive%64`, `/${CTX_MOUNT}/%61%72%63%68%69%76%65%64`]) {
        const { context } = await contextFor('GET', target);

        assert.strictEqual(context.recordId, 'archived', `INPUT GET ${target}: recordId is the decoded \`archived\` too — the comparison is on the decoded value, not on a spelling`);
      }

      // AND EXACTLY ONE DECODE. Express decodes a route parameter once, which
      // is what a route parameter means. `%2561rchived` is the LEGITIMATE id
      // `%61rchived`; a framework that decoded until stable would report
      // `archived` here and hand every consumer a false deny.
      const doubled = await contextFor('GET', `/${CTX_MOUNT}/%2561rchived`);

      assert.strictEqual(doubled.context.recordId, '%61rchived',
        'INPUT GET /ctx-animals/%2561rchived: recordId is the literal `%61rchived`, NOT `archived` — one decode, not a loop');

      // ASSERTION 3 — the collection route addresses no record, and says so
      // with a PRESENT key. `undefined` would be indistinguishable from a
      // context that never came from auth() at all.
      const collection = await contextFor('GET', `/${CTX_MOUNT}`);

      assert.true('recordId' in collection.context, 'INPUT GET /ctx-animals: the recordId key is present on a collection route');
      assert.strictEqual(collection.context.recordId, null, 'and its value is null — addressed to no record');

      // ASSERTION 4 — byte-identical to `getId(request.params)`, the coercion
      // the dispatch itself uses. On a hex-shaped id the raw string and the
      // lookup key name two DIFFERENT records, so this is the assertion that
      // pins predicate and dispatch to one answer.
      const hex = await contextFor('GET', `/${CTX_MOUNT}/0x2391`);

      assert.strictEqual(hex.context.recordId, 9105,
        'INPUT GET /ctx-animals/0x2391: recordId is 9105, the key the store lookup resolves — not the raw string');
      assert.strictEqual(hex.request.params.id, '0x2391',
        'confirming that could fail: express matched the raw `0x2391`, so the coercion is the framework\'s, not the router\'s');

      // The record surfaces all name the same record. This key answers WHICH
      // RECORD, not which surface — the related-resource gap is #196 and is
      // untouched.
      for (const target of [`/${CTX_MOUNT}/%61rchived/owner`, `/${CTX_MOUNT}/%61rchived/relationships/owner`]) {
        const { context } = await contextFor('GET', target);

        assert.strictEqual(context.recordId, 'archived', `INPUT GET ${target}: the relationship surfaces carry the same decoded recordId`);
      }

      // ASSERTION 5 — NEGATIVE CONTROL: recordId is never parsed out of the
      // request target. A mount prefix (variant 4), an absolute-form target
      // (variant 5), a case-varied mount (variant 3) and a query string
      // (variant 2) are the four shapes that broke every URL-derived matcher.
      // None of them is an input here, so none of them moves the answer.
      const invariant = [];

      for (const [method, target] of [
        ['GET', `/${CTX_MOUNT}/%61rchived?filter[age]=30`],
        ['GET', `/${CTX_PREFIXED_MOUNT}/%61rchived`],
        ['GET', `/${CTX_MOUNT.toUpperCase()}/%61rchived`],
        ['GET', `http://anything.example/${CTX_MOUNT}/%61rchived`],
        ['DELETE', `/${CTX_MOUNT}/%61rchived`],
      ]) {
        const { context } = await contextFor(method, target);
        invariant.push(context.recordId);
      }

      assert.deepEqual(invariant, ['archived', 'archived', 'archived', 'archived', 'archived'],
        'a query string, an ORM_REST_ROUTE-shaped mount prefix, a case-varied mount, an absolute-form target and a destructive verb all give ONE answer');

      // CONFIRM THE WHOLE TEST COULD FAIL: a different record on the same mount
      // reports a different id, so none of the above is satisfiable by a
      // constant.
      const other = await contextFor('GET', `/${CTX_MOUNT}/${CTX_VISIBLE}`);

      assert.strictEqual(other.context.recordId, CTX_VISIBLE, `INPUT GET /ctx-animals/${CTX_VISIBLE}: a different record reports a different recordId`);
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

      // RE-SPECIFIED BY abofs/stonyx-orm#232. Collateral: the subject was
      // `/animals/1/owner`, whose owner is hidden, so the route now answers 404
      // and has no `links` to inspect. Moved to a PERMITTED subject, with the
      // denied one asserted in the same test so the move is a pair and not a
      // quiet narrowing.
      test('GET related resource response includes links.self', async function(assert) {
        const response = await fetch(`${endpoint}/animals/4/owner`);
        const json = await response.json();

        assert.ok(json.links, 'response has links object');
        assert.ok(json.links.self, 'links has self property');
        assert.ok(json.links.self.includes('/animals/4/owner'), 'self link points to related resource URL');

        // #232 -- a denied related resource still carries its links, because
        // they are derived entirely from the PARENT and the relationship name
        // and disclose nothing about the target.
        const denied = await fetch(`${endpoint}/animals/1/owner`);
        const deniedJson = await denied.json();
        assert.equal(denied.status, 200, 'a denied related resource is 200, like a genuinely empty one');
        assert.strictEqual(deniedJson.data, null, 'with no document for the denied related resource');
        assert.ok(deniedJson.links.self.includes('/animals/1/owner'), 'and the parent-derived links intact');
      });

      // RE-SPECIFIED BY abofs/stonyx-orm#232 -- same reason as the assertion
      // above, on the linkage family.
      test('GET relationship linkage response includes links.self and links.related', async function(assert) {
        const response = await fetch(`${endpoint}/animals/4/relationships/owner`);
        const json = await response.json();

        assert.ok(json.links, 'response has links object');
        assert.ok(json.links.self, 'links has self property');
        assert.ok(json.links.self.includes('/animals/4/relationships/owner'), 'self link points to relationship URL');
        assert.ok(json.links.related, 'links has related property');
        assert.ok(json.links.related.includes('/animals/4/owner'), 'related link points to related resource URL');

        // #232 -- the negative half.
        const denied = await fetch(`${endpoint}/animals/1/relationships/owner`);
        const deniedJson = await denied.json();
        assert.equal(denied.status, 200, 'a denied linkage target is 200, like a genuinely empty one');
        assert.strictEqual(deniedJson.data, null, 'with no linkage object for the denied target');
        assert.ok(deniedJson.links.related.includes('/animals/1/owner'), 'and both parent-derived links intact');
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

    module('Hooks', function(hooks) {
      let unsubscribeFns = [];

      hooks.afterEach(function() {
        // Clean up all subscriptions after each test
        unsubscribeFns.forEach(fn => fn());
        unsubscribeFns = [];
      });

      module('Before Hooks', function() {
        test('beforeHook receives context for create', async function(assert) {
          assert.expect(6);

          const unsubscribe = beforeHook('create', 'animal', (context) => {
            assert.strictEqual(context.model, 'animal', 'context has model name');
            assert.strictEqual(context.operation, 'create', 'context has operation type');
            assert.ok(context.body, 'context has body');
            assert.strictEqual(context.body.data.type, 'animals', 'body has correct type');
            assert.strictEqual(context.body.data.attributes.type, 'dog', 'body has correct attributes');
            assert.ok(context.request, 'context has request object');
          });
          unsubscribeFns.push(unsubscribe);

          await fetch(`${endpoint}/animals`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              data: {
                type: 'animals',
                attributes: { type: 'dog', age: 5, size: 'large' }
              }
            })
          });
        });

        test('beforeHook receives context for update', async function(assert) {
          assert.expect(6);

          const unsubscribe = beforeHook('update', 'animal', (context) => {
            assert.strictEqual(context.model, 'animal', 'context has model name');
            assert.strictEqual(context.operation, 'update', 'context has operation type');
            assert.ok(context.body, 'context has body');
            assert.ok(context.params, 'context has params');
            assert.strictEqual(context.params.id, '1', 'params has correct id');
            assert.ok(context.request, 'context has request object');
          });
          unsubscribeFns.push(unsubscribe);

          await fetch(`${endpoint}/animals/1`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              data: {
                type: 'animals',
                id: '1',
                attributes: { age: 10 }
              }
            })
          });
        });

        test('beforeHook receives params for delete', async function(assert) {
          assert.expect(4);

          const unsubscribe = beforeHook('delete', 'animal', (context) => {
            assert.strictEqual(context.model, 'animal', 'context has model name');
            assert.strictEqual(context.operation, 'delete', 'context has operation type');
            assert.ok(context.params, 'context has params');
            assert.strictEqual(context.params.id, '2', 'params has correct id');
          });
          unsubscribeFns.push(unsubscribe);

          await fetch(`${endpoint}/animals/2`, {
            method: 'DELETE'
          });
        });

        test('beforeHook receives query parameters for list', async function(assert) {
          assert.expect(5);

          const unsubscribe = beforeHook('list', 'animal', (context) => {
            assert.strictEqual(context.model, 'animal', 'context has model name');
            assert.strictEqual(context.operation, 'list', 'context has operation type');
            assert.ok(context.query, 'context has query object');
            assert.ok(context.request, 'context has request object');
            assert.ok(context.state, 'context has state object');
          });
          unsubscribeFns.push(unsubscribe);

          await fetch(`${endpoint}/animals?filter[species]=cat`);
        });

        test('beforeHook receives params for get', async function(assert) {
          assert.expect(4);

          const unsubscribe = beforeHook('get', 'animal', (context) => {
            assert.strictEqual(context.model, 'animal', 'context has model name');
            assert.strictEqual(context.operation, 'get', 'context has operation type');
            assert.ok(context.params, 'context has params');
            assert.strictEqual(context.params.id, '1', 'params has correct id');
          });
          unsubscribeFns.push(unsubscribe);

          await fetch(`${endpoint}/animals/1`);
        });
      });

      module('After Hooks', function() {
        test('afterHook receives created record', async function(assert) {
          assert.expect(6);

          const unsubscribe = afterHook('create', 'animal', (context) => {
            assert.strictEqual(context.model, 'animal', 'context has model name');
            assert.strictEqual(context.operation, 'create', 'context has operation type');
            assert.ok(context.response, 'context has response');
            assert.ok(context.response.data, 'response has data');
            assert.ok(context.record, 'context has record');
            assert.strictEqual(context.record.id, context.response.data.id, 'record matches response ID');
          });
          unsubscribeFns.push(unsubscribe);

          await fetch(`${endpoint}/animals`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              data: {
                type: 'animals',
                attributes: { type: 'cat', age: 2, size: 'small' }
              }
            })
          });
        });

        test('afterHook receives fetched record', async function(assert) {
          assert.expect(5);

          const unsubscribe = afterHook('get', 'animal', (context) => {
            assert.strictEqual(context.model, 'animal', 'context has model name');
            assert.strictEqual(context.operation, 'get', 'context has operation type');
            assert.ok(context.response, 'context has response');
            assert.ok(context.record, 'context has record');
            assert.strictEqual(context.record.id, 1, 'record has correct id');
          });
          unsubscribeFns.push(unsubscribe);

          await fetch(`${endpoint}/animals/1`);
        });

        test('afterHook receives records array for list', async function(assert) {
          assert.expect(5);

          const unsubscribe = afterHook('list', 'animal', (context) => {
            assert.strictEqual(context.model, 'animal', 'context has model name');
            assert.strictEqual(context.operation, 'list', 'context has operation type');
            assert.ok(context.response, 'context has response');
            assert.ok(context.records, 'context has records array');
            assert.ok(Array.isArray(context.records), 'records is an array');
          });
          unsubscribeFns.push(unsubscribe);

          await fetch(`${endpoint}/animals`);
        });

        test('afterHook receives updated record', async function(assert) {
          assert.expect(6);

          const unsubscribe = afterHook('update', 'animal', (context) => {
            assert.strictEqual(context.model, 'animal', 'context has model name');
            assert.strictEqual(context.operation, 'update', 'context has operation type');
            assert.ok(context.response, 'context has response');
            assert.ok(context.record, 'context has record');
            assert.strictEqual(context.record.id, 1, 'record has correct id');
            assert.strictEqual(context.record.age, 99, 'record was updated');
          });
          unsubscribeFns.push(unsubscribe);

          await fetch(`${endpoint}/animals/1`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              data: {
                type: 'animals',
                id: '1',
                attributes: { age: 99 }
              }
            })
          });
        });

        test('afterHook includes oldState for update comparison', async function(assert) {
          assert.expect(5);

          const unsubscribe = afterHook('update', 'animal', (context) => {
            assert.ok(context.oldState, 'context has oldState');
            assert.ok(context.record, 'context has updated record');
            assert.notEqual(context.oldState.age, context.record.age, 'age changed');
            assert.strictEqual(context.oldState.age, 99, 'oldState has previous age from earlier test');
            assert.strictEqual(context.record.age, 50, 'record has new age');
          });
          unsubscribeFns.push(unsubscribe);

          await fetch(`${endpoint}/animals/1`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              data: {
                type: 'animals',
                id: '1',
                attributes: { age: 50 }
              }
            })
          });
        });

        test('afterHook includes oldState for delete', async function(assert) {
          assert.expect(4);

          const unsubscribe = afterHook('delete', 'animal', (context) => {
            assert.strictEqual(context.model, 'animal', 'context has model name');
            assert.strictEqual(context.operation, 'delete', 'context has operation type');
            assert.ok(context.oldState, 'context has oldState from deleted record');
            assert.strictEqual(context.oldState.id, 3, 'oldState has correct id');
          });
          unsubscribeFns.push(unsubscribe);

          await fetch(`${endpoint}/animals/3`, {
            method: 'DELETE'
          });
        });

        test('beforeHook receives context for delete', async function(assert) {
          assert.expect(3);

          const unsubscribe = beforeHook('delete', 'animal', (context) => {
            assert.strictEqual(context.model, 'animal', 'context has model name');
            assert.strictEqual(context.operation, 'delete', 'context has operation type');
            assert.ok(context.params, 'context has params');
          });
          unsubscribeFns.push(unsubscribe);

          await fetch(`${endpoint}/animals/4`, {
            method: 'DELETE'
          });
        });
      });

      module('Hook Lifecycle', function() {
        test('unsubscribe removes beforeHook', async function(assert) {
          assert.expect(1);

          let callCount = 0;
          const unsubscribe = beforeHook('create', 'animal', () => {
            callCount++;
          });

          await fetch(`${endpoint}/animals`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              data: {
                type: 'animals',
                attributes: { type: 'mammal', age: 4, size: 'large' }
              }
            })
          });

          unsubscribe();

          await fetch(`${endpoint}/animals`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              data: {
                type: 'animals',
                attributes: { type: 'mammal', age: 5, size: 'large' }
              }
            })
          });

          assert.strictEqual(callCount, 1, 'hook only called once before unsubscribe');
        });

        test('clearHook removes all hooks for operation:model', async function(assert) {
          assert.expect(1);

          let callCount = 0;

          const unsub1 = beforeHook('create', 'animal', () => {
            callCount++;
          });
          unsubscribeFns.push(unsub1);

          const unsub2 = beforeHook('create', 'animal', () => {
            callCount++;
          });
          unsubscribeFns.push(unsub2);

          await fetch(`${endpoint}/animals`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              data: {
                type: 'animals',
                attributes: { type: 'amphibian', age: 2, size: 'small' }
              }
            })
          });

          clearHook('create', 'animal');

          await fetch(`${endpoint}/animals`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              data: {
                type: 'animals',
                attributes: { type: 'amphibian', age: 3, size: 'small' }
              }
            })
          });

          assert.strictEqual(callCount, 2, 'hooks only called before clearHook');
        });
      });

      module('Middleware Hooks (Halting)', function(middlewareHooks) {
        middlewareHooks.afterEach(function() {
          // Clean up all middleware hooks after each test
          clearAllHooks();
        });

        test('beforeHook can halt operation by returning status code', async function(assert) {
          assert.expect(2);

          const unsubscribe = beforeHook('create', 'animal', (context) => {
            // Halt with 403 Forbidden
            return 403;
          });
          unsubscribeFns.push(unsubscribe);

          const response = await fetch(`${endpoint}/animals`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              data: {
                type: 'animals',
                attributes: { type: 'blocked', age: 1, size: 'small' }
              }
            })
          });

          assert.strictEqual(response.status, 403, 'request halted with 403 status');

          // Verify record was not created
          const animals = Array.from(store.get('animal').values());
          const blockedAnimal = animals.find(a => a.type === 'blocked');
          assert.notOk(blockedAnimal, 'record was not created');
        });

        test('beforeHook can halt operation by returning custom response', async function(assert) {
          assert.expect(2);

          const unsubscribe = beforeHook('update', 'animal', () => {
            return { errors: [{ detail: 'Updates disabled' }] };
          });
          unsubscribeFns.push(unsubscribe);

          const response = await fetch(`${endpoint}/animals/1`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              data: {
                type: 'animals',
                id: '1',
                attributes: { age: 999 }
              }
            })
          });

          const json = await response.json();
          assert.ok(json.errors, 'hook returned custom error response');
          assert.strictEqual(json.errors[0].detail, 'Updates disabled', 'error message matches');
        });

        test('beforeHook returning undefined allows operation to continue', async function(assert) {
          assert.expect(2);

          let hookCalled = false;
          const unsubscribe = beforeHook('create', 'animal', () => {
            hookCalled = true;
            // Return undefined to continue
          });
          unsubscribeFns.push(unsubscribe);

          const response = await fetch(`${endpoint}/animals`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              data: {
                type: 'animals',
                attributes: { type: 'allowed', age: 2, size: 'medium' }
              }
            })
          });

          assert.ok(hookCalled, 'hook was called');
          assert.strictEqual(response.status, 200, 'request succeeded');
        });

        test('multiple beforeHooks run sequentially until one halts', async function(assert) {
          assert.expect(4);

          let firstCalled = false;
          let secondCalled = false;
          let thirdCalled = false;

          beforeHook('create', 'animal', () => {
            firstCalled = true;
            // Continue
          });

          beforeHook('create', 'animal', () => {
            secondCalled = true;
            return 403; // Halt
          });

          beforeHook('create', 'animal', () => {
            thirdCalled = true;
            // Should not run
          });

          const response = await fetch(`${endpoint}/animals`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              data: {
                type: 'animals',
                attributes: { type: 'sequential-test', age: 1, size: 'small' }
              }
            })
          });

          assert.ok(firstCalled, 'first hook ran');
          assert.ok(secondCalled, 'second hook ran');
          assert.notOk(thirdCalled, 'third hook did not run (halted)');
          assert.strictEqual(response.status, 403, 'operation halted');
        });

        test('beforeHook receives correct context', async function(assert) {
          assert.expect(7);

          const unsubscribe = beforeHook('create', 'animal', (context) => {
            assert.strictEqual(context.model, 'animal', 'context has model name');
            assert.strictEqual(context.operation, 'create', 'context has operation type');
            assert.ok(context.body, 'context has body');
            assert.strictEqual(context.body.data.type, 'animals', 'body has correct type');
            assert.strictEqual(context.body.data.attributes.type, 'context-test', 'body has correct attributes');
            assert.ok(context.request, 'context has request object');
            assert.ok(context.state, 'context has state object');
          });
          unsubscribeFns.push(unsubscribe);

          await fetch(`${endpoint}/animals`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              data: {
                type: 'animals',
                attributes: { type: 'context-test', age: 3, size: 'large' }
              }
            })
          });
        });

        test('afterHook receives response after operation', async function(assert) {
          assert.expect(4);

          const unsubscribe = afterHook('create', 'animal', (context) => {
            assert.ok(context.response, 'context has response');
            assert.ok(context.response.data, 'response has data');
            assert.ok(context.record, 'context has record');
            assert.strictEqual(context.record.id, context.response.data.id, 'record matches response ID');
          });
          unsubscribeFns.push(unsubscribe);

          await fetch(`${endpoint}/animals`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              data: {
                type: 'animals',
                attributes: { type: 'dog', age: 4, size: 'small' }
              }
            })
          });
        });

        test('clearHook removes hooks for specific operation:model', async function(assert) {
          assert.expect(2);

          let callCount = 0;

          beforeHook('create', 'animal', () => {
            callCount++;
          });

          await fetch(`${endpoint}/animals`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              data: {
                type: 'animals',
                attributes: { type: 'clear-test-1', age: 1, size: 'small' }
              }
            })
          });

          assert.strictEqual(callCount, 1, 'hook called once before clear');

          clearHook('create', 'animal');

          await fetch(`${endpoint}/animals`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              data: {
                type: 'animals',
                attributes: { type: 'clear-test-2', age: 2, size: 'small' }
              }
            })
          });

          assert.strictEqual(callCount, 1, 'hook not called after clear');
        });

        test('unsubscribe function removes specific hook', async function(assert) {
          assert.expect(2);

          let callCount = 0;

          const unsubscribe = beforeHook('create', 'animal', () => {
            callCount++;
          });

          await fetch(`${endpoint}/animals`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              data: {
                type: 'animals',
                attributes: { type: 'unsub-test-1', age: 1, size: 'small' }
              }
            })
          });

          assert.strictEqual(callCount, 1, 'hook called once before unsubscribe');

          unsubscribe();

          await fetch(`${endpoint}/animals`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              data: {
                type: 'animals',
                attributes: { type: 'unsub-test-2', age: 2, size: 'small' }
              }
            })
          });

          assert.strictEqual(callCount, 1, 'hook not called after unsubscribe');
        });
      });
    });
  });

  // ===========================================================================
  // #234 -- RELATIONSHIP LINKAGE ACCESS
  // ===========================================================================
  //
  // `Record.toJSON()` built `relationships.*.data` unconditionally, with no
  // access parameter, so a record the filter hides on every one of its OWN
  // surfaces was still named, by id, inside another model's document. Measured
  // on origin/dev @ c5f7907:
  //
  //     GET /owners/angela  ->  404
  //     GET /animals/1      ->  200, relationships.owner.data == {owner, angela}
  //     GET /animals        ->  200, 8 of 20 records name angela, and that set
  //                              is exactly angela.pets
  //
  // No `include=`, no relationship route, no query string at all. Every other
  // surface in the #196 family requires the caller to ASK for the related
  // resource; this one fires on the default request.
  //
  // ---------------------------------------------------------------------------
  // SCOPE -- LINKAGE ONLY, ON THE FOUR REQUEST-BOUND READ SURFACES
  // ---------------------------------------------------------------------------
  // These assertions are about which IDS appear inside `relationships.*.data`.
  // They say NOTHING about which resources appear in `included`, or about
  // whether a related record is served at all -- that is MEMBERSHIP, and it
  // belongs to abofs/stonyx-orm#233 and #196. A resource can legitimately
  // appear while some document's linkage no longer names it.
  //
  // The four surfaces are the four `Record.toJSON()` call sites that already
  // bind the request: `getCollectionHandler`, `getSingleHandler`, and the two
  // related-resource route sites in `_generateRelationshipRoutes`.
  //
  // ---------------------------------------------------------------------------
  // WHY THESE LIVE HERE AND NOT IN THEIR OWN FILE
  // ---------------------------------------------------------------------------
  // The outer module's `hooks.after` calls `RestServer.close()`, and the sample
  // dataset is created by THIS file's nested `hooks.before` blocks. A separate
  // integration file sorts after `orm-test.ts` and would fetch against a closed
  // server; sorting it before would put its records in the store while the `Db`
  // module asserts the saved file is empty. #190 and #202 reached the same
  // conclusion and their live-router suites are nested here too.
  //
  // ---------------------------------------------------------------------------
  // WHY TWO ASSERTIONS DRIVE THE REGISTRY INSTEAD OF THE FIXTURE
  // ---------------------------------------------------------------------------
  // AC1's hasMany half and AC4 cannot be made to FAIL against the shipped
  // fixture, and asserted against it they are vacuously green:
  //
  //   - hasMany. A hidden animal is one owned by `restricted`, and `restricted`
  //     is hidden himself, so no PERMITTED parent names a hidden child.
  //     Measured: the hidden animal ids 21 and 22 appear in ZERO visible
  //     owner's `pets` linkage. The `9999` in the issue body was a spliced
  //     probe record, never a shipped one.
  //   - AC4. All five sample models are claimed by `GlobalAccess`, so
  //     `getAccess()` never returns `undefined` for anything in linkage range.
  //
  // Both gaps are closed by driving `Orm.instance.accessFunctions` -- the
  // registry `getAccess()` reads, and the registry the documented cross-model
  // path reads -- rather than by adding models and access classes to a fixture
  // several other stories are editing this sprint.
  //
  // THE REQUEST IS STILL LIVE IN EVERY CASE. Nothing below hand-assembles one:
  // every assertion goes over the express router through `fetch`, per the rule
  // #202 adopted after variant 5 survived four review rounds inside a
  // fabricating harness. Only the access REGISTRY is driven, and the registry
  // is exactly the input a new unclaimed model or a tighter access class would
  // change.
  //
  // It also buys a property a fixture could not: the mount loop passes `access`
  // BY VALUE into each OrmRequest, so overriding a registry entry moves the
  // LINKAGE answer without moving the mounted route's own filter. Two
  // assertions below use that to prove linkage resolves through
  // `Orm.instance.getAccess` -- the documented cross-model path -- and not
  // through `state.filter`, which is always the ADDRESSED model's predicate and
  // is not even distinguishable by identity
  // (`getAccess('owner') === getAccess('animal')` is `true`).
  //
  // ASSERTION LABELS, as in test/unit/access-filter-enforcement-test.ts:
  //   [DEFECT] -- observed FAILING against unfixed dev at c5f7907.
  //   [GUARD]  -- passes on dev today; proves the fix did not overshoot.
  //
  module('Relationship Linkage Access (#234)', function(linkageHooks) {
    // angela is hidden on every /owners surface and owns exactly these.
    const ANGELA_PETS = [1, 3, 7, 10, 11, 15, 17, 20];

    linkageHooks.before(function() {
      // Idempotent, matching `JSON API Relationship Routes` above: earlier
      // modules in this file have already created most of this, and a few of
      // their own records besides. Nothing below assumes the collection
      // contains ONLY the fixture -- every count is derived from the response
      // or from the store, never hard-coded, so a record another module left
      // behind cannot turn an assertion red or green by accident.
      for (const category of serialized.categories) {
        if (!store.get('category', category.id)) createRecord('category', category);
      }
      for (const owner of raw.owners) {
        if (!store.get('owner', owner.name)) createRecord('owner', owner);
      }
      for (const animal of raw.animals) {
        if (!store.get('animal', animal.id)) createRecord('animal', animal);
      }
      // abofs/stonyx-orm#240, fixture 2. AC4 below reads it, and an earlier
      // module in this file unloads the whole store and rebuilds it from the
      // saved db file -- which carries no `tags` collection, because an
      // unclaimed model is not persisted.
      if (!store.get('tag', 'never-mounted')) {
        createRecord('tag', { id: 'never-mounted', label: 'a collection the consumer never exposed' });
      }
    });

    const getJson = async path => {
      const response = await fetch(`${endpoint}${path}`);
      const body = response.status === 204 ? undefined : await response.json().catch(() => undefined);

      return { status: response.status, body };
    };

    /**
     * Replace one registry entry for the duration of `fn`, then restore it.
     *
     * `Orm.instance.accessFunctions` holds ONE function object under several
     * model keys (`accessFunctions.owner === accessFunctions.animal` against
     * this fixture), so the replacement is written to a single KEY and every
     * other model's resolution is untouched. `getAccess` reads the map live,
     * which is why this reaches the linkage path at all.
     */
    const withAccess = async (model, replacement, fn) => {
      const registry = Orm.instance.accessFunctions;
      const had = Object.hasOwn(registry, model);
      const original = registry[model];

      if (replacement === undefined) delete registry[model];
      else registry[model] = replacement;

      try {
        return await fn();
      } finally {
        if (had) registry[model] = original;
        else delete registry[model];
      }
    };

    /**
     * Narrow a model's real predicate with an extra per-record rule, preserving
     * every other branch of it. Anything that is not a per-record function -- a
     * permission array, a bare `false` -- is passed through untouched, so this
     * TIGHTENS the shipped fixture rather than replacing it, and an assertion
     * cannot pass because the fixture was swapped for something permissive.
     */
    const narrow = (model, extra) => {
      const original = Orm.instance.accessFunctions[model];

      return function(request, context) {
        const access = original.call(this, request, context);
        if (typeof access !== 'function') return access;

        return record => access(record) && extra(record);
      };
    };

    test('[DEFECT] #234 AC1 — a hidden owner id is absent from a record document linkage', async function(assert) {
      // The precondition, asserted rather than assumed: if angela ever stops
      // being hidden every assertion in this module goes vacuously green, and
      // this fixture has been blinded exactly that way before (#190).
      const hidden = await getJson('/owners/angela');
      assert.strictEqual(hidden.status, 404, 'precondition: GET /owners/angela is 404 — her existence is withheld');

      // No query string. No `include=`. No relationship route.
      const { status, body } = await getJson('/animals/1');

      assert.strictEqual(status, 200, 'the animal itself is permitted and still served');
      assert.notOk('included' in body, 'nothing was sideloaded — this is the bare document');
      assert.strictEqual(body.data.relationships.owner.data, null,
        'the hidden owner is not named (was: {type:"owner", id:"angela"})');

      // A linkage id was dropped, not a document: everything else is intact.
      assert.strictEqual(body.data.id, 1, 'the addressed record is unchanged');
      assert.strictEqual(body.data.attributes.size, 'small', 'attributes are untouched');
    });

    test('[DEFECT] #234 AC1b — a hidden child id is absent from a permitted parent hasMany linkage', async function(assert) {
      // SWAPPED ONTO THE PERMANENT FIXTURE BY abofs/stonyx-orm#240.
      //
      // This drove `Orm.instance.accessFunctions` with a scoped override --
      // `withAccess('animal', narrow('animal', r => r.id !== 8))` -- because at
      // the time NO permitted parent named a hidden child anywhere in the
      // sample: every hidden animal (21, 22) was owned by `restricted`, who is
      // hidden himself. Measured across all three `hasMany` relations, the
      // count of such pairs was ZERO.
      //
      // #240's first fixture supplies one permanently: animal 18, owned by the
      // PERMITTED gina. The registry override is gone and the assertion now
      // reads the shipped fixture directly, which is strictly stronger -- an
      // override proves the code path works when the registry says so, while
      // the fixture proves the shipped configuration says so.
      //
      // The cross-model half is preserved rather than dropped, because it is
      // what proves the linkage answer came from `Orm.instance.getAccess` and
      // not from the owners route's `state.filter`: /animals/18 is 404 on its
      // OWN route, and if the linkage answer were coming from the owners
      // filter, 18 would still be named here.
      const owned = store.get('owner', 'gina').pets.map(pet => pet.id);
      assert.ok(owned.includes(18), 'precondition: gina OWNS animal 18 — the drop below is a filter, not missing data');

      const { status, body } = await getJson('/owners/gina');
      const pets = body.data.relationships.pets.data.map(record => record.id);

      assert.strictEqual(status, 200, 'the permitted parent is still served');
      assert.notOk(pets.includes(18), 'the hidden child is not named');
      assert.deepEqual(pets.slice().sort(), owned.filter(id => id !== 18).sort(),
        'and ONLY that child was dropped — every other pet is still named');

      assert.strictEqual((await getJson('/animals/18')).status, 404,
        'and the child is hidden on its OWN route too — the linkage answer is the ANIMAL model’s, resolved cross-model');
      assert.strictEqual((await getJson('/owners/gina')).status, 200,
        'while the parent is not — which is the property the shipped fixture could not offer before #240');

      // The registry-driven form is retained as a SECOND case rather than
      // replaced, because it covers something the fixture cannot: that the
      // mounted route's by-value filter and the registry are independent
      // inputs. `withAccess` and `narrow` are still used by AC1c and AC7.
      const petsBefore = pets;
      await withAccess('animal', narrow('animal', record => record.id !== 8), async () => {
        const scoped = await getJson('/owners/gina');
        const scopedPets = scoped.body.data.relationships.pets.data.map(record => record.id);

        assert.notOk(scopedPets.includes(8), 'a registry override hides a second child on top of the fixture');
        const stillServed = await getJson('/animals/8');
        assert.strictEqual(stillServed.status, 200,
          'while the mounted route is unaffected — it holds the boot-time snapshot, so the linkage answer came from the registry');
      });

      const after = await getJson('/owners/gina');
      assert.deepEqual(after.body.data.relationships.pets.data.map(record => record.id), petsBefore,
        'and the override was restored');
    });

    test('[DEFECT] #234 AC1c — linkage inside a related-resource route document is filtered', async function(assert) {
      // The two related-resource sites serve ANOTHER model's documents, and the
      // linkage inside those documents was the least visible half of this
      // defect.

      // hasMany site: GET /owners/gina/pets emits animal documents, each naming
      // its owner. Hide `gina` in the registry only.
      const petsBefore = await getJson('/owners/gina/pets');
      assert.ok(petsBefore.body.data.every(record => record.relationships.owner.data?.id === 'gina'),
        'precondition: every pet document names gina while she is permitted');

      await withAccess('owner', narrow('owner', record => record.id !== 'gina'), async () => {
        const { status, body } = await getJson('/owners/gina/pets');

        assert.strictEqual(status, 200, 'the addressed parent is still permitted by the mounted filter');
        assert.strictEqual(body.data.length, petsBefore.body.data.length,
          'the related records are all still SERVED — this story filters linkage, not membership');
        assert.ok(body.data.every(record => record.relationships.owner.data === null),
          'and none of them names the hidden owner');
      });

      // belongsTo site: GET /animals/4/owner emits gina's document, which names
      // her pets. Hide animal 8 in the registry only.
      const ownerBefore = await getJson('/animals/4/owner');
      const ginaPets = ownerBefore.body.data.relationships.pets.data.map(record => record.id);
      assert.ok(ginaPets.includes(8), 'precondition: the related owner document names animal 8');

      await withAccess('animal', narrow('animal', record => record.id !== 8), async () => {
        const { status, body } = await getJson('/animals/4/owner');

        assert.strictEqual(status, 200, 'the related owner document is still served');
        assert.deepEqual(body.data.relationships.pets.data.map(record => record.id), ginaPets.filter(id => id !== 8),
          'the hidden child is not named on the related-resource route either');
      });
    });

    test('[DEFECT] #234 AC2 — GET /animals names no owner that GET /owners/{id} 404s', async function(assert) {
      const { status, body } = await getJson('/animals');

      assert.strictEqual(status, 200);

      // The general property. Every id this collection publishes must be an id
      // the caller could have asked for directly.
      const named = [...new Set(body.data.map(record => record.relationships.owner.data?.id).filter(id => id !== undefined))].sort();
      assert.ok(named.length > 0, 'permitted owners are still named — this assertion is not vacuously green');

      for (const id of named) {
        const owner = await getJson(`/owners/${id}`);
        assert.strictEqual(owner.status, 200, `every named owner is one GET /owners/${id} can reach`);
      }

      // And the specific one, because the leak was ATTRIBUTED and BULK: the 8
      // records that named angela were exactly angela.pets.
      assert.deepEqual(body.data.filter(record => record.relationships.owner.data?.id === 'angela').map(record => record.id), [],
        'no record names angela (was: [1, 3, 7, 10, 11, 15, 17, 20] — angela.pets exactly)');

      const emptied = body.data.filter(record => ANGELA_PETS.includes(record.id));
      assert.strictEqual(emptied.length, ANGELA_PETS.length, 'precondition: all 8 of angela’s pets are in the collection');
      assert.ok(emptied.every(record => record.relationships.owner.data === null),
        'and each of them emitted an empty belongsTo rather than being dropped from the collection');
    });

    test('[GUARD] #234 AC3 — permitted linkage is still emitted on every surface', async function(assert) {
      // The measured failure mode of the REJECTED design -- resolving the
      // filter inside toJSON(), which has no request -- was not under-denial.
      // It nulled gina along with angela and took orm-test.ts:953,
      // orm-test.ts:841 and access-filter-enforcement-test.ts:1140 red
      // (967 -> 964). This is the fourth copy of that tripwire, stated where an
      // implementer of #232 or #233 will read it.
      const single = await getJson('/animals/4');
      assert.deepEqual(single.body.data.relationships.owner.data, { type: 'owner', id: 'gina' },
        'GET /animals/4 still names gina');

      const parent = await getJson('/owners/gina');
      assert.ok(parent.body.data.relationships.pets.data.map(record => record.id).includes(4),
        'GET /owners/gina still names her pets');

      // A relationship whose model resolves to a PERMISSION ARRAY rather than a
      // per-record function must be granted unconditionally: `trait` is claimed
      // by GlobalAccess and falls through to ['read','create','update','delete'].
      const withTraits = await getJson('/animals/1');
      assert.deepEqual(withTraits.body.data.relationships.traits.data,
        [{ type: 'trait', id: 1 }, { type: 'trait', id: 2 }],
        'a permission-array model is still named in full, even on a record whose owner was dropped');

      const collection = await getJson('/animals');
      const permitted = collection.body.data.filter(record => !ANGELA_PETS.includes(record.id) && record.relationships.owner.data);
      assert.ok(permitted.length > 0, 'the collection still names permitted owners');
      assert.ok(permitted.every(record => ['gina', 'michael', 'bob'].includes(record.relationships.owner.data.id)),
        'and every id it names belongs to a permitted owner');

      const related = await getJson('/owners/gina/pets');
      assert.ok(related.body.data.every(record => record.relationships.owner.data?.id === 'gina'),
        'the related-resource route still names the permitted owner');
    });

    test('[DEFECT] #234 AC4 — a model with no resolvable access predicate never appears in linkage', async function(assert) {
      // `undefined` from `getAccess` is NOT "this model is unrestricted". It
      // covers both "no access class claims it" and "the class that claims it
      // failed to LOAD" -- setup-rest-server catches a load failure, warns, and
      // publishes the PARTIAL map -- and the caller cannot tell those apart. So
      // the only safe reading is deny.
      // SWAPPED ONTO THE PERMANENT FIXTURE BY abofs/stonyx-orm#240.
      //
      // This drove `withAccess('trait', undefined, …)` -- deleting a registry
      // entry for the duration of the assertion -- because all five sample
      // models were claimed by `GlobalAccess`, so `getAccess()` never returned
      // `undefined` for anything in linkage range.
      //
      // #240's second fixture is strictly stronger than that override, and the
      // difference is not cosmetic. Deleting `accessFunctions.trait` leaves the
      // /traits routes MOUNTED; `tag` has no route at all, because a model no
      // access class claims is never mounted in the first place. So this now
      // asserts the shipped configuration rather than a hole punched into it.
      // ASSERTED AS A BOOLEAN, NOT `strictEqual(value, undefined)`. When this
      // reds the actual value is a FUNCTION, and qunit@2.25.0's
      // `prettyYamlValue` has no function branch: it reaches
      // `JSON.stringify(fn).split('\n')`, `JSON.stringify` of a function is
      // `undefined`, and the `.split` throws a TypeError at qunit.js:4024.
      // That kills the test QUEUE -- `runEnd` never fires and the express
      // listener holds the event loop open, so the suite HANGS instead of
      // going red. Measured: 0% CPU, every route still answering in ~1 ms from
      // an external client during the stall. A guard whose failure mode is a CI
      // hang is worse than one that cannot fail, because a hang is
      // indistinguishable from an infinite loop, a deadlock or a wedged socket.
      // Upstream: abofs/stonyx#97. Same reasoning as the precedent above at
      // `getAccess(inherited)`.
      assert.ok(Orm.instance.getAccess('tag') === undefined,
        'precondition: no predicate resolves for `tag` — no access class claims it');
      assert.strictEqual((await getJson('/tags/never-mounted')).status, 404,
        'precondition: and it has no REST surface of its own at all');
      assert.strictEqual(store.get('trait', 2)?.tag?.id, 'never-mounted',
        'precondition: while trait 2 really does resolve it — otherwise this assertion is vacuous');

      const { status, body } = await getJson('/traits/2');

      assert.strictEqual(status, 200, 'the request is not refused — only the linkage is dropped');
      assert.strictEqual(body.data.relationships.tag.data, null,
        'an unclaimed model is not named (was: {"type":"tag","id":"never-mounted"})');
      assert.ok(body.data.relationships.tag.links,
        'and the links survive — they are built from the SERIALIZED record id, never the related one');

      // The registry-override form is RETAINED as a second case, not replaced:
      // it covers the OTHER producer of `undefined`, which is an access class
      // that exists and failed to LOAD (setup-rest-server publishes the partial
      // map). The two are indistinguishable to `getAccess`, and that is exactly
      // why both read as a denial.
      await withAccess('trait', undefined, async () => {
        // Boolean, not `strictEqual` -- see the note at the `tag` assertion
        // above: a function in `actual` hangs qunit rather than reddening it.
        assert.ok(Orm.instance.getAccess('trait') === undefined,
          'a claimed model whose entry is missing reads identically');

        const scoped = await getJson('/animals/1');

        assert.strictEqual(scoped.status, 200, 'still 200');
        assert.deepEqual(scoped.body.data.relationships.traits.data, [],
          'and its linkage is dropped too (was: [{trait,1},{trait,2}])');
        assert.ok(scoped.body.data.relationships.traits.links, 'links intact');
      });

      // Restored, and observably so: a hole in the registry must not be sticky.
      const after = await getJson('/animals/1');
      assert.deepEqual(after.body.data.relationships.traits.data, [{ type: 'trait', id: 1 }, { type: 'trait', id: 2 }],
        'the registry entry was restored');
    });

    test('[DEFECT] #234 AC4b — a predicate that throws denies the linkage over the live router, and still answers 200', async function(assert) {
      // The two fail-closed `catch` branches in src/access-verdict.ts were DEAD
      // under the suite. Measured on the build this test was added to:
      //
      //   resolveVerdict catch  DENIED -> GRANTED            -> 979 / 0 / 0
      //   per-record catch      false  -> true               -> 979 / 0 / 0
      //   BOTH catch bodies replaced with `throw`            -> 979 / 0 / 0
      //
      // The third is the decisive one: neither block was entered by any test,
      // so the two fail-OPEN inversions above were invisible on a security
      // path. AC12 (test/unit/linkage-verdict-test.ts) enters both branches
      // directly; this asserts the property that actually ships — the status
      // the CONSUMER sees, over the live router, is still 200 and the ids are
      // withheld, rather than a 500 that is itself an existence oracle.
      const errorStub = sinon.stub(log, 'error');

      try {
        // BRANCH 1 — the consumer `access()` throws while being asked about a
        // related model. `trait` is the one linked type that normally resolves
        // to an unconditional grant, so its linkage is fully emitted otherwise.
        await withAccess('trait', () => { throw new Error('boom-in-access'); }, async () => {
          const { status, body } = await getJson('/animals/1');

          assert.strictEqual(status, 200, 'a throwing predicate is a denial, never a 500');
          assert.notOk('errors' in body, 'and no `errors` member — the drop shape is unchanged');
          assert.deepEqual(body.data.relationships.traits.data, [],
            'the linkage it could not authorise is dropped (was: [{trait,1},{trait,2}])');
          assert.ok(body.data.relationships.traits.links,
            'and the links survive — built from the SERIALIZED record id, never the related one');
          assert.ok(errorStub.getCalls().some(call => /access\(\) threw while resolving linkage/.test(call.args[0])),
            'the denial is logged — an emptied relationship is otherwise indistinguishable from an empty one');
        });

        // BRANCH 2 — `access()` returns a per-record predicate and THAT throws.
        // A different branch, reached only after a verdict has been granted.
        //
        // The target record is DERIVED, not hard-coded: animal 1's owner is
        // angela, who is already filtered out, so asserting against it would be
        // vacuously green. Find a record whose owner IS currently named.
        const before = await getJson('/animals');
        const withNamedOwner = before.body.data.find(record => record.relationships.owner.data);
        assert.ok(withNamedOwner, 'precondition: some animal names a permitted owner, or the next assertion is vacuous');

        const namedOwners = new Set(
          before.body.data.map(record => record.relationships.owner.data?.id).filter(Boolean)
        );
        assert.ok(namedOwners.size > 0, `precondition: the collection names ${namedOwners.size} distinct owners`);

        errorStub.resetHistory();

        await withAccess('owner', () => () => { throw new Error('boom-per-record'); }, async () => {
          const single = await getJson(`/animals/${withNamedOwner.id}`);

          assert.strictEqual(single.status, 200, 'still 200');
          assert.notOk('errors' in single.body, 'still no `errors` member');
          assert.strictEqual(single.body.data.relationships.owner.data, null,
            `the owner this record named seconds ago is withheld (was: ${JSON.stringify(withNamedOwner.relationships.owner.data)})`);

          const collection = await getJson('/animals');
          assert.strictEqual(collection.status, 200, 'and the collection surface too');
          assert.deepEqual(collection.body.data.filter(record => record.relationships.owner.data), [],
            `no record names any owner (was: ${namedOwners.size} distinct owners named)`);
          assert.ok(errorStub.getCalls().some(call => /access filter threw while filtering linkage/.test(call.args[0])),
            'logged, and with the OTHER message — the two branches are distinguishable in a log');
        });

        // Restored, and observably so — a throwing predicate must not be sticky.
        const after = await getJson('/animals');
        assert.deepEqual(
          [...new Set(after.body.data.map(record => record.relationships.owner.data?.id).filter(Boolean))].sort(),
          [...namedOwners].sort(),
          'every owner the collection named before the throwing predicate is named again after it');
      } finally {
        errorStub.restore();
      }
    });

    test('[GUARD] #234 AC6 — a filtered relationship is indistinguishable from an empty one', async function(assert) {
      // michael's `phone-numbers` is GENUINELY empty on this fixture, and
      // nothing in this file creates one for him. It is the oracle-free
      // reference shape, and it ALREADY SHIPS -- which is the whole reason
      // "drop, never error" costs no new wire format and gives a client
      // nothing to distinguish.
      const michael = await getJson('/owners/michael');
      const genuinelyEmpty = michael.body.data.relationships['phone-numbers'];

      assert.deepEqual(genuinelyEmpty, {
        data: [],
        links: {
          self: `${endpoint}/owners/michael/relationships/phone-numbers`,
          related: `${endpoint}/owners/michael/phone-numbers`
        }
      }, 'reference shape: a genuinely-empty hasMany is `data: []` WITH links');

      // A hasMany emptied entirely by the filter must match it key for key.
      await withAccess('animal', narrow('animal', () => false), async () => {
        const { status, body } = await getJson('/owners/michael');
        const filteredEmpty = body.data.relationships.pets;

        assert.strictEqual(status, 200, 'identical status');
        assert.notOk('errors' in body, 'no `errors` member');
        assert.deepEqual(Object.keys(filteredEmpty).sort(), Object.keys(genuinelyEmpty).sort(),
          'no extra key distinguishes a filtered hasMany from an empty one');
        assert.deepEqual(filteredEmpty, {
          data: [],
          links: {
            self: `${endpoint}/owners/michael/relationships/pets`,
            related: `${endpoint}/owners/michael/pets`
          }
        }, 'a filtered hasMany is byte-identical to the genuinely-empty shape');
      });

      // The belongsTo half. `data: null` WITH links already ships for a cleaned
      // relationship (pinned by test/unit/record-tojson-cleaned-test.ts).
      const animal = await getJson('/animals/1');
      assert.strictEqual(animal.status, 200, 'identical status');
      assert.notOk('errors' in animal.body, 'no `errors` member');
      assert.deepEqual(animal.body.data.relationships.owner, {
        data: null,
        links: {
          self: `${endpoint}/animals/1/relationships/owner`,
          related: `${endpoint}/animals/1/owner`
        }
      }, 'a filtered belongsTo is `data: null` WITH links');

      // Keeping the links is the load-bearing half. They are built from the
      // SERIALIZED record's own id, never the related one, so they disclose
      // nothing -- and stripping them for a filtered-empty relationship while
      // keeping them for a genuinely-empty one would MANUFACTURE the oracle
      // this change exists to close.
      assert.notOk(JSON.stringify(animal.body.data.relationships.owner.links).includes('angela'),
        'the surviving links name the serialized record, not the hidden one');
    });

    test('[GUARD] #234 AC7 — the verdict is cached per (type, id) and getAccess once per type', async function(assert) {
      // `included` is deduplicated by buildResponse; LINKAGE is not deduplicated
      // at all, so without a cache the module re-asks once per entry. Measured
      // by the refiner on a bare GET /animals: 48 linkage entries, 7 distinct
      // (type, id) pairs -- 6.9x.
      const getAccessSpy = sinon.spy(Orm.instance, 'getAccess');

      let predicateCalls = 0;   // consumer `access(request, context)` invocations
      let recordCalls = 0;      // per-record filter invocations

      const counting = model => {
        const original = Orm.instance.accessFunctions[model];

        return function(request, context) {
          predicateCalls++;
          const access = original.call(this, request, context);
          if (typeof access !== 'function') return access;

          return record => { recordCalls++; return access(record); };
        };
      };

      try {
        await withAccess('owner', counting('owner'), () =>
          withAccess('trait', counting('trait'), async () => {
            const { status, body } = await getJson('/animals');
            assert.strictEqual(status, 200);

            // Derived from the response and the store, never hard-coded: other
            // modules in this file leave records behind, and a hard-coded 48
            // would make this assertion a report on THEM.
            const ownerEntries = body.data.filter(record => 'owner' in record.relationships).length;
            const traitEntries = body.data.reduce((total, record) => total + (record.relationships.traits?.data.length ?? 0), 0);
            const distinctOwners = new Set(
              body.data.map(record => store.get('animal', record.id)?.owner?.id).filter(id => id !== undefined)
            );

            assert.ok(ownerEntries + traitEntries >= 48,
              `precondition: at least the measured 48 linkage entries on the bare collection surface (saw ${ownerEntries + traitEntries})`);

            assert.deepEqual([...new Set(getAccessSpy.getCalls().map(call => call.args[0]))].sort(), ['owner', 'trait'],
              'getAccess was asked about exactly the two linked types');
            assert.strictEqual(getAccessSpy.callCount, 2,
              'and exactly once per TYPE — not once per linkage entry');
            assert.strictEqual(predicateCalls, 2,
              `the consumer predicate was invoked once per type (was: ${ownerEntries + traitEntries} without the per-type verdict cache)`);
            assert.strictEqual(recordCalls, distinctOwners.size,
              `the per-record filter ran once per DISTINCT (type, id) — ${distinctOwners.size} times for ${ownerEntries} owner entries`);
            assert.ok(recordCalls < ownerEntries,
              `and that is strictly fewer than one call per entry (${recordCalls} < ${ownerEntries})`);

            // `trait` contributes ZERO per-record calls, and that is worth
            // stating rather than leaving as an unexplained shortfall against
            // the refinement's projected 7: GlobalAccess answers for `trait`
            // with a permission ARRAY, which `interpretAccess` reads as an
            // unconditional grant, so there is no per-record predicate to run.
            // The per-TYPE verdict cache elides that case entirely, which is
            // why the total lands BELOW the (type, id)-cache-only projection.
            assert.strictEqual(
              body.data.reduce((total, record) => total + (record.relationships.traits?.data.length ?? 0), 0),
              traitEntries,
              'every trait entry was still emitted despite zero per-record calls for that type');
          }));
      } finally {
        getAccessSpy.restore();
      }
    });

  });

  // ===========================================================================
  // #240 -- THE TWO DEFERRED ACCESS FIXTURES
  // ===========================================================================
  //
  // These assertions are about the FIXTURES, not about the fix. They exist
  // because a fixture that is inert makes every assertion built on it
  // vacuously green, and this repo has been blinded that way before (#190).
  //
  // ALL [GUARD], DELIBERATELY. Nothing here failed against pre-fixture `dev`;
  // there was nothing to fail, because the fixtures did not exist. Reporting
  // them as "failing pre-fix" would be the vacuous-check error in a costume.
  // The evidence they carry is a NAMED KILLED MUTATION, given at each one.
  //
  module('Deferred Access Fixtures (#240)', function(fixtureHooks) {
    // Idempotent, matching the #234 module above. Earlier modules in this file
    // create most of this and one of them -- `Data > removing records and
    // recreating them from db storage` -- unloads the WHOLE store and rebuilds
    // it from the saved db file, which carries no `tags` collection because an
    // unclaimed model is not persisted. So the tag record has to be re-seeded
    // here or every assertion about it is measuring the wrong store.
    //
    // Nothing below assumes the collection holds ONLY the fixture: every count
    // and every list is derived from the response or the store.
    fixtureHooks.before(function() {
      for (const category of serialized.categories) {
        if (!store.get('category', category.id)) createRecord('category', category);
      }
      if (!store.get('tag', 'never-mounted')) {
        createRecord('tag', { id: 'never-mounted', label: 'a collection the consumer never exposed' });
      }
      for (const owner of raw.owners) {
        if (!store.get('owner', owner.name)) createRecord('owner', owner);
      }
      for (const animal of raw.animals) {
        if (!store.get('animal', animal.id)) createRecord('animal', animal);
      }
    });

    const getJson = async path => {
      const response = await fetch(`${endpoint}${path}`);
      const body = response.status === 204 ? undefined : await response.json().catch(() => undefined);

      return { status: response.status, body };
    };

    test('[GUARD] #240 AC1 -- the hidden-child fixture hides a child of a PERMITTED parent', async function(assert) {
      // KILLING MUTATION: drop `&& record.id !== 18` from the animal branch of
      // test/sample/access/global-access.ts. The first assertion reds.
      //
      // The second and third are what stop this degenerating back into the
      // shipped `restricted`/21/22 shape, where the parent is hidden TOO and
      // the fixture proves nothing about a hasMany under a permitted parent.
      assert.strictEqual((await getJson('/animals/18')).status, 404,
        'GET /animals/18 is 404 -- the child is hidden');
      assert.strictEqual((await getJson('/owners/gina')).status, 200,
        'and GET /owners/gina is 200 -- the PARENT is permitted, which the pre-existing hidden animals could not offer');
      assert.strictEqual((await getJson('/owners/restricted')).status, 404,
        'contrast: animals 21 and 22 hang off a parent that is itself 404, which is why they made the hasMany half vacuous');

      // 404 is a DENIAL here, not an absence. Without this the fixture could be
      // satisfied by deleting the record.
      assert.ok(store.get('animal', 18), 'precondition: animal 18 EXISTS in the store');
      assert.strictEqual(store.get('animal', 18).owner?.id, 'gina', 'and it really is gina\'s');
    });

    test('[GUARD] #240 AC2 -- the hasMany linkage surface is red-able, and the two surfaces disagree without #232', async function(assert) {
      // KILLING MUTATION: the same one as AC1 -- without the deny rule, `pets`
      // names 18 and the first assertion reds.
      const { status, body } = await getJson('/owners/gina');
      const pets = body.data.relationships.pets.data.map(record => record.id);

      assert.strictEqual(status, 200, 'the permitted parent is served');
      assert.notOk(pets.includes(18), '#234 drops the hidden child from the linkage on the parent\'s own document');

      // Derived from the store, never hard-coded: other modules in this file
      // create animals of their own and one of them re-parents onto gina.
      const owned = store.get('owner', 'gina').pets.map(pet => pet.id);
      assert.ok(owned.includes(18), 'precondition: gina really OWNS 18 -- the drop above is a filter, not missing data');
      assert.deepEqual(pets.slice().sort(), owned.filter(id => id !== 18).sort(),
        'and ONLY that child was dropped -- every other pet is still named');
    });

    test('[GUARD] #240 AC3 -- the unclaimed model is genuinely unclaimed AND genuinely unmounted', async function(assert) {
      // FOUR CLAUSES, AND THE LAST TWO ARE NOT REDUNDANT. The tempting
      // symmetric construction -- a second access class declaring `models: []`
      // -- leaves `getAccess('tag')` undefined and `accessFunctions` without a
      // `tag` key, so the first two clauses PASS while
      // `setup-rest-server.ts:32`'s unvalidated early return (abofs/stonyx-orm#225)
      // silently mounts nothing and warns about nothing. Only the ROUTE clauses
      // catch it.
      //
      // KILLING MUTATION: add `'tag'` to `GlobalAccess.models`. Clauses 1, 2, 3
      // and 4 all red.
      // Boolean, not `strictEqual` -- a function in `actual` hangs qunit. See
      // the note at #234 AC4 and abofs/stonyx#97.
      assert.ok(Orm.instance.getAccess('tag') === undefined,
        'no access class claims `tag`, so no predicate resolves for it');
      assert.notOk(Object.hasOwn(Orm.instance.accessFunctions, 'tag'),
        'and it is absent from the registry entirely, not present-but-undefined');
      assert.deepEqual(Object.keys(Orm.instance.accessFunctions).sort(),
        ['animal', 'category', 'owner', 'phone-number', 'trait'],
        'the five claimed models are unchanged -- nothing was unclaimed to construct this');

      assert.strictEqual((await getJson('/tags')).status, 404, 'GET /tags -- no collection route is mounted');
      assert.strictEqual((await getJson('/tags/never-mounted')).status, 404, 'GET /tags/{id} -- no record route either');

      // And the model IS registered with the ORM. Without this the fixture
      // could be satisfied by a model that does not exist, which would make
      // every relationship assertion about it vacuous.
      assert.ok(store.get('tag', 'never-mounted'), 'the RECORD exists -- only the route does not');
    });

    test('[GUARD] #240 AC4 -- the unclaimed model is REACHABLE from a claimed one, so the fixture is not inert', async function(assert) {
      // THIS AC IS THE FIXTURE'S REASON TO EXIST. A `tag` model nothing links
      // to would satisfy AC3 completely and prove nothing: every assertion in
      // the #232 module below would pass against a relationship that was always
      // empty.
      //
      // KILLING MUTATION: drop `tag: 'never-mounted'` from the colour trait in
      // test/sample/serializers/animal.ts. The first two assertions red.
      const trait = store.get('trait', 2);
      assert.strictEqual(trait?.tag?.id, 'never-mounted',
        'trait 2 resolves a record of a model no access class claims');
      assert.strictEqual(store.get('trait', 1)?.tag ?? null, null,
        'and trait 1 does not -- a negative control, so "hidden" is not confused with "never linked"');

      // The disclosure surface, as it stands AFTER #232. The primary document
      // withholds the id (#234) while the relationship LINKS still point at a
      // route that 404s -- which is what made the two relationship route
      // families the live leak, and they are asserted in the #232 module.
      const { status, body } = await getJson('/traits/2');
      assert.strictEqual(status, 200, 'the claimed parent is served');
      assert.strictEqual(body.data.relationships.tag.data, null,
        '#234 already withholds the unclaimed id from the primary document');
      assert.ok(body.data.relationships.tag.links.related.endsWith('/traits/2/tag'),
        'and the links survive -- they are built from the SERIALIZED record id, so the route below is genuinely offered to a caller');
    });

    test('[GUARD] #240 AC6 -- negative controls: hiding everything would satisfy the fixtures otherwise', async function(assert) {
      // KILLING MUTATION: widen the animal deny to `record => false`, or add a
      // `model === 'category'` deny. Either reds this test while leaving AC1
      // through AC4 green -- which is the whole point of a negative control.
      const gina = await getJson('/owners/gina');
      const pets = gina.body.data.relationships.pets.data.map(record => record.id);

      for (const id of [4, 8, 13]) {
        assert.ok(pets.includes(id), `a PERMITTED child under a permitted parent is still named (animal ${id})`);
      }

      const trait = await getJson('/traits/2');
      assert.deepEqual(trait.body.data.relationships.category.data, { type: 'category', id: 'appearance' },
        'and a CLAIMED related model is still named -- only the unclaimed one is withheld');
    });
  });

  // ===========================================================================
  // #232 -- THE ACCESS FILTER ON THE TWO RELATIONSHIP ROUTE FAMILIES
  // ===========================================================================
  //
  // `GET /:id/{relationship}` and `GET /:id/relationships/{relationship}`
  // filtered the PARENT only. A record its own model's predicate hides was
  // therefore served, in full, from another model's route -- at ZERO query
  // parameters, on the default request.
  //
  // THE LIVE SUBJECT IS THE UNCLAIMED-MODEL CASE (AC5). The `archived` owner is
  // NOT a leak on this surface and no assertion here claims it is: that record
  // is served by a plain `GET /owners`, so a sideload disclosing it is
  // consistent with the collection route rather than a bypass. It is
  // abofs/stonyx-orm#243's.
  //
  // ASSERTION LABELS, as elsewhere in this file:
  //   [DEFECT] -- observed FAILING against unfixed dev @ 8dda5d6 + the #240
  //               fixtures. The failing TAP is in the pull request body.
  //   [GUARD]  -- passes on dev today; carries a named killed mutation instead.
  //
  module('Relationship Route Access (#232)', function(routeHooks) {
    routeHooks.before(function() {
      // See the #240 module's hook -- same reason, same idempotence.
      if (!store.get('tag', 'never-mounted')) {
        createRecord('tag', { id: 'never-mounted', label: 'a collection the consumer never exposed' });
      }
      for (const owner of raw.owners) {
        if (!store.get('owner', owner.name)) createRecord('owner', owner);
      }
      for (const animal of raw.animals) {
        if (!store.get('animal', animal.id)) createRecord('animal', animal);
      }
    });

    const getJson = async path => {
      const response = await fetch(`${endpoint}${path}`);
      const body = response.status === 204 ? undefined : await response.json().catch(() => undefined);

      return { status: response.status, body };
    };

    test('[DEFECT] #232 AC1 -- GET /:id/{rel} belongsTo: a related record its own model hides is not served', async function(assert) {
      // PRE-FIX: 200, `data.id === "angela"`, attributes
      //          {"gender":"female","age":36,"totalPets":8}.
      const hidden = await getJson('/owners/angela');
      assert.strictEqual(hidden.status, 404, 'precondition: angela is 404 on her OWN route');

      const { status, body } = await getJson('/animals/1/owner');

      assert.strictEqual(status, 200, 'the related-resource route answers 200 -- withholding is not an error');
      assert.strictEqual(body.data, null, 'and she is not served: `data` is null (was: her full document)');

      // AND THE WITHHOLDING IS INDISTINGUISHABLE FROM A GENUINELY ABSENT
      // TARGET, which is the whole reason the denial is spelled `null` rather
      // than 404. Animal 9100 has no owner at all.
      createRecord('animal', { id: 9100, type: 'dog', age: 1, size: 'small' });
      const absent = await getJson('/animals/9100/owner');
      store.remove('animal', 9100);

      assert.strictEqual(absent.status, status, 'same status as an animal with no owner at all');
      assert.strictEqual(
        JSON.stringify(body).split('/animals/1/').join('/animals/9100/'),
        JSON.stringify(absent.body),
        'and the same bytes, modulo the parent id the caller put in the URL -- no existence oracle');
    });

    test('[DEFECT] #232 AC2 -- GET /:id/relationships/{rel} belongsTo: the hand-built linkage is filtered too', async function(assert) {
      // This is the surface that builds `{ type, id }` BY HAND rather than
      // through `toJSON()` (src/orm-request.ts), which is why #234's filter
      // never reached it. PRE-FIX: 200, `{"type":"owner","id":"angela"}`.
      const { status, body } = await getJson('/animals/1/relationships/owner');

      assert.strictEqual(status, 200, 'the linkage route answers 200');
      assert.strictEqual(body.data, null, 'and withholds the hidden owner: `data` is null');

      // Same indistinguishability check as AC1, on the hand-built family.
      createRecord('animal', { id: 9100, type: 'dog', age: 1, size: 'small' });
      const absent = await getJson('/animals/9100/relationships/owner');
      store.remove('animal', 9100);

      assert.strictEqual(absent.status, status, 'same status as an animal with no owner at all');
      assert.strictEqual(
        JSON.stringify(body).split('/animals/1/').join('/animals/9100/'),
        JSON.stringify(absent.body),
        'and the same bytes, modulo the parent id -- no existence oracle');
    });

    test('[DEFECT] #232 AC3 -- GET /:id/{rel} hasMany: a hidden child is dropped from the related-resource array', async function(assert) {
      // PRE-FIX: gina's pets list served animal 18 as a full document, while
      // her own document's linkage had already dropped it (#234). The two
      // surfaces DISAGREED, which is the proof the fixture bites.
      const { status, body } = await getJson('/owners/gina/pets');
      const served = body.data.map(record => record.id);

      assert.strictEqual(status, 200, 'the permitted parent is still served');
      assert.notOk(served.includes(18), 'the hidden child is not among the related records');

      const owned = store.get('owner', 'gina').pets.map(pet => pet.id);
      assert.ok(owned.includes(18), 'precondition: she OWNS it, so the drop is a filter');
      assert.deepEqual(served.slice().sort(), owned.filter(id => id !== 18).sort(),
        'and ONLY that child was dropped');

      // The two surfaces now AGREE, which is the property #240 AC2 measured as
      // absent before the fix.
      const parent = await getJson('/owners/gina');
      assert.deepEqual(served.slice().sort(), parent.body.data.relationships.pets.data.map(r => r.id).sort(),
        'the related-resource route and the parent document\'s linkage name the same set');
    });

    test('[DEFECT] #232 AC4 -- GET /:id/relationships/{rel} hasMany: the hidden child is dropped from the linkage array', async function(assert) {
      // PRE-FIX: `[{animal,8},{animal,13},{animal,18},...]`.
      const { status, body } = await getJson('/owners/gina/relationships/pets');
      const named = body.data.map(entry => entry.id);

      assert.strictEqual(status, 200, 'still 200');
      assert.ok(body.data.every(entry => entry.type === 'animal'), 'and still linkage objects');
      assert.notOk(named.includes(18), 'the hidden child is not named');

      const owned = store.get('owner', 'gina').pets.map(pet => pet.id);
      assert.deepEqual(named.slice().sort(), owned.filter(id => id !== 18).sort(),
        'and ONLY that child was dropped');
    });

    test('[DEFECT] #232 AC5 -- the unclaimed-model leak, at ZERO query parameters, on BOTH route families', async function(assert) {
      // THIS ISSUE'S LIVE SUBJECT. `tag` is claimed by no access class, so
      // `getAccess('tag')` is `undefined` and NO route is mounted for it --
      // a collection the consumer deliberately never exposed. Pre-fix both of
      // these served it anyway, with no query string of any kind:
      //
      //   GET /traits/2/tag                 -> 200 {"attributes":{"label":...},
      //                                             "id":"never-mounted",
      //                                             "type":"tag",
      //                                             "links":{"self":".../tags/never-mounted"}}
      //   GET /traits/2/relationships/tag   -> 200 {"type":"tag","id":"never-mounted"}
      //
      // Note the `links.self` in the first one: a link to a route that 404s.
      //
      // TRAIT 1 IS THE ORACLE CONSTRUCTOR AND IT IS WHY THE DENIAL IS SPELLED
      // `data: null` RATHER THAN 404. Trait 1 carries no tag at all; trait 2
      // carries one this caller may not see. Under 404 those two answered
      // 200/application-json/68 bytes and 404/text-plain/9 bytes -- one
      // unauthenticated request each, zero query parameters, on the model with
      // NO route mounted. Under `null` they answer identically.
      assert.strictEqual((await getJson('/tags/never-mounted')).status, 404,
        'precondition: the model has no REST surface of its own');
      assert.strictEqual(store.get('trait', 2)?.tag?.id, 'never-mounted',
        'precondition: and trait 2 really does resolve it, so these routes have something to leak');

      assert.strictEqual(store.get('trait', 1)?.tag, null,
        'precondition: trait 1 carries NO tag, so it is the genuinely-absent control');

      const related = await getJson('/traits/2/tag');
      assert.strictEqual(related.status, 200, 'the related-resource route answers 200');
      assert.strictEqual(related.body.data, null, 'and no longer discloses it: `data` is null');

      const linkage = await getJson('/traits/2/relationships/tag');
      assert.strictEqual(linkage.status, 200, 'the linkage route answers 200');
      assert.strictEqual(linkage.body.data, null, 'nor does it disclose it');

      // THE ORACLE, CLOSED. Denied (trait 2) against genuinely absent (trait 1),
      // byte for byte modulo the parent id in the URL.
      const absentRelated = await getJson('/traits/1/tag');
      assert.strictEqual(absentRelated.status, related.status, 'denied and absent answer the same status');
      assert.strictEqual(
        JSON.stringify(related.body).split('/traits/2/').join('/traits/1/'),
        JSON.stringify(absentRelated.body),
        'and the same bytes -- a caller cannot tell a withheld tag from no tag');

      const absentLinkage = await getJson('/traits/1/relationships/tag');
      assert.strictEqual(absentLinkage.status, linkage.status, 'the linkage family too');
      assert.strictEqual(
        JSON.stringify(linkage.body).split('/traits/2/').join('/traits/1/'),
        JSON.stringify(absentLinkage.body),
        'and the same bytes there as well');

      // `undefined` from `getAccess` is NOT "unrestricted". It covers both "no
      // access class claims this model" and "the class that claims it failed to
      // LOAD" -- setup-rest-server publishes the PARTIAL map on a load failure
      // -- and the caller cannot tell them apart, so the only safe reading is
      // deny.
      // Boolean, not `strictEqual` -- a function in `actual` hangs qunit. See
      // the note at #234 AC4 and abofs/stonyx#97.
      assert.ok(Orm.instance.getAccess('tag') === undefined,
        'and the reason is an UNRESOLVABLE predicate, which fails closed');
    });

    test('[GUARD] #232 AC6 -- negative control: permitted related resources are still served on both families', async function(assert) {
      // THE CHECK THAT CATCHES OVER-DENIAL, and it is the one that killed the
      // `undefined`-argument-one design during refinement: with `undefined` the
      // shipped fixture denies `owner` outright and this test reds while every
      // [DEFECT] above stays green.
      //
      // KILLING MUTATION: pass `undefined` instead of `request` to
      // `createLinkageFilter` at either call site. All four assertions red.
      const belongsTo = await getJson('/animals/4/owner');
      assert.strictEqual(belongsTo.status, 200, 'a permitted belongsTo target is still served in full');
      assert.strictEqual(belongsTo.body.data.id, 'gina', 'and it is the right record');
      assert.ok(belongsTo.body.data.attributes, 'with its attributes');

      const claimed = await getJson('/traits/2/category');
      assert.strictEqual(claimed.status, 200, 'a CLAIMED related model is still served -- only the unclaimed one is withheld');
      assert.strictEqual(claimed.body.data.id, 'appearance', 'and it is the right record');

      const linkage = await getJson('/traits/2/relationships/category');
      assert.deepEqual(linkage.body.data, { type: 'category', id: 'appearance' },
        'and its linkage route too');

      const hasMany = await getJson('/owners/gina/pets');
      for (const id of [4, 8, 13]) {
        assert.ok(hasMany.body.data.some(record => record.id === id),
          `a permitted child is still served on the hasMany family (animal ${id})`);
      }
    });

    test('[GUARD] #232 AC7 -- the PARENT filter is unchanged, and still fires first', async function(assert) {
      // #190's guarantee. The related-record filter is ADDITIONAL to it, not a
      // replacement, and a caller who may not see the parent still may not see
      // what it is related to.
      //
      // KILLING MUTATION: delete `if (isDenied(filter, record)) return 404;`
      // from either route. The first two assertions red.
      assert.strictEqual((await getJson('/owners/angela/pets')).status, 404,
        'a denied parent is 404 on the related-resource route');
      assert.strictEqual((await getJson('/owners/angela/relationships/pets')).status, 404,
        'and on the linkage route');
      assert.strictEqual((await getJson('/owners/nonexistent/pets')).status, 404,
        'and a parent that does not exist is the same 404 -- the route is not an existence oracle for the PARENT');
    });

    test('[GUARD] #232 AC8 -- drop, never error: a filtered hasMany is shaped exactly like a genuinely empty one', async function(assert) {
      // KILLING MUTATION: return 403 (or push an `errors` member) instead of
      // dropping the denied members. Every assertion below reds.
      //
      // michael's `phone-numbers` is GENUINELY empty on this fixture, which is
      // what makes this a comparison rather than a description.
      const genuinelyEmpty = await getJson('/owners/michael/phone-numbers');
      assert.strictEqual(genuinelyEmpty.status, 200, 'precondition: a genuinely empty hasMany answers 200');
      assert.deepEqual(genuinelyEmpty.body.data, [], 'precondition: with an empty array');

      const filtered = await getJson('/owners/gina/pets');
      assert.strictEqual(filtered.status, genuinelyEmpty.status, 'a FILTERED hasMany answers the same status');
      assert.deepEqual(Object.keys(filtered.body).sort(), Object.keys(genuinelyEmpty.body).sort(),
        'and the same top-level members -- `links` and `data`, nothing else');
      assert.notOk('errors' in filtered.body, 'no `errors` member');
      assert.ok(filtered.body.links.self.endsWith('/owners/gina/pets'), 'and the links survive the drop');

      const filteredLinkage = await getJson('/owners/gina/relationships/pets');
      assert.notOk('errors' in filteredLinkage.body, 'the linkage family too');
      assert.ok(filteredLinkage.body.links.related.endsWith('/owners/gina/pets'),
        'with both of its links intact');
    });

    test('[GUARD] #232 AC9 -- the LIVE request reaches the predicate, and `recordId` stays null', async function(assert) {
      // THE ARGUMENT-ONE CONTRACT, PINNED AS BEHAVIOUR RATHER THAN AS A COMMENT.
      // Argument one is the request the ROUTER dispatched -- not a fabricated
      // one addressing the related resource, and not `undefined`.
      //
      // WHAT NOTHING PINNED BEFORE, AND THE CITATION THAT WAS WRONG.
      //
      // A prototype-derived request -- `createLinkageFilter(Object.create(request))`
      // -- measures 1015 / 0 at both new call sites, and 1015 / 0 at all four
      // including #234's. The pin previously cited for this decision, the
      // identity assertion in test/unit/linkage-verdict-test.ts (the #234 AC13
      // guard, `strictEqual(seen[0].request, READ_REQUEST)`), calls
      // `createLinkageFilter(READ_REQUEST)` DIRECTLY -- so it pins the
      // function's pass-through and says nothing about what any CALL SITE
      // hands it. And the three property assertions below are all satisfied by
      // a derived request, because a prototype-derived object INHERITS them.
      //
      // So the decision is guarded here, by OWN-PROPERTY IDENTITY, in two
      // assertions that between them describe what "the live request" means
      // structurally rather than by value:
      //
      //   `params` is an OWN property of the object handed to the predicate.
      //     Express sets it on the request the router dispatched;
      //     `Object.create(request)` INHERITS it, so `ask.request.params.id`
      //     still reads `'4'` (which is why the three value assertions above
      //     are all satisfied by a derived request) while `Object.hasOwn` is
      //     false. Measured on the derived mutant: every own-property read on
      //     that object -- `params`, `headers`, `url`, `path`, `method`,
      //     `query`, `baseUrl` -- is `false`.
      //
      //   nothing request-shaped sits BEHIND it on the prototype chain. This is
      //     the general form, and it is what catches a derived request that
      //     re-declares `params` on top (the original fabricated design):
      //     deriving from the live request necessarily puts the live request --
      //     which owns `params` -- at `Object.getPrototypeOf`. On the real
      //     object that slot holds express's request prototype, which does not.
      //
      // A PLANTED MARKER WAS TRIED FIRST AND DOES NOT WORK HERE, recorded so it
      // is not re-attempted: `auth()` calls the access function CAPTURED at
      // OrmRequest construction, not `Orm.instance.accessFunctions`, so
      // overriding the registry never sees the live request on this route --
      // under the mutant the ONLY object the registry is ever handed is the
      // derived one, and an unconditional plant marks it own and goes green.
      //
      // KILLING MUTATIONS, each constructed and observed:
      //   supply `Object.create(request)` at either new call site  -> the two
      //     structural assertions red. NOTHING ELSE IN THE SUITE DOES: measured
      //     1015 / 0 with the derived request at both new call sites, and
      //     1015 / 0 with it at all four including #234's. That measurement is
      //     the whole reason these two assertions exist.
      //   supply `undefined`                                       -> the
      //     header assertion reds, and #232 AC6 reds with it
      //   supply a fabricated `{ path }` addressing the related resource ->
      //     the header, `params.id` and marker assertions all red
      //   seed `recordId` from the related record                  -> the
      //     `recordId` assertion reds (and two #234 guards red with it)
      const seen = [];
      const registry = Orm.instance.accessFunctions;
      const original = registry.owner;

      registry.owner = function(request, context) {
        seen.push({ request, context });

        return original.call(this, request, context);
      };

      try {
        const response = await fetch(`${endpoint}/animals/4/owner`, { headers: { 'x-orm-232-probe': 'live' } });
        assert.strictEqual(response.status, 200, 'precondition: the permitted case, so the predicate is actually reached');

        const ask = seen.find(entry => entry.context?.model === 'owner');
        assert.ok(ask, 'precondition: the owner predicate was asked about `owner`');

        assert.strictEqual(ask.request?.headers?.['x-orm-232-probe'], 'live',
          'argument one is the LIVE request -- it carries a header only the real one has');
        assert.strictEqual(ask.request?.params?.id, '4',
          'and it still names the PRIMARY record, `animal 4` -- nothing was fabricated to address the owner');
        assert.ok(ask.request?.path?.endsWith('/owner'),
          'and the primary route, mount-relative');

        assert.ok(Object.hasOwn(ask.request, 'params'),
          'and `params` is an OWN property of it -- a request derived with `Object.create(request)` INHERITS `params`, so every assertion above still passes against one while this reds');
        assert.notOk(Object.getPrototypeOf(ask.request)?.params,
          'and nothing request-shaped sits behind it on the prototype chain -- deriving from the live request would put the live request, which owns `params`, exactly there');

        assert.strictEqual(ask.context.recordId, null,
          '`recordId` is null: this route addresses no record OF THE MODEL BEING ASKED ABOUT, and a hasMany route addresses many');
        assert.strictEqual(ask.context.operation, 'read', 'and the operation is a read');
      } finally {
        registry.owner = original;
      }
    });

    test('[DISCLOSURE] #232 AC10 -- a consumer predicate cannot express a PER-RECORD deny for a related resource', async function(assert) {
      // THE RESIDUAL THIS FIX LEAVES, PINNED AS BEHAVIOUR SO IT CANNOT BE
      // QUIETLY CLOSED OR QUIETLY FORGOTTEN. It follows directly from AC9:
      // `recordId` is `null` and `request.params` names a record of a DIFFERENT
      // model, so the only inputs a predicate has for a related-resource ask are
      // the model name, the operation and the request. Model-level and
      // request-level denies work. Record-level ones do not.
      //
      // The per-record FILTER shape still works -- `access()` may return a
      // function and that function receives the whole record. What cannot work
      // is a predicate that branches on WHICH record it is being asked about
      // BEFORE returning, because it is not told.
      //
      // KILLING MUTATION, AND IT IS NOT THE OBVIOUS ONE. Seeding `recordId`
      // from `request.params.id` in `resolveVerdict` leaves this test ENTIRELY
      // GREEN (measured: 1012 / 3, none of them here) -- it hands the predicate
      // the PARENT's id, `'4'`, which the branch below does not match. And
      // seeding it from the record is not even constructible at that site:
      // `resolveVerdict` resolves once per TYPE, before any record has been
      // looked at, so there is no record in scope -- as the file's own comment
      // explains.
      //
      // The mutation that DOES kill it is the per-RECORD variant, in
      // `createLinkageFilter`'s returned `isLinkable`: re-resolve the verdict
      // for every record with `recordId` seeded from `record.id` instead of
      // reading the per-type cache. Constructed and measured: this test reds on
      // `the record it meant to deny is served`. That variant is rejected
      // because it multiplies consumer `access()` calls per request and because
      // #234's per-type cache is the contract; it is named here so this
      // assertion is not dead weight.
      const registry = Orm.instance.accessFunctions;
      const original = registry.owner;
      const contexts = [];

      registry.owner = function(request, context) {
        contexts.push(context);

        // A predicate trying to express "deny owner `gina` specifically" from
        // the context alone. It has nothing to key on.
        if (context.recordId === 'gina') return false;

        return original.call(this, request, context);
      };

      try {
        const response = await getJson('/animals/4/owner');

        assert.ok(contexts.some(context => context.model === 'owner'), 'precondition: the predicate was consulted');
        // THE STATUS CANNOT CARRY THIS CLAIM. Since a denied belongsTo target
        // answers `200 {data: null}`, a 200 here is equally consistent with the
        // deny having fired -- so the discriminating assertion is the BODY.
        assert.strictEqual(response.status, 200, 'the route answers 200 either way');
        assert.strictEqual(response.body.data?.id, 'gina',
          'DISCLOSED LIMIT: the per-record deny above did NOT fire and the record it meant to deny is served -- the predicate is never told which related record it is being asked about');
        assert.ok(contexts.every(context => context.recordId === null || context.recordId === '4'),
          'because `recordId` is null for the cross-model ask, and `4` only for the route\'s own model');
      } finally {
        registry.owner = original;
      }

      // AND THE TWO SHAPES THAT DO WORK, so the disclosure is a boundary rather
      // than a blanket. Both are already asserted above; named here so a reader
      // of this test is not left thinking nothing works.
      assert.strictEqual((await getJson('/traits/2/tag')).body.data, null,
        'a MODEL-level deny works (the unclaimed model, AC5)');
      assert.strictEqual((await getJson('/animals/1/owner')).body.data, null,
        'and a per-record FILTER returned by access() works (angela, AC1) -- it receives the whole record');
    });
  });

  // ===========================================================================
  // #235 -- LINKAGE ON THE TWO WRITE HANDLERS, AND INSIDE `included`
  // ===========================================================================
  //
  // #234 filtered `relationships.*.data` on the four request-bound READ
  // surfaces. Three surfaces were left, and all three still publish the ids
  // those four withhold. Measured over the live express router on dev @
  // 8dda5d6, with `GET /owners/angela` answering 404 throughout:
  //
  //     PATCH /animals/1  {age:N}            -> 200, owner.data {owner, angela}
  //     POST  /animals    {owner:'angela'}   -> 200, owner.data {owner, angela}
  //     GET   /animals/1?include=owner,owner.pets
  //                                          -> 8 included `animal` records,
  //                                             EACH naming {owner, angela}
  //                                             (9 included RESOURCES; the
  //                                             ninth is the hidden owner)
  //
  // `POST` is a SECOND, INDEPENDENT VECTOR rather than a variant of `PATCH`.
  // The two handlers are separate functions with different option objects
  // (`createHandler` passes `{ fields }`, `updateHandler` passes nothing), so a
  // fix wired into one and not the other passes a PATCH-only criterion. W1 and
  // W2 are therefore two assertions, not one parameterised over a verb.
  //
  // ---------------------------------------------------------------------------
  // WHY EVERY WRITE ASSERTION HERE IS A [DEFECT] AND NONE IS A RE-SPECIFICATION
  // ---------------------------------------------------------------------------
  // The whole write half is six changed lines and it moved NO existing test:
  // dev @ 8dda5d6 with both handlers bound and both `toJSON` calls given
  // `createLinkageFilter(request)` measures 995 pass / 0 fail, the same numbers
  // as unpatched dev. That is not evidence the fix is clean -- it is evidence
  // that no assertion among the 995 could have caught the leak, and that none
  // could catch its regression. Each [DEFECT] below was run against unfixed
  // `dev` and its failure output is in the PR body.
  //
  // ---------------------------------------------------------------------------
  // WHAT THIS MODULE DELIBERATELY DOES NOT TOUCH
  // ---------------------------------------------------------------------------
  //   - `GET /:models/:id/relationships/{relationship}` builds its
  //     `{type, id}` linkage BY HAND and never calls `toJSON`, so the `linkage`
  //     OPTION cannot reach it. It is abofs/stonyx-orm#232's -- its primary
  //     data IS linkage, which makes filtering it a MEMBERSHIP decision -- and
  //     PR #247 is in flight against it in this sprint. X2 therefore pins the
  //     OWNERSHIP BOUNDARY, not the route's current answer; see its comment.
  //     Wiring #235's filter in there measures 1009/2 against this branch's
  //     1011/0 baseline, and turns
  //     `GET /animals/:id/relationships/owner returns relationship linkage`
  //     red, which is #232's own reproduction. (An earlier revision said
  //     993/2 -- that is 995, the DEV baseline, from a branch where X2 does
  //     not exist. Counts here are quoted with their baseline for that
  //     reason.)
  //   - WHETHER a resource enters `included` at all is membership, and it is
  //     abofs/stonyx-orm#233's. X1 pins #233's reproduction (a hidden owner IS
  //     still a member) green, so that this story cannot satisfy #233's
  //     criterion incidentally and #233 still arrives with something to prove.
  //
  // ---------------------------------------------------------------------------
  // NOTHING BELOW HARD-CODES A COLLECTION MEMBERSHIP
  // ---------------------------------------------------------------------------
  // Earlier modules in this file create records and leave some behind -- gina
  // owns five animals by the time this module runs, not the four the fixture
  // ships, and one of them has no traits. Every expected id set is read out of
  // the store or off the response at assertion time. A hard-coded list here
  // would be an assertion about which modules ran first.
  //
  // ASSERTION LABELS, as in the #234 module above:
  //   [DEFECT] -- observed FAILING against unfixed dev at 8dda5d6.
  //   [GUARD]  -- passes on dev today; each names the mutation that kills it.
  // Where one test carries both, every assertion is labelled inline.
  //
  module('Write & Included Linkage Access (#235)', function(writeHooks) {
    writeHooks.before(function() {
      // Idempotent, exactly as the #234 module's own `before` is: earlier
      // modules in this file have created most of this already.
      for (const category of serialized.categories) {
        if (!store.get('category', category.id)) createRecord('category', category);
      }
      for (const owner of raw.owners) {
        if (!store.get('owner', owner.name)) createRecord('owner', owner);
      }
      for (const animal of raw.animals) {
        if (!store.get('animal', animal.id)) createRecord('animal', animal);
      }
    });

    const getJson = async path => {
      const response = await fetch(`${endpoint}${path}`);
      const body = response.status === 204 ? undefined : await response.json().catch(() => undefined);

      return { status: response.status, body };
    };

    const sendJson = async (method, path, payload) => {
      const response = await fetch(`${endpoint}${path}`, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const body = response.status === 204 ? undefined : await response.json().catch(() => undefined);

      return { status: response.status, body };
    };

    // Read a hasMany's member ids straight out of the store, so an expectation
    // is never a transcription of the fixture file.
    const storeIds = (model, id, relationship) =>
      [...(store.get(model, id)?.[relationship] ?? [])]
        .map(member => member?.id ?? member)
        .sort((a, b) => (a > b ? 1 : a < b ? -1 : 0));

    /**
     * Replace one registry entry for the duration of `fn`, then restore it.
     * Same construction as the #234 module's, and for the same reason:
     * `Orm.instance.accessFunctions` holds ONE function object under several
     * model keys, so the replacement is written to a single KEY and every other
     * model resolves through the untouched original. Deliberately a local copy
     * rather than a hoist out of the #234 module -- moving that helper would
     * edit a module this story does not own.
     */
    const withAccess = async (model, replacement, fn) => {
      const registry = Orm.instance.accessFunctions;
      const had = Object.hasOwn(registry, model);
      const original = registry[model];

      if (replacement === undefined) delete registry[model];
      else registry[model] = replacement;

      try {
        return await fn();
      } finally {
        if (had) registry[model] = original;
        else delete registry[model];
      }
    };

    /**
     * TIGHTEN a model's real predicate with an extra per-record rule rather
     * than replacing it, so an assertion cannot pass because the fixture was
     * swapped for something permissive.
     *
     * ONLY USABLE ON A MODEL WHOSE `access()` RETURNS A PER-RECORD FUNCTION.
     * `GlobalAccess` answers for `trait` with a permission ARRAY, which this
     * passes through untouched -- so `narrow('trait', () => false)` is a no-op
     * and an assertion built on it would be vacuously green. `animal` and
     * `owner` return functions; those are the two this may be used on.
     */
    const narrow = (model, extra) => {
      const original = Orm.instance.accessFunctions[model];

      return function(request, context) {
        const access = original.call(this, request, context);
        if (typeof access !== 'function') return access;

        return record => access(record) && extra(record);
      };
    };

    test('[DEFECT] #235 W1 — PATCH /animals/1 does not name a hidden owner id', async function(assert) {
      // PRECONDITION, asserted rather than assumed. If angela ever stops being
      // hidden this whole module goes vacuously green, and this fixture has
      // been blinded that way before (#190).
      const hidden = await getJson('/owners/angela');
      assert.strictEqual(hidden.status, 404, 'precondition: GET /owners/angela is 404 — her existence is withheld');

      // And the READ surface for the SAME record already withholds her, which
      // is what makes this a one-verb bypass rather than an unfixed read.
      const read = await getJson('/animals/1');
      assert.strictEqual(read.body.data.relationships.owner.data, null,
        'precondition: GET /animals/1 (a #234 surface) already returns owner.data null');

      const originalAge = read.body.data.attributes.age;
      assert.strictEqual(typeof originalAge, 'number', 'precondition: animal 1 has a numeric age to move');

      try {
        const { status, body } = await sendJson('PATCH', '/animals/1', {
          data: { type: 'animal', id: '1', attributes: { age: originalAge + 1 } }
        });

        assert.strictEqual(status, 200, 'the update is permitted and still answers 200');

        // THE UPDATE REALLY HAPPENED. Without this the assertion below would
        // hold equally against a handler that rejected the body outright, and
        // "PATCH does not leak" would be true for the wrong reason.
        assert.strictEqual(body.data.attributes.age, originalAge + 1, 'precondition: the attribute was actually applied');

        // [DEFECT] Measured on dev @ 8dda5d6: {"type":"owner","id":"angela"}.
        assert.deepEqual(body.data.relationships.owner, { data: null },
          'the hidden owner is not named in the PATCH response document');

        // A linkage id was dropped, not a document.
        assert.strictEqual(body.data.id, 1, 'the addressed record is unchanged');
        assert.strictEqual(body.data.attributes.size, 'small', 'the other attributes are untouched');

        // [GUARD] The write document agrees with the #234-filtered READ
        // document about the PERMITTED half. Derived from the read surface
        // rather than transcribed, so the two surfaces are compared against
        // each other instead of against a copy of the fixture.
        // MUTATION THAT KILLS IT: deny all linkage in `updateHandler`.
        assert.deepEqual(body.data.relationships.traits.data, read.body.data.relationships.traits.data,
          'and the PERMITTED trait linkage matches what the read surface publishes for the same record');
        assert.ok(body.data.relationships.traits.data.length > 0,
          'precondition: that permitted comparison is not between two empty arrays');
      } finally {
        await sendJson('PATCH', '/animals/1', {
          data: { type: 'animal', id: '1', attributes: { age: originalAge } }
        });
      }

      const restored = await getJson('/animals/1');
      assert.strictEqual(restored.body.data.attributes.age, originalAge, 'the fixture is restored for the modules after this one');
    });

    test('[DEFECT] #235 W2 — POST /animals does not name a hidden owner id', async function(assert) {
      const hidden = await getJson('/owners/angela');
      assert.strictEqual(hidden.status, 404, 'precondition: GET /owners/angela is 404');

      const petsBefore = storeIds('owner', 'angela', 'pets');
      let createdId;

      try {
        const { status, body } = await sendJson('POST', '/animals', {
          data: {
            type: 'animal',
            attributes: { type: 'dog', age: 3, size: 'small', owner: 'angela' }
          }
        });

        createdId = body?.data?.id;

        assert.strictEqual(status, 200, 'the create is permitted and still answers 200');
        assert.ok(createdId !== undefined, 'precondition: a record was actually created and given an id');

        // PRECONDITION ON THE ONE THING THAT COULD MAKE THIS VACUOUS: the
        // relationship was really established. If `owner: 'angela'` had simply
        // been ignored, `owner.data` would be null for a reason that has
        // nothing to do with access filtering.
        assert.strictEqual(store.get('animal', createdId)?.owner?.id, 'angela',
          'precondition: the created record really does belong to the hidden owner in the store');

        // [DEFECT] Measured on dev @ 8dda5d6: {"type":"owner","id":"angela"}.
        assert.deepEqual(body.data.relationships.owner, { data: null },
          'the hidden owner is not named in the POST response document');

        // [DEFECT] on dev: the id appears in the RELATIONSHIPS block of the
        // create response. Scoped to that block on purpose -- see the note
        // below for what a whole-document scan finds instead, and why this
        // story neither owns it nor may pretend to have closed it.
        assert.notOk(JSON.stringify(body.data.relationships).includes('angela'),
          'and the hidden id appears nowhere in the create response’s relationships');

        // A RESIDUAL THIS STORY DOES NOT CLOSE, FOUND WHILE MEASURING IT, AND
        // ASSERTED AS PRESENT RATHER THAN LEFT AS A COMMENT.
        //
        // A whole-document scan for `angela` on this response still matches,
        // and it is NOT linkage: the `animal` fixture model has a COMPUTED
        // attribute, `tag`, whose getter interpolates `owner.id` into a string
        // (test/sample/models/animal.ts:13). So every animal document on every
        // surface -- including the four READ surfaces #234 already closed --
        // carries `attributes.tag: "angela's small dog"`.
        //
        // It is out of scope in the strong sense rather than the convenient
        // one: `relationships.*.data` is a structure this module builds and can
        // therefore filter, while a computed attribute is arbitrary consumer
        // code returning an arbitrary value. Filtering it would mean the ORM
        // deciding which substrings of a consumer's own getter output are
        // identifiers, which it cannot do. Pinned here so the gap is a measured
        // fact in the suite rather than a sentence in a PR body, and so that
        // anyone who later DOES close it has an assertion to turn red.
        assert.ok(body.data.attributes.tag.includes('angela'),
          'RESIDUAL, NOT CLOSED BY #235: a computed attribute still interpolates the hidden owner’s id — attributes are not linkage');
      } finally {
        if (createdId !== undefined) store.remove('animal', createdId, { _skipAutoPersist: true });
      }

      // The fixture is left exactly as it was found, so the modules after this
      // one still see the collection they were written against.
      assert.strictEqual(store.get('animal', createdId), undefined, 'the created record was removed again');
      assert.deepEqual(storeIds('owner', 'angela', 'pets'), petsBefore,
        'and the hidden owner has exactly the pets she had before this test');
    });

    test('[GUARD] #235 W3 — permitted linkage survives on both write surfaces', async function(assert) {
      // The over-denial control. A fix that binds the request and then denies
      // everything satisfies W1 and W2 perfectly.
      //
      // MUTATION THAT KILLS IT: replace `createLinkageFilter(request)` with
      // `() => false` in either write handler.
      const gina = await getJson('/owners/gina');
      assert.strictEqual(gina.status, 200, 'precondition: gina is a PERMITTED owner');

      const animalRead = await getJson('/animals/4');
      const originalAge = animalRead.body.data.attributes.age;

      try {
        const patched = await sendJson('PATCH', '/animals/4', {
          data: { type: 'animal', id: '4', attributes: { age: originalAge + 1 } }
        });

        assert.strictEqual(patched.status, 200);
        assert.deepEqual(patched.body.data.relationships.owner, { data: { type: 'owner', id: 'gina' } },
          'PATCH still names a permitted belongsTo in full');
        assert.deepEqual(patched.body.data.relationships.traits.data, animalRead.body.data.relationships.traits.data,
          'and its permitted hasMany matches what the read surface publishes');
        assert.ok(patched.body.data.relationships.traits.data.length > 0,
          'precondition: that comparison is not between two empty arrays');
      } finally {
        await sendJson('PATCH', '/animals/4', {
          data: { type: 'animal', id: '4', attributes: { age: originalAge } }
        });
      }

      // The hasMany half, on the write surface, from the parent side. Expected
      // members come from the store, never from the fixture file.
      const ginaPets = storeIds('owner', 'gina', 'pets');
      assert.ok(ginaPets.length > 1, `precondition: gina owns more than one animal (${ginaPets.join(', ')})`);

      // RE-SPECIFIED BY abofs/stonyx-orm#240 FIXTURE 1, WHICH LANDS IN THE SAME
      // SPRINT AS PR #247 AND CHANGES WHAT "PERMITTED" MEANS ON THIS FIXTURE.
      //
      // What stood here, with its measurement:
      //
      //     assert.deepEqual(
      //       ownerPatched.body.data.relationships.pets.data
      //         .map(entry => entry.id).sort((a, b) => a - b),
      //       ginaPets,
      //       'PATCH /owners/gina still names every permitted pet');
      //
      //   Measured on the rebase onto dev @ 013c80f: the write surface answered
      //   [4, 8, 13, 24] against an expectation of [4, 8, 13, 18, 24].
      //
      // `ginaPets` is the raw STORE, and the comparison was sound only while
      // gina's stored pets and gina's PERMITTED pets were the same list. #240
      // fixture 1 makes animal 18 the first hidden child in this sample with a
      // PERMITTED parent -- the `record.id !== 18` clause of the `animal` rule in
      // test/sample/access/global-access.ts, cited by clause and not by line
      // because that file's own marker block moves it -- so they are
      // no longer the same list.
      //
      // AND THE OLD FORM WAS THE WRONG ASSERTION RATHER THAN MERELY A STALE
      // ONE. Held against the store it demands that `PATCH /owners/gina`
      // republish id 18 -- a hidden record's id on a write surface, which is
      // the exact defect #235 closed. Re-specified onto the READ surface, this
      // guard says what its name always meant: one HTTP verb does not disagree
      // with another about the same record.
      //
      // MUTATION THAT KILLS IT is unchanged -- `() => false` in either write
      // handler empties the write surface while the read surface keeps its
      // members -- and the two preconditions below stop the comparison from
      // being between two lists that a broken filter would empty together, or
      // between two that never differed.
      const ginaVisiblePets = gina.body.data.relationships.pets.data
        .map(entry => entry.id)
        .sort((a, b) => a - b);
      assert.ok(ginaVisiblePets.length > 1,
        `precondition: more than one of gina's pets is permitted (${ginaVisiblePets.join(', ')})`);
      assert.ok(ginaPets.length > ginaVisiblePets.length,
        `precondition: the store holds a pet NEITHER surface may name — #240 fixture 1's animal 18 (store: ${ginaPets.join(', ')})`);

      const ownerAge = gina.body.data.attributes.age;
      const ownerPatched = await sendJson('PATCH', '/owners/gina', {
        data: { type: 'owner', id: 'gina', attributes: { age: ownerAge } }
      });

      assert.strictEqual(ownerPatched.status, 200);
      assert.deepEqual(
        ownerPatched.body.data.relationships.pets.data.map(entry => entry.id).sort((a, b) => a - b),
        ginaVisiblePets,
        'PATCH /owners/gina names exactly the pets the read surface names — the permitted ones survive the write surface and the hidden one is not republished there either');

      let createdId;

      try {
        const created = await sendJson('POST', '/animals', {
          data: { type: 'animal', attributes: { type: 'dog', age: 2, size: 'small', owner: 'gina' } }
        });

        createdId = created.body?.data?.id;
        assert.deepEqual(created.body.data.relationships.owner, { data: { type: 'owner', id: 'gina' } },
          'POST still names a permitted belongsTo in full');
      } finally {
        if (createdId !== undefined) store.remove('animal', createdId, { _skipAutoPersist: true });
      }
    });

    test('[GUARD] #235 W4a — the write surfaces carry no `links`, so an empty relationship is a bare `{data}`', async function(assert) {
      // The write handlers pass no `baseUrl`, so NOTHING on their documents
      // carries `links`. That is PRE-EXISTING and this story deliberately does
      // not change it: adding `baseUrl` here would be an unrelated behaviour
      // change, and #224 AC6's "emits `data: []` WITH links" is a statement
      // about the READ surfaces only. This pins the shape a filtered
      // relationship has to match, and it is measured on records the filter
      // never touched.
      //
      // MUTATION THAT KILLS IT: pass `baseUrl: getBaseUrl(request)` in either
      // write handler's `toJSON` options -- every relationship gains a `links`
      // member and all four assertions below go red.
      let createdId;

      try {
        const created = await sendJson('POST', '/animals', {
          data: { type: 'animal', attributes: { type: 'goat', age: 1, size: 'small' } }
        });

        createdId = created.body?.data?.id;

        assert.strictEqual(created.status, 200, 'precondition: the reference record was created');
        assert.deepEqual(created.body.data.relationships.traits, { data: [] },
          'reference shape: a genuinely-empty hasMany on a write surface is `{data: []}` and carries NO links');
        assert.deepEqual(created.body.data.relationships.owner, { data: null },
          'reference shape: an absent belongsTo on a write surface is `{data: null}` and carries NO links');
        assert.notOk('links' in created.body, 'and the create document has no top-level links either');
      } finally {
        if (createdId !== undefined) store.remove('animal', createdId, { _skipAutoPersist: true });
      }

      // The same on the update surface, on a record with a PERMITTED owner, so
      // the shape is measured where the filter drops nothing.
      const originalAge = (await getJson('/animals/4')).body.data.attributes.age;
      const patched = await sendJson('PATCH', '/animals/4', {
        data: { type: 'animal', id: '4', attributes: { age: originalAge } }
      });

      assert.notOk('links' in patched.body.data.relationships.owner,
        'the update surface emits no relationship links either — the reference shape holds on both handlers');
    });

    test('[DEFECT] #235 W4b — a filtered write-surface relationship is byte-identical to an empty one', async function(assert) {
      // The oracle question. A filtered relationship must be indistinguishable
      // from a genuinely empty one -- the shapes W4a pinned -- or the fix
      // trades a disclosure for a narrower one.
      const hidden = await getJson('/owners/angela');
      assert.strictEqual(hidden.status, 404, 'precondition: GET /owners/angela is 404');

      const originalAge = (await getJson('/animals/1')).body.data.attributes.age;

      // The belongsTo half, on the shipped fixture: angela is hidden.
      // [DEFECT] on dev @ 8dda5d6 this is {"data":{"type":"owner","id":"angela"}}.
      const patched = await sendJson('PATCH', '/animals/1', {
        data: { type: 'animal', id: '1', attributes: { age: originalAge } }
      });

      assert.strictEqual(patched.status, 200, 'identical status — a filtered relationship is not an error');
      assert.notOk('errors' in patched.body, 'no `errors` member');
      assert.deepEqual(patched.body.data.relationships.owner, { data: null },
        'a belongsTo emptied by the filter is byte-identical to an absent one');

      // The hasMany half. `narrow` is used on `animal`, whose access() returns
      // a per-record FUNCTION -- see the note on `narrow` above for why it may
      // not be used on `trait`.
      const ginaPets = storeIds('owner', 'gina', 'pets');
      assert.ok(ginaPets.length > 1, `precondition: gina's pets linkage is non-empty to begin with (${ginaPets.join(', ')})`);

      const ownerAge = (await getJson('/owners/gina')).body.data.attributes.age;

      // [DEFECT] on dev @ 8dda5d6 this names every one of gina's pets.
      await withAccess('animal', narrow('animal', () => false), async () => {
        const { status, body } = await sendJson('PATCH', '/owners/gina', {
          data: { type: 'owner', id: 'gina', attributes: { age: ownerAge } }
        });

        assert.strictEqual(status, 200, 'identical status');
        assert.notOk('errors' in body, 'no `errors` member');
        assert.deepEqual(body.data.relationships.pets, { data: [] },
          'a hasMany emptied by the filter is byte-identical to a genuinely-empty one');
      });
    });

    test('[DEFECT] #235 I1 — a record already in `included` names no hidden id', async function(assert) {
      const hidden = await getJson('/owners/angela');
      assert.strictEqual(hidden.status, 404, 'precondition: GET /owners/angela is 404');

      const { status, body } = await getJson('/animals/1?include=owner,owner.pets');
      assert.strictEqual(status, 200);

      const includedAnimals = body.included.filter(resource => resource.type === 'animal');

      // THE PRECONDITION THAT KEEPS THIS CRITERION #235's AND NOT #233's.
      // Phrased as "no hidden id appears anywhere in `included`", this
      // assertion would be satisfied incidentally by #233 simply REMOVING
      // members. It is asserted on records that are PERMITTED AND PRESENT, and
      // their presence is a precondition in this same test.
      assert.ok(includedAnimals.length > 1,
        `precondition: permitted animal records ARE present in included (saw ${includedAnimals.length})`);

      // [DEFECT] Measured on dev @ 8dda5d6: 8 included animals, each naming
      // {"type":"owner","id":"angela"}. `included` holds 9 RESOURCES -- those
      // 8 animals plus the hidden owner, who is a member by #233 and is not
      // an animal.
      const naming = includedAnimals
        .filter(resource => resource.relationships.owner?.data !== null)
        .map(resource => `${resource.type}:${resource.id} -> ${JSON.stringify(resource.relationships.owner?.data)}`);

      assert.deepEqual(naming, [],
        'no record already in `included` names the hidden owner in its own linkage');

      // ASSERT THE EFFECT, NOT THE ABSENCE OF ONE STRING: every owner id still
      // named anywhere in `included` is one this caller can actually read. This
      // is derived from the response, so a fixture change cannot make it
      // vacuous in the way a hard-coded 'angela' could.
      const namedOwnerIds = new Set();
      for (const resource of body.included) {
        const owner = resource.relationships?.owner?.data;
        if (owner) namedOwnerIds.add(owner.id);
      }

      for (const ownerId of namedOwnerIds) {
        const probe = await getJson(`/owners/${ownerId}`);
        assert.strictEqual(probe.status, 200, `an owner id named inside included (${ownerId}) is readable by this caller`);
      }

      // And the sideload itself still happened, so the assertion above is not
      // green because `included` was emptied.
      assert.ok(body.included.length > 1, 'the sideload still produced an included array');
    });

    test('[GUARD] #235 I2 — permitted linkage survives inside `included`', async function(assert) {
      // The over-denial control for the `included` half.
      //
      // MUTATION THAT KILLS IT: pass `linkage: () => false` at the
      // `buildResponse` `included` site.
      const { status, body } = await getJson('/owners/gina?include=pets');
      assert.strictEqual(status, 200, 'precondition: gina is a PERMITTED owner');

      const includedAnimals = body.included.filter(resource => resource.type === 'animal');
      const ginaPets = storeIds('owner', 'gina', 'pets');

      assert.deepEqual(includedAnimals.map(animal => animal.id).sort((a, b) => a - b), ginaPets,
        'precondition: every one of gina’s pets was sideloaded, and membership is untouched');
      assert.ok(includedAnimals.length > 1, 'precondition: there is more than one of them');

      for (const animal of includedAnimals) {
        assert.deepEqual(animal.relationships.owner.data, { type: 'owner', id: 'gina' },
          `included animal ${animal.id} still names its permitted owner in full`);
      }

      // The permitted hasMany inside `included` is untouched too. Asserted as
      // "at least one", because a record another module left behind may
      // legitimately have no traits.
      assert.ok(includedAnimals.some(animal => animal.relationships.traits.data.length > 0),
        'and a sideloaded animal still names its permitted traits');
    });

    test('[GUARD] #235 X1 — #233’s `included` membership pin still passes', async function(assert) {
      // OUT OF SCOPE, DELIBERATELY. WHETHER a hidden owner appears in
      // `included` at all is MEMBERSHIP and it is abofs/stonyx-orm#233's
      // reproduction, pinned green here as correct-for-now behaviour so that
      // this story cannot close #233's issue incidentally. It is the same
      // assertion as the `included.find(...)` at the nested-include test above,
      // restated where a reader of #235 will see it -- a criterion a sibling
      // satisfies is not a criterion.
      //
      // MUTATION THAT KILLS IT: filter `collectIncludedRecords`' output through
      // the linkage filter (which is #233's change) -- angela stops being a
      // member and this goes red, correctly, in Sprint 87.
      const { status, body } = await getJson('/animals/1?include=owner,owner.pets');

      assert.strictEqual(status, 200);
      assert.ok(body.included.find(resource => resource.type === 'owner' && resource.id === 'angela'),
        'the hidden owner is STILL a member of included — that is #233, not this story');
    });

    test('[GUARD] #235 X2 — #235’s mechanism does not reach the relationships-linkage route, which is #232’s', async function(assert) {
      // OUT OF SCOPE, DELIBERATELY. `_generateRelationshipRoutes`'
      // relationships-linkage branch builds its `{type, id}` BY HAND and never
      // calls `toJSON`, so the `linkage` OPTION cannot reach it. It is NOT in
      // #224 §2a's seven-site inventory, and its primary data IS linkage, which
      // makes filtering it a MEMBERSHIP decision rather than a linkage one.
      //
      // ---------------------------------------------------------------------
      // RE-SPECIFIED. THE ORIGINAL PINNED THE ROUTE'S ANSWER AND THAT WAS AN
      // OUT-OF-SCOPE PIN ON A SIBLING'S TERRITORY, IN THE SAME SPRINT.
      // ---------------------------------------------------------------------
      // What it was, recorded rather than deleted, with the measurement that
      // justified it:
      //
      //     assert.strictEqual(status, 200);
      //     assert.deepEqual(body.data, { type: 'owner', id: 'angela' },
      //       'the relationships-linkage route still publishes the hidden id
      //        — that is #232, not this story');
      //
      //   Measured against this branch's 1011/0 baseline: wiring
      //   `createLinkageFilter` into the belongsTo branch of that route takes
      //   the suite to 1009/2, reddening this guard and
      //   `GET /animals/:id/relationships/owner returns relationship linkage`
      //   -- #232's own reproduction. (Three artifacts first recorded that as
      //   993/2 and the PR body as 1003/2. 993+2 = 995 is the DEV baseline,
      //   from a branch where this guard does not exist.)
      //
      // WHY IT HAD TO GO. abofs/stonyx-orm#232 lands this sprint as PR #247
      // and CHANGES this route: a denied belongsTo target answers 404 there.
      // An assertion that the route still answers 200 with angela's id is an
      // assertion that #232 has not landed -- so #235 would have reddened its
      // sibling's correct change. Pinning a neighbour's CURRENT STATE is not a
      // scope boundary; it is a claim on their territory that expires the
      // moment they do their job.
      //
      // WHAT IT PINS INSTEAD: the boundary itself, which does not expire.
      // #235's mechanism is a LINKAGE FILTER, and applied here it has one
      // recognisable signature -- the linkage is emptied IN PLACE: 200 with
      // `data: null`, byte-identical to a genuinely-absent belongsTo. #232's
      // mechanism is a MEMBERSHIP decision and does not produce that shape: it
      // either refuses to serve the target (404) or leaves it published (200
      // with the id). So `200 AND data === null` is the signature of #235
      // having reached a route that is not its own, and it is the one outcome
      // forbidden here. This passes before #247, passes after #247, and reds
      // for the mutation below either way.
      //
      // MUTATION THAT KILLS IT: wire `createLinkageFilter` into that branch so
      // the linkage is emptied rather than withheld -- 1009/2 against 1011/0,
      // measured.
      //
      // AND MEASURED THE OTHER WAY, which is the half a scope guard usually
      // skips: with PR #247's ACTUAL change applied instead (`if
      // (!isLinkable(relatedData)) return 404;` on this branch), this guard
      // stays GREEN and the suite is 1008/3 -- the three reds all #232's own
      // to re-specify. The assertion this replaced went RED there, 1007/4. So
      // the old one would have reddened a sibling's correct change and the new
      // one does not, while both catch the mutation this guard exists for.
      // RE-SPECIFIED A SECOND TIME, BY abofs/stonyx-orm#232 LANDING AS PR #247,
      // AND THE FIRST RE-SPECIFICATION'S OWN REASONING IS WHAT REQUIRES IT.
      //
      // What stood here, with its measurement:
      //
      //     assert.notOk(status === 200 && body.data === null,
      //       'the relationships-linkage route does not answer with an EMPTIED
      //        linkage — that shape is #235’s mechanism on #232’s route');
      //
      //   Measured when written: with #247's THEN-current change applied
      //   (`if (!isLinkable(relatedData)) return 404;`) it stayed GREEN at
      //   1008/3 against 1011/0, and the assertion it replaced went RED at
      //   1007/4.
      //
      // WHY IT EXPIRED ANYWAY. It forbade `200 AND data === null` on the stated
      // ground that "#232's mechanism is a MEMBERSHIP decision and does not
      // produce that shape: it either refuses to serve the target (404) or
      // leaves it published (200 with the id)". #247's fix round then changed
      // #232's spelling to exactly that shape, because the 404 spelling was
      // measured as an existence oracle -- unauthenticated, no query string, on
      // `tag`, a model with no route mounted at all:
      //
      //     GET /traits/1/tag  [ABSENT]  -> 200  application/json  len 68
      //     GET /traits/2/tag  [DENIED]  -> 404  text/plain        len  9
      //
      // while `GET /traits/1` and `GET /traits/2` report the same relationship
      // as `{"data":null}` byte-identically, because #234 closed that oracle
      // deliberately. So the forbidden shape is now #232's DELIBERATE answer,
      // and forbidding it here is a claim on #232's answer -- the same mistake
      // the FIRST re-specification was written to stop making, reached from the
      // other direction. code-review.md § "A clean auto-merge in a shared file
      // is not evidence of compatibility", rule 5: the second PR re-specifies
      // rather than deletes, records the old assertion with its measurement,
      // and pins the OWNERSHIP BOUNDARY rather than the state that legitimately
      // changed.
      //
      // WHAT PINS THE BOUNDARY NOW, AND DOES NOT EXPIRE IN EITHER DIRECTION.
      // #235's mechanism is `record.toJSON({ linkage })`. It acts on a
      // DOCUMENT: it empties a relationship NESTED inside a resource and leaves
      // that resource served, attributes and all. This route serves no
      // document -- its top-level `data` IS the linkage, and there is no
      // surrounding resource for that mechanism to have left behind. The two
      // are therefore distinguishable by what they leave standing rather than
      // by a status or a `data` value, and that stays true whatever #232
      // chooses to answer. The SOURCE half of the same boundary -- that this
      // route still builds `{type, id}` by hand and so cannot receive the
      // `linkage` option at all -- is `[GUARD] #235 X2c` in
      // test/unit/write-linkage-scope-test.ts, which is unchanged and green.
      //
      // MUTATION THAT KILLS IT: serialize this route's target through
      // `record.toJSON({ linkage })` and return the resulting resource, which
      // is how #235's mechanism would reach here -- the response gains
      // `attributes` and the first assertion reds. Emptying the document
      // surface's linkage without emptying the PATCH response's, or the
      // reverse, reds the second pair.
      // READ OFF A *PERMITTED* TARGET, DELIBERATELY. On `/animals/1` the owner
      // is denied and `data` is `null`, so any "this is not a document" check
      // there is satisfied by the null and could not fail -- the vacuous shape
      // this suite has been bitten by before. `/animals/4`'s owner is gina, who
      // is permitted, so the payload below is populated and the equality is
      // load-bearing.
      const { status, body } = await getJson('/animals/4/relationships/owner');
      assert.strictEqual(status, 200, 'precondition: the relationships-linkage route answered');
      assert.deepEqual(body.data, { type: 'owner', id: 'gina' },
        'the relationships-linkage route serves LINKAGE and nothing else — a `toJSON({ linkage })` answer would carry `attributes` here, so #235’s document-shaped mechanism is not what produced it');

      // Stated as an inequality against the surfaces this story DID close, so a
      // reader can see the boundary rather than infer it. This half is #235's
      // own territory and is unconditional.
      const document = await getJson('/animals/1');
      assert.strictEqual(document.body.data.relationships.owner.data, null,
        'while the document surface next door DOES empty it — the two are different questions, answered by different mechanisms');
      assert.ok(document.body.data.attributes,
        'and it empties the relationship while STILL SERVING the record, which is the signature of a linkage filter rather than a membership decision');

      const patched = await sendJson('PATCH', '/animals/1', {
        data: { type: 'animal', id: '1', attributes: { age: document.body.data.attributes.age } }
      });
      assert.strictEqual(patched.body.data.relationships.owner.data, null,
        'and so does the PATCH response document — the third of #235’s own sites, on the same denied owner');
    });

    test('[DEFECT] #235 C1 — one linkage filter per handler invocation, one verdict per type', async function(assert) {
      // The filter carries a per-TYPE verdict cache and a per-(type, id)
      // decision cache, and both are worthless if it is rebuilt inside a map.
      // Hoisting it the other way -- into the OrmRequest constructor, where the
      // other per-mount values live -- is worse than worthless: a verdict
      // cached across requests answers a second caller with the FIRST caller's
      // authorization.
      //
      // `Orm.instance.getAccess` is called from exactly one place in `src`
      // (`resolveVerdict`), so its call count IS the number of verdict
      // resolutions.
      //
      // MUTATION THAT KILLS THE [GUARD] HALVES: build the filter inside the
      // `included` map in `buildResponse`, or inside either write handler's
      // `toJSON` call rather than once per invocation -- the count goes to one
      // per RECORD instead of one per TYPE.
      const getAccessSpy = sinon.spy(Orm.instance, 'getAccess');

      try {
        const originalAge = (await getJson('/animals/1')).body.data.attributes.age;
        getAccessSpy.resetHistory();

        await sendJson('PATCH', '/animals/1', {
          data: { type: 'animal', id: '1', attributes: { age: originalAge } }
        });

        // [DEFECT] `[]` on dev @ 8dda5d6: the write handler resolved no verdict
        // at all, because it never built a filter.
        assert.deepEqual([...new Set(getAccessSpy.getCalls().map(call => call.args[0]))].sort(), ['owner', 'trait'],
          'the PATCH handler asked about exactly the two linked types');

        // [GUARD] once per TYPE, not once per linkage entry: animal 1 names one
        // owner and two traits, so a per-record build would be three.
        assert.strictEqual(getAccessSpy.callCount, 2, 'and exactly once per type — one filter for the whole document');

        getAccessSpy.resetHistory();

        const { body } = await getJson('/animals/1?include=owner,owner.pets');
        const distinct = [...new Set(getAccessSpy.getCalls().map(call => call.args[0]))].sort();

        // [DEFECT] on dev @ 8dda5d6 the included records were serialized with
        // no filter at all, so `animal` was never asked about -- only the
        // primary document's own `owner` and `trait`.
        assert.ok(distinct.includes('animal'),
          'the `included` site resolves verdicts too — `animal` is asked about, which only the sideloaded owner names');

        // [GUARD] ONE filter for the primary document AND the whole `included`
        // array. A filter rebuilt per record would resolve many times per type.
        assert.ok(body.included.length > 1, `precondition: the sideload produced ${body.included.length} included resources`);
        assert.strictEqual(getAccessSpy.callCount, distinct.length,
          `exactly one verdict resolution per distinct type (${distinct.length} types, ${getAccessSpy.callCount} resolutions) across the primary document and included`);
      } finally {
        getAccessSpy.restore();
      }
    });
  });

  // ==========================================================================
  // abofs/stonyx-orm#233 — `include=` traversal MEMBERSHIP
  // ==========================================================================
  //
  // SCAFFOLD. Every `test.todo` below is one acceptance criterion and asserts
  // nothing yet; the unit-tier half lives in
  // test/unit/include-membership-access-test.ts.
  //
  // The boundary with the two siblings that landed first, restated because it
  // is the whole reason this module exists separately from theirs:
  //
  //   - #235 owns LINKAGE inside a record that is already in `included` — what
  //     `relationships.*.data` may NAME.
  //   - #232 owns the two relationship ROUTE families.
  //   - THIS story owns MEMBERSHIP — whether a resource enters `included` at
  //     all — and the PRUNE of the subtree beneath a resource that does not.
  //
  module('Include Traversal Membership Access (#233)', function(includeHooks) {
    includeHooks.before(function() {
      // TODO: idempotent fixture top-up, matching the #232/#235 modules.
    });

    test.todo('[DEFECT] #233 AC2 — a record hidden by its own model’s predicate is not a member of `included`', function(assert) {
      assert.ok(false, 'TODO');
    });

    test.todo('[DEFECT] #233 AC2b — a hidden CHILD of a permitted parent is not a member either', function(assert) {
      assert.ok(false, 'TODO');
    });

    test.todo('[DEFECT] #233 AC3 — a model no access class claims is never disclosed as a sideloaded resource', function(assert) {
      assert.ok(false, 'TODO');
    });

    test.todo('[DEFECT] #233 AC4 — the subtree beneath a dropped parent is PRUNED, not traversed through', function(assert) {
      assert.ok(false, 'TODO');
    });

    test.todo('[DEFECT] #233 AC4b — the prune holds at depth 2 and depth 3', function(assert) {
      assert.ok(false, 'TODO');
    });

    test.todo('#233 AC6/AC10 — drop, never error: a pruned sideload is shaped exactly like a genuinely empty one', function(assert) {
      assert.ok(false, 'TODO');
    });

    test.todo('[GUARD] #233 AC7 — negative control: permitted resources are still sideloaded, at every depth', function(assert) {
      assert.ok(false, 'TODO');
    });

    test.todo('[GUARD] #233 AC8 — one verdict per type and one decision per (type, id) across the whole traversal', function(assert) {
      assert.ok(false, 'TODO');
    });
  });
});
