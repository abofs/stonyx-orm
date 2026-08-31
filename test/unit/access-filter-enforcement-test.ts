// @ts-nocheck
//
// Regression coverage for abofs/stonyx-orm#190 — a function-style `access`
// filter is applied to collection GET only, so a record hidden from
// `GET /{collection}` stays readable, updatable and DELETABLE by id.
//
// ---------------------------------------------------------------------------
// WHY THIS FILE DRIVES THE HANDLERS DIRECTLY RATHER THAN OVER HTTP
//
// @stonyx/rest-server's dispatcher (dist/request.js:41-58) does exactly three
// things before a handler runs:
//
//     const status = this.auth(req, getState(req));   // :44
//     if (status) return sendStatusResponse(res, status);
//     response = await mainCall(req, getState(req));  // :58
//
// `getState(req)` memoises one object per request, so auth() and the handler
// share it — that shared object is the entire transport for `state.filter`.
// `dispatch()` below reproduces those three lines and nothing else, which
// keeps every assertion deterministic and, critically, lets `Orm.instance.sqlDb`
// be stubbed. See the L1 block for why a live file-backed server CANNOT
// exercise the most damaging half of this defect.
//
// The live HTTP path is covered by test/integration/orm-test.ts, which
// exercises the repaired fixture end to end.
// ---------------------------------------------------------------------------
//
// ASSERTION LABELS. Per the refinement, assertions fall into two classes and
// must not be presented as if they were one:
//
//   [DEFECT] — observed FAILING against unfixed dev (or against a naive fix
//              that returns the right status but still destroys data). These
//              are the assertions that prove #190.
//   [GUARD]  — passes by construction on dev today. Over-blocking guards and
//              hazard guards. They prove the fix did not overshoot, or pin a
//              path that is currently safe only by coincidence. They prove
//              NOTHING about the defect and are labelled so no reader mistakes
//              them for evidence.
//
import QUnit from 'qunit';
import sinon from 'sinon';
import Orm, { createRecord, store } from '@stonyx/orm';
import OrmRequest from '../../src/orm-request.js';
import GlobalAccess from '../sample/access/global-access.js';

const { module, test } = QUnit;

// `restricted` is the owner the shipped fixture hides on every animal surface.
// Ids are parked well clear of the payload range so this file cannot perturb the
// integration dataset.
const HIDDEN_ID = 9101;   // owned by `restricted` -> excluded by the fixture filter
const VISIBLE_ID = 9102;  // owned by gina         -> passes the fixture filter
const MISSING_ID = 9199;  // never created
const CREATE_ID = 9103;  // used by the POST assertions

// The real shipped access class. Binding these tests to the fixture rather
// than to a bespoke inline predicate is deliberate: assertions 1 and 2 are
// about the fixture itself, and if it ever regresses to inert (comparing a
// resolved Record against a string, as it did before this change) every
// assertion below would go vacuously green. Using it here makes that
// impossible — an inert fixture turns this file red.
const globalAccess = new GlobalAccess();
const access = request => globalAccess.access(request);

function makeRequest({ method = 'GET', url, params = {}, body, query = {} } = {}) {
  return {
    protocol: 'http',
    method,
    originalUrl: url,
    params,
    body,
    query,
    get: () => 'localhost',
  };
}

// Mirrors @stonyx/rest-server dist/request.js:44-58 — see header.
async function dispatch(ormRequest, handler, request) {
  const state = {};
  const status = ormRequest.auth(request, state);
  if (status) return status;

  return handler(request, state);
}

// Owners this file had to create itself, so cleanup only removes what it owns.
const ownedOwners = [];

// The fixture predicate reads `record.owner.id`, so the owner records must
// exist or `owner` never resolves and the predicate silently passes everything.
// The integration suite seeds them, but this file must not depend on having run
// after it -- that is exactly the kind of cross-file coupling that lets a
// security assertion pass for a reason unrelated to what it claims to test.
// Pre-existing records are left completely alone.
function seedOwners() {
  for (const id of ['restricted', 'gina']) {
    if (store.get('owner', id)) continue;

    createRecord('owner', { id, gender: 'female', age: 30, pets: [], phoneNumbers: [] }, { serialize: false, _skipAutoPersist: true });
    ownedOwners.push(id);
  }
}

function seed() {
  seedOwners();
  createRecord('animal', { id: HIDDEN_ID, type: 1, age: 2, size: 'small', owner: 'restricted', traits: [] }, { serialize: false, _skipAutoPersist: true });
  createRecord('animal', { id: VISIBLE_ID, type: 1, age: 3, size: 'small', owner: 'gina', traits: [] }, { serialize: false, _skipAutoPersist: true });
}

function cleanup() {
  // Presence-checked: store.remove warns loudly for an absent id, and this
  // runs before and after every test.
  for (const id of [HIDDEN_ID, VISIBLE_ID, CREATE_ID]) {
    if (store.get('animal', id)) store.remove('animal', id, { _skipAutoPersist: true });
  }

  while (ownedOwners.length) {
    const id = ownedOwners.pop();
    if (store.get('owner', id)) store.remove('owner', id, { _skipAutoPersist: true });
  }
}

module('[Unit] access filter enforced on every handler (#190)', function(hooks) {
  let originalSqlDb;
  let originalInitialized;

  hooks.beforeEach(function() {
    originalSqlDb = Orm.instance?.sqlDb;
    originalInitialized = Orm.initialized;
    // createRecord throws 'ORM is not ready' unless this is set; the same
    // pattern as test/unit/delete-persist-test.ts.
    Orm.initialized = true;
    cleanup();
    seed();
  });

  hooks.afterEach(function() {
    cleanup();
    if (Orm.instance) Orm.instance.sqlDb = originalSqlDb;
    Orm.initialized = originalInitialized;
    sinon.restore();
  });

  // =========================================================================
  // Fixture preconditions (assertions 1-2)
  //
  // These gate everything after them. A candidate fix for #190 passed the
  // entire 855-test suite with zero regressions purely because the shipped
  // fixture returned a filter only for exact collection URLs, and its animal
  // predicate compared a resolved Record instance against a string — so it
  // excluded 0 of 20 records. Without these two, every assertion below is
  // vacuous.
  // =========================================================================
  module('fixture preconditions', function() {
    test('[DEFECT] assertion 1 — access() returns a function for a RECORD-level url, not only a collection url', function(assert) {
      const collection = access(makeRequest({ url: '/animals' }));
      const record = access(makeRequest({ url: `/animals/${HIDDEN_ID}` }));
      const related = access(makeRequest({ url: `/animals/${HIDDEN_ID}/owner` }));
      const linkage = access(makeRequest({ url: `/animals/${HIDDEN_ID}/relationships/owner` }));

      assert.strictEqual(typeof collection, 'function', 'collection url yields a filter');
      assert.strictEqual(typeof record, 'function', 'record url yields a filter (was: permission array, so state.filter was undefined)');
      assert.strictEqual(typeof related, 'function', 'related-resource url yields a filter');
      assert.strictEqual(typeof linkage, 'function', 'relationship-linkage url yields a filter');
    });

    test('[DEFECT] assertion 2 — the collection filter is not inert', async function(assert) {
      const ormRequest = new OrmRequest({ model: 'animal', access });
      const request = makeRequest({ url: '/animals' });
      const response = await dispatch(ormRequest, ormRequest.handlers.get['/'], request);

      const inStore = store.get('animal').size;
      const returned = response.data.length;

      assert.ok(returned < inStore, `collection excludes at least one record (${returned} returned of ${inStore} in store; was 0 of 20 excluded)`);
      assert.notOk(response.data.some(r => String(r.id) === String(HIDDEN_ID)), 'hidden id is absent from the collection');
      assert.ok(response.data.some(r => String(r.id) === String(VISIBLE_ID)), 'visible id is present in the collection');
    });
  });

  // =========================================================================
  // Read surfaces (assertions 3-6)
  // =========================================================================
  module('read surfaces', function() {
    test('[DEFECT] assertion 3 — GET /:id on a hidden record is 404, identical to a record that never existed', async function(assert) {
      const ormRequest = new OrmRequest({ model: 'animal', access });
      const handler = ormRequest.handlers.get['/:id'];

      const hidden = await dispatch(ormRequest, handler, makeRequest({ url: `/animals/${HIDDEN_ID}`, params: { id: String(HIDDEN_ID) } }));
      const missing = await dispatch(ormRequest, handler, makeRequest({ url: `/animals/${MISSING_ID}`, params: { id: String(MISSING_ID) } }));

      assert.strictEqual(hidden, 404, 'hidden record is 404 (was: 200 with the full record)');
      assert.strictEqual(missing, 404, 'never-existed record is 404');
      assert.deepEqual(hidden, missing, 'hidden and missing are byte-identical — no existence oracle');
    });

    test('[DEFECT] assertion 4 — GET /:id/{relationship} on a hidden record is 404', async function(assert) {
      const ormRequest = new OrmRequest({ model: 'animal', access });
      const handler = ormRequest.handlers.get['/:id/owner'];

      assert.ok(handler, 'related-resource route is generated');

      const hidden = await dispatch(ormRequest, handler, makeRequest({ url: `/animals/${HIDDEN_ID}/owner`, params: { id: String(HIDDEN_ID) } }));
      const missing = await dispatch(ormRequest, handler, makeRequest({ url: `/animals/${MISSING_ID}/owner`, params: { id: String(MISSING_ID) } }));

      assert.strictEqual(hidden, 404, 'hidden parent is 404 (was: 200, disclosing the related owner)');
      assert.strictEqual(missing, 404, 'missing parent is 404');
    });

    test('[DEFECT] assertion 5 — GET /:id/relationships/{relationship} on a hidden record is 404', async function(assert) {
      const ormRequest = new OrmRequest({ model: 'animal', access });
      const handler = ormRequest.handlers.get['/:id/relationships/owner'];

      assert.ok(handler, 'relationship-linkage route is generated');

      const hidden = await dispatch(ormRequest, handler, makeRequest({ url: `/animals/${HIDDEN_ID}/relationships/owner`, params: { id: String(HIDDEN_ID) } }));
      const missing = await dispatch(ormRequest, handler, makeRequest({ url: `/animals/${MISSING_ID}/relationships/owner`, params: { id: String(MISSING_ID) } }));

      assert.strictEqual(hidden, 404, 'hidden parent is 404 (was: 200, disclosing the linkage)');
      assert.strictEqual(missing, 404, 'missing parent is 404');
    });

    test('[GUARD] assertion 6 — GET /:id on a VISIBLE record still returns it (no over-blocking)', async function(assert) {
      const ormRequest = new OrmRequest({ model: 'animal', access });
      const handler = ormRequest.handlers.get['/:id'];

      const response = await dispatch(ormRequest, handler, makeRequest({ url: `/animals/${VISIBLE_ID}`, params: { id: String(VISIBLE_ID) } }));

      assert.notStrictEqual(response, 404, 'visible record is not blocked');
      assert.strictEqual(String(response.data.id), String(VISIBLE_ID), 'visible record is returned');
    });
  });

  // =========================================================================
  // Update (assertions 7-8)
  // =========================================================================
  module('update', function() {
    test('[DEFECT] assertion 7 — PATCH on a hidden record is 404 AND leaves the attribute unchanged', async function(assert) {
      const ormRequest = new OrmRequest({ model: 'animal', access });
      const handler = ormRequest.handlers.patch['/:id'];

      const before = store.get('animal', HIDDEN_ID).age;
      const response = await dispatch(ormRequest, handler, makeRequest({
        method: 'PATCH',
        url: `/animals/${HIDDEN_ID}`,
        params: { id: String(HIDDEN_ID) },
        body: { data: { type: 'animal', attributes: { age: 999 } } },
      }));

      assert.strictEqual(response, 404, 'hidden record PATCH is 404 (was: 200)');
      assert.strictEqual(store.get('animal', HIDDEN_ID).age, before, `age is unchanged at ${before} (was: mutated to 999)`);
    });

    test('[GUARD] assertion 8 — PATCH on a VISIBLE record still applies (no over-blocking)', async function(assert) {
      const ormRequest = new OrmRequest({ model: 'animal', access });
      const handler = ormRequest.handlers.patch['/:id'];

      const response = await dispatch(ormRequest, handler, makeRequest({
        method: 'PATCH',
        url: `/animals/${VISIBLE_ID}`,
        params: { id: String(VISIBLE_ID) },
        body: { data: { type: 'animal', attributes: { age: 42 } } },
      }));

      assert.notStrictEqual(response, 404, 'visible record PATCH is not blocked');
      assert.strictEqual(store.get('animal', VISIBLE_ID).age, 42, 'age was applied');
    });
  });

  // =========================================================================
  // Delete (assertions 9-10)
  // =========================================================================
  module('delete', function() {
    test('[DEFECT] assertion 9 — DELETE on a hidden record is 404 AND the record survives', async function(assert) {
      const ormRequest = new OrmRequest({ model: 'animal', access });
      const handler = ormRequest.handlers.delete['/:id'];

      const response = await dispatch(ormRequest, handler, makeRequest({
        method: 'DELETE',
        url: `/animals/${HIDDEN_ID}`,
        params: { id: String(HIDDEN_ID) },
      }));

      assert.strictEqual(response, 404, 'hidden record DELETE is 404 (was: 204)');
      assert.ok(store.get('animal', HIDDEN_ID), 'hidden record still exists (was: destroyed)');
    });

    test('[DEFECT] assertion 10 — DELETE on a never-existed record is 404, equal to the denied status', async function(assert) {
      const ormRequest = new OrmRequest({ model: 'animal', access });
      const handler = ormRequest.handlers.delete['/:id'];

      const denied = await dispatch(ormRequest, handler, makeRequest({
        method: 'DELETE',
        url: `/animals/${HIDDEN_ID}`,
        params: { id: String(HIDDEN_ID) },
      }));
      const missing = await dispatch(ormRequest, handler, makeRequest({
        method: 'DELETE',
        url: `/animals/${MISSING_ID}`,
        params: { id: String(MISSING_ID) },
      }));

      // BEHAVIOUR CHANGE: DELETE of a missing record was 204 on dev. Without
      // this, denied-404 against missing-204 is a perfect existence oracle and
      // the whole fix is worthless.
      assert.strictEqual(missing, 404, 'missing record DELETE is 404 (BEHAVIOUR CHANGE, was: 204)');
      assert.strictEqual(denied, missing, 'denied and missing statuses are equal — no existence oracle');
    });
  });

  // =========================================================================
  // Persistence layer — L1 / L2 (assertions 11-13)
  //
  // THE HALF OF THIS DEFECT A FILE-BACKED TEST CANNOT SEE.
  //
  // _withHooks sets context.recordId BEFORE the handler runs (orm-request.ts
  // :430) and then calls sqlDb.persist(operation, model, context, response)
  // for every write operation (:454) regardless of what the handler returned.
  // The `response` argument is accepted at that call site and DROPPED at the
  // driver boundary — _persistDelete(modelName, context) never receives it and
  // guards only on context.recordId.
  //
  // So a correct 404 STILL issues DELETE FROM ... WHERE id = ? on every SQL
  // backend. In directory/file mode Orm.instance.sqlDb is null, so the natural
  // regression test passes while production data is destroyed. A stubbed sqlDb
  // is therefore mandatory, not stylistic.
  // =========================================================================
  module('persistence layer (stubbed sqlDb)', function(persistHooks) {
    let persistStub;

    persistHooks.beforeEach(function() {
      persistStub = sinon.stub().resolves();
      Orm.initialized = true;
      Orm.instance.sqlDb = { persist: persistStub };
    });

    test('[DEFECT] assertion 11 — a DENIED delete issues no delete persist', async function(assert) {
      const ormRequest = new OrmRequest({ model: 'animal', access });
      const handler = ormRequest.handlers.delete['/:id'];

      const response = await dispatch(ormRequest, handler, makeRequest({
        method: 'DELETE',
        url: `/animals/${HIDDEN_ID}`,
        params: { id: String(HIDDEN_ID) },
      }));

      const deleteCalls = persistStub.getCalls().filter(call => call.args[0] === 'delete' && call.args[2]?.recordId);

      assert.strictEqual(response, 404, 'denied delete returns 404');
      assert.strictEqual(deleteCalls.length, 0,
        'no persist call carrying operation=delete with a populated context.recordId ' +
        '(naive fix measured: operation=delete recordId=1 response=404 -> DELETE FROM ... WHERE id = 1)');
    });

    test('[GUARD] assertion 12 — a DENIED patch issues no update persist', async function(assert) {
      // Hazard guard. This path is inert on dev TODAY, but only by coincidence
      // of an unrelated guard: persist IS called for a denied update, and
      // _persistUpdate merely returns early because context.record was never
      // set. Pinned so that coincidence cannot quietly stop holding.
      const ormRequest = new OrmRequest({ model: 'animal', access });
      const handler = ormRequest.handlers.patch['/:id'];

      const response = await dispatch(ormRequest, handler, makeRequest({
        method: 'PATCH',
        url: `/animals/${HIDDEN_ID}`,
        params: { id: String(HIDDEN_ID) },
        body: { data: { type: 'animal', attributes: { age: 999 } } },
      }));

      const updateCalls = persistStub.getCalls().filter(call => call.args[0] === 'update' && call.args[2]?.record);

      assert.strictEqual(response, 404, 'denied patch returns 404');
      assert.strictEqual(updateCalls.length, 0, 'no update persist carrying a populated context.record');
    });

    test('[GUARD] assertion 13 — an ALLOWED delete DOES reach persist', async function(assert) {
      // Proves assertion 11 is capable of failing in the opposite direction —
      // that it is not passing merely because persist is never called at all.
      const ormRequest = new OrmRequest({ model: 'animal', access });
      const handler = ormRequest.handlers.delete['/:id'];

      const response = await dispatch(ormRequest, handler, makeRequest({
        method: 'DELETE',
        url: `/animals/${VISIBLE_ID}`,
        params: { id: String(VISIBLE_ID) },
      }));

      const deleteCalls = persistStub.getCalls().filter(call => call.args[0] === 'delete');

      assert.strictEqual(response, 204, 'allowed delete returns 204');
      assert.strictEqual(deleteCalls.length, 1, 'allowed delete reaches persist exactly once');
      assert.strictEqual(deleteCalls[0].args[1], 'animal', 'persist targets the animal model');
      assert.strictEqual(String(deleteCalls[0].args[2].recordId), String(VISIBLE_ID), 'persist carries the record id');
    });
  });

  // =========================================================================
  // Create (assertions 14-15)
  // =========================================================================
  module('create', function() {
    test('[DEFECT] assertion 14 — POST failing the filter is 403 AND the record is rolled back', async function(assert) {
      // 403 rather than 404: there is no pre-existing record whose existence
      // could leak, the caller supplied the attributes, and 404 on a mounted
      // collection route is indistinguishable from "model not mounted".
      //
      // The rollback half is the trap: createRecord writes to the store BEFORE
      // the predicate can run, so a 403-only assertion passes with the record
      // left behind — a worse bug than the one being fixed.
      const ormRequest = new OrmRequest({ model: 'animal', access });
      const handler = ormRequest.handlers.post['/'];

      const response = await dispatch(ormRequest, handler, makeRequest({
        method: 'POST',
        url: '/animals',
        body: { data: { type: 'animal', id: CREATE_ID, attributes: { type: 1, age: 1, size: 'small', owner: 'restricted' } } },
      }));

      assert.strictEqual(response, 403, 'denied create is 403, explicitly not 404 (was: 200)');
      assert.notOk(store.get('animal', CREATE_ID), 'denied create left no record behind (was: persisted)');
    });

    test('[GUARD] assertion 15 — POST passing the filter still succeeds and persists', async function(assert) {
      const ormRequest = new OrmRequest({ model: 'animal', access });
      const handler = ormRequest.handlers.post['/'];

      const response = await dispatch(ormRequest, handler, makeRequest({
        method: 'POST',
        url: '/animals',
        body: { data: { type: 'animal', id: CREATE_ID, attributes: { type: 1, age: 1, size: 'small', owner: 'gina' } } },
      }));

      assert.notStrictEqual(response, 403, 'allowed create is not blocked');
      assert.strictEqual(String(response.data.id), String(CREATE_ID), 'created record is returned');
      assert.ok(store.get('animal', CREATE_ID), 'allowed create persisted the record');
    });
  });

  // =========================================================================
  // Non-regression of the other access shapes (assertion 16)
  //
  // GUARDS. These pin the two access shapes this change does not touch, and
  // the no-filter case. They use inline access functions rather than the
  // fixture because they are about auth()'s handling of the SHAPE, not about
  // the fixture's url matching.
  // =========================================================================
  module('other access shapes', function() {
    test('[GUARD] assertion 16a — access() returning false still yields 403', function(assert) {
      const ormRequest = new OrmRequest({ model: 'animal', access: () => false });
      const state = {};

      assert.strictEqual(ormRequest.auth(makeRequest({ url: '/animals' }), state), 403, 'hard deny is 403');
      assert.strictEqual(state.filter, undefined, 'no filter is planted for a hard deny');
    });

    test('[GUARD] assertion 16b — array-style method denial still yields 403', function(assert) {
      const ormRequest = new OrmRequest({ model: 'animal', access: () => ['read'] });

      assert.strictEqual(ormRequest.auth(makeRequest({ method: 'DELETE', url: `/animals/${HIDDEN_ID}` }), {}), 403, 'delete denied by permission array');
      assert.strictEqual(ormRequest.auth(makeRequest({ method: 'PATCH', url: `/animals/${HIDDEN_ID}` }), {}), 403, 'patch denied by permission array');
      assert.strictEqual(ormRequest.auth(makeRequest({ method: 'POST', url: '/animals' }), {}), 403, 'create denied by permission array');
      assert.strictEqual(ormRequest.auth(makeRequest({ method: 'GET', url: '/animals' }), {}), undefined, 'read allowed by permission array');
    });

    test('[GUARD] assertion 16c — with state.filter undefined, every record surface behaves as it does on dev', async function(assert) {
      const permissive = () => ['read', 'create', 'update', 'delete'];
      const ormRequest = new OrmRequest({ model: 'animal', access: permissive });

      const state = {};
      ormRequest.auth(makeRequest({ url: `/animals/${HIDDEN_ID}` }), state);
      assert.strictEqual(state.filter, undefined, 'permission-array access plants no filter');

      const single = await dispatch(ormRequest, ormRequest.handlers.get['/:id'], makeRequest({ url: `/animals/${HIDDEN_ID}`, params: { id: String(HIDDEN_ID) } }));
      assert.strictEqual(String(single.data.id), String(HIDDEN_ID), 'GET /:id unaffected when no filter is present');

      const related = await dispatch(ormRequest, ormRequest.handlers.get['/:id/owner'], makeRequest({ url: `/animals/${HIDDEN_ID}/owner`, params: { id: String(HIDDEN_ID) } }));
      assert.notStrictEqual(related, 404, 'related-resource route unaffected when no filter is present');

      const linkage = await dispatch(ormRequest, ormRequest.handlers.get['/:id/relationships/owner'], makeRequest({ url: `/animals/${HIDDEN_ID}/relationships/owner`, params: { id: String(HIDDEN_ID) } }));
      assert.notStrictEqual(linkage, 404, 'linkage route unaffected when no filter is present');

      const patched = await dispatch(ormRequest, ormRequest.handlers.patch['/:id'], makeRequest({
        method: 'PATCH',
        url: `/animals/${HIDDEN_ID}`,
        params: { id: String(HIDDEN_ID) },
        body: { data: { type: 'animal', attributes: { age: 7 } } },
      }));
      assert.notStrictEqual(patched, 404, 'PATCH unaffected when no filter is present');

      const deleted = await dispatch(ormRequest, ormRequest.handlers.delete['/:id'], makeRequest({
        method: 'DELETE',
        url: `/animals/${HIDDEN_ID}`,
        params: { id: String(HIDDEN_ID) },
      }));
      assert.strictEqual(deleted, 204, 'DELETE of an EXISTING record is still 204 — the behaviour change is scoped to the missing case');
    });
  });
});
