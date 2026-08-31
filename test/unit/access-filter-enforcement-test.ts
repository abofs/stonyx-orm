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
// beforeHook/afterHook are imported from the SOURCE module, not from
// '@stonyx/orm'. The dist entry point carries its own hook registry, and
// src/orm-request.ts -- the unit under test here -- reads the source one, so a
// hook registered through the package export is invisible to it and every
// assertion below would go vacuously green. (The integration tier registers
// through the package export, because there the whole app is the dist build.)
import { beforeHook, afterHook } from '../../src/hooks.js';
import { setupIntegrationTests } from 'stonyx/test-helpers';
import config from 'stonyx/config';
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
  // Boots the app the same way every integration module does. Without it this
  // file passes only when some earlier file happened to complete ORM init, and
  // 6 of its assertions -- including BOTH fixture preconditions and every
  // read-surface [DEFECT] assertion -- fail when it is run alone. A security
  // file that cannot run standalone is one reordering away from proving nothing.
  setupIntegrationTests(hooks);

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
    // Restore FIRST, and clean up in a `finally`. cleanup() can throw, and when
    // it did while the restore sat below it the `{ persist }`-only sqlDb stub
    // survived into every later file, which then died with
    // `this._sqlDb.findRecord is not a function` -- pointing at entirely the
    // wrong test. test/unit/delete-persist-test.ts:19 restores first for exactly
    // this reason; this file previously inverted it.
    if (Orm.instance) Orm.instance.sqlDb = originalSqlDb;
    sinon.restore();

    try {
      cleanup();
    } finally {
      Orm.initialized = originalInitialized;
    }
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
      // The /owners half of the fixture repair. Without this line, reverting
      // global-access.ts:44 to endsWith('/owners') -- i.e. reintroducing
      // fixture defect #1 on the owners half verbatim -- leaves the suite green.
      const ownerCollection = access(makeRequest({ url: '/owners' }));
      const ownerRecord = access(makeRequest({ url: '/owners/restricted' }));
      // `originalUrl` carries the query string. The fixture anchors its match
      // (so it cannot catch a sibling collection like /animals-archive), and an
      // anchored match against the RAW value would miss this url entirely and
      // return the permission array — i.e. a filtered collection query would
      // come back unfiltered. Fails open, silently, on exactly the surface the
      // original bypass lived on.
      const queried = access(makeRequest({ url: '/animals?filter[age]=2' }));

      assert.strictEqual(typeof collection, 'function', 'collection url yields a filter');
      assert.strictEqual(typeof record, 'function', 'record url yields a filter (was: permission array, so state.filter was undefined)');
      assert.strictEqual(typeof related, 'function', 'related-resource url yields a filter');
      assert.strictEqual(typeof linkage, 'function', 'relationship-linkage url yields a filter');
      assert.strictEqual(typeof ownerCollection, 'function', 'owners collection url yields a filter');
      assert.strictEqual(typeof ownerRecord, 'function', 'owners RECORD url yields a filter (was: permission array)');
      assert.strictEqual(typeof queried, 'function', 'a collection url WITH A QUERY STRING yields a filter');
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
  //
  // WHAT ENFORCES 11 AND 12 TODAY. Both still fail against dev source, so they
  // remain [DEFECT] evidence. But since the pre-handler gate landed, a denied
  // update or delete returns 404 before the persist call is reached at all, so
  // removing `!denied` from the persist gate no longer turns either of them red
  // — that mutation is killed by assertions 24 and 25 instead, on the create
  // and missing-delete paths the pre-handler gate cannot cover. Stated here
  // rather than left for the next reader to measure.
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

    test('[DEFECT] assertion 12 — a DENIED patch issues no update persist at all', async function(assert) {
      // WHAT THIS PINS, EXACTLY: a denied update does not reach sqlDb.persist.
      //
      // WHAT IT DOES NOT PIN: anything about _persistUpdate's own internal
      // guard. This tier stubs Orm.instance.sqlDb wholesale, so the driver body
      // never executes and no assertion here can observe it. An earlier revision
      // qualified the filter below with `&& call.args[2]?.record` and claimed to
      // pin that guard; measured, the qualifier did the opposite -- it filtered
      // the offending call straight out of the array, so removing `!denied` from
      // the source gate left this assertion GREEN. Counting every `update`
      // persist call, qualified by nothing, is what makes it capable of failing.
      const ormRequest = new OrmRequest({ model: 'animal', access });
      const handler = ormRequest.handlers.patch['/:id'];

      const response = await dispatch(ormRequest, handler, makeRequest({
        method: 'PATCH',
        url: `/animals/${HIDDEN_ID}`,
        params: { id: String(HIDDEN_ID) },
        body: { data: { type: 'animal', attributes: { age: 999 } } },
      }));

      const updateCalls = persistStub.getCalls().filter(call => call.args[0] === 'update');

      assert.strictEqual(response, 404, 'denied patch returns 404');
      assert.strictEqual(updateCalls.length, 0, 'a denied patch makes no update persist call whatsoever');
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
  // Executors downstream of the gate (assertions 17-21)
  //
  // THE REFRAMING. The defect is not "a delete persists past a 404". It is that
  // _withHooks has SEVERAL executors downstream of the handler and originally
  // the response gated none of them. sqlDb.persist (11-13) was the first one
  // found; these pin the other two, and the pre-handler gate that keeps
  // before-hooks and context.oldState from running at all.
  //
  // Every one of these is a [DEFECT]: measured firing at 2101335 (the previous
  // head of this branch) over live HTTP, with the record surviving behind a
  // correct 404.
  // =========================================================================
  module('write executors on a denied request', function(execHooks) {
    let fired;
    let unsubscribes;

    execHooks.beforeEach(function() {
      fired = [];
      unsubscribes = [];
    });

    execHooks.afterEach(function() {
      while (unsubscribes.length) unsubscribes.pop()();
    });

    function record(phase, operation) {
      unsubscribes.push(
        (phase === 'before' ? beforeHook : afterHook)(operation, 'animal', context => {
          fired.push({
            phase,
            operation,
            recordId: context.recordId,
            oldState: context.oldState,
            response: context.response,
          });
        })
      );
    }

    test('[DEFECT] assertion 17 — a DENIED delete fires no delete hook, and hands no oldState to consumer code', async function(assert) {
      record('before', 'delete');
      record('after', 'delete');

      const ormRequest = new OrmRequest({ model: 'animal', access });
      const response = await dispatch(ormRequest, ormRequest.handlers.delete['/:id'], makeRequest({
        method: 'DELETE',
        url: `/animals/${HIDDEN_ID}`,
        params: { id: String(HIDDEN_ID) },
      }));

      assert.strictEqual(response, 404, 'denied delete returns 404');
      assert.ok(store.get('animal', HIDDEN_ID), 'the hidden record survives');
      assert.strictEqual(fired.length, 0,
        'no delete hook fired (was: before+after both fired with recordId=' + HIDDEN_ID + ', so ' +
        "afterHook('delete', ctx => cascadeDelete(ctx.recordId)) destroys children behind a 404)");
      assert.notOk(fired.some(f => f.oldState), 'no hook received the hidden record’s contents as oldState');
    });

    test('[GUARD] assertion 18 — an ALLOWED delete still fires exactly one before and one after hook', async function(assert) {
      // Proves 17 can fail in the opposite direction: that it is not green
      // merely because hooks never fire at all in this harness.
      record('before', 'delete');
      record('after', 'delete');

      const ormRequest = new OrmRequest({ model: 'animal', access });
      const response = await dispatch(ormRequest, ormRequest.handlers.delete['/:id'], makeRequest({
        method: 'DELETE',
        url: `/animals/${VISIBLE_ID}`,
        params: { id: String(VISIBLE_ID) },
      }));

      assert.strictEqual(response, 204, 'allowed delete returns 204');
      assert.strictEqual(fired.filter(f => f.phase === 'before').length, 1, 'exactly one beforeDelete');
      assert.strictEqual(fired.filter(f => f.phase === 'after').length, 1, 'exactly one afterDelete');
      assert.strictEqual(String(fired[0].recordId), String(VISIBLE_ID), 'the hook received the record id');
    });

    test('[DEFECT] assertion 19 — a DENIED patch fires no update hook', async function(assert) {
      record('before', 'update');
      record('after', 'update');

      const ormRequest = new OrmRequest({ model: 'animal', access });
      const response = await dispatch(ormRequest, ormRequest.handlers.patch['/:id'], makeRequest({
        method: 'PATCH',
        url: `/animals/${HIDDEN_ID}`,
        params: { id: String(HIDDEN_ID) },
        body: { data: { type: 'animal', attributes: { age: 999 } } },
      }));

      assert.strictEqual(response, 404, 'denied patch returns 404');
      assert.strictEqual(fired.length, 0, 'no update hook fired (was: before+after, with oldState populated)');
    });

    test('[DEFECT] assertion 20 — a before-hook cannot short-circuit past the gate on a denied write', async function(assert) {
      // Before-hooks run BEFORE the handler and may halt by returning a value,
      // so without a PRE-handler gate a consumer read-through cache or audit
      // shim answers a request the filter would have refused. GATE 1 is what
      // makes this unreachable rather than merely unlikely.
      unsubscribes.push(beforeHook('delete', 'animal', () => 204));

      const ormRequest = new OrmRequest({ model: 'animal', access });
      const denied = await dispatch(ormRequest, ormRequest.handlers.delete['/:id'], makeRequest({
        method: 'DELETE',
        url: `/animals/${HIDDEN_ID}`,
        params: { id: String(HIDDEN_ID) },
      }));
      const allowed = await dispatch(ormRequest, ormRequest.handlers.delete['/:id'], makeRequest({
        method: 'DELETE',
        url: `/animals/${VISIBLE_ID}`,
        params: { id: String(VISIBLE_ID) },
      }));

      assert.strictEqual(denied, 404, 'the halting before-hook did not run for a denied record (was: 204)');
      assert.ok(store.get('animal', HIDDEN_ID), 'hidden record survives');
      assert.strictEqual(allowed, 204, 'the halting before-hook still runs for a visible record');
      assert.ok(store.get('animal', VISIBLE_ID), 'and still halts the operation, so the visible record survives too');
    });

    test('[DEFECT] assertion 27 — a FAILED create and a missing delete fire no after-hook either', async function(assert) {
      // GATE 1 short-circuits denied updates and deletes before the after-hook
      // loop is reached, so this assertion is what makes GATE 2's own after-hook
      // gate observable. Measured: without it, `if (!denied)` can be deleted
      // from the after-hook loop and the entire suite stays green.
      //
      // The three cases below are the ones GATE 1 cannot cover:
      //   create  -- the record does not exist until the handler builds it, so
      //              denial is only knowable afterwards
      //   missing -- the delete of a record that never existed; inherited debt,
      //              closed by the same gate
      //   400     -- a malformed write, in which nothing happened either
      record('after', 'create');
      record('after', 'delete');

      const ormRequest = new OrmRequest({ model: 'animal', access });

      const denied = await dispatch(ormRequest, ormRequest.handlers.post['/'], makeRequest({
        method: 'POST',
        url: '/animals',
        body: { data: { type: 'animal', id: CREATE_ID, attributes: { type: 1, age: 1, size: 'small', owner: 'restricted' } } },
      }));
      assert.strictEqual(denied, 403, 'denied create is 403');
      assert.strictEqual(fired.length, 0, 'a denied create fires no afterCreate hook (was: 1, with response=403)');

      const malformed = await dispatch(ormRequest, ormRequest.handlers.post['/'], makeRequest({
        method: 'POST',
        url: '/animals',
        body: { data: { attributes: { age: 1 } } },
      }));
      assert.strictEqual(malformed, 400, 'a POST with no type is 400');
      assert.strictEqual(fired.length, 0, 'and fires no afterCreate hook');

      const missing = await dispatch(ormRequest, ormRequest.handlers.delete['/:id'], makeRequest({
        method: 'DELETE',
        url: `/animals/${MISSING_ID}`,
        params: { id: String(MISSING_ID) },
      }));
      assert.strictEqual(missing, 404, 'delete of a record that never existed is 404');
      assert.strictEqual(fired.length, 0,
        'and fires no afterDelete hook (was: 1, with recordId=' + MISSING_ID + ' — inherited debt, ' +
        'and the reason a cascade could fire for an id the caller merely guessed)');
    });

    test('[GUARD] assertion 28 — an ALLOWED create still fires its after-hook', async function(assert) {
      // Proves 27 can fail in the opposite direction.
      record('after', 'create');

      const ormRequest = new OrmRequest({ model: 'animal', access });
      const response = await dispatch(ormRequest, ormRequest.handlers.post['/'], makeRequest({
        method: 'POST',
        url: '/animals',
        body: { data: { type: 'animal', id: CREATE_ID, attributes: { type: 1, age: 1, size: 'small', owner: 'gina' } } },
      }));

      assert.strictEqual(String(response.data.id), String(CREATE_ID), 'allowed create succeeds');
      assert.strictEqual(fired.length, 1, 'exactly one afterCreate hook fired');
      assert.ok(fired[0].response, 'and it carries a response in context');
    });

    test('[DEFECT] assertion 21 — a DENIED write triggers no autosave, an allowed one does', async function(assert) {
      // autosave lives 29 lines below the persist gate in the same function.
      // Ungated, an unauthenticated caller forces a full serialize-and-write of
      // the entire store on DELETE of any id, with no record touched.
      const originalAutosave = config.orm.db.autosave;
      const saveStub = sinon.stub(Orm.instance.db, 'save').resolves();
      config.orm.db.autosave = 'onUpdate';

      try {
        const ormRequest = new OrmRequest({ model: 'animal', access });
        const handler = ormRequest.handlers.delete['/:id'];

        const denied = await dispatch(ormRequest, handler, makeRequest({ method: 'DELETE', url: `/animals/${HIDDEN_ID}`, params: { id: String(HIDDEN_ID) } }));
        assert.strictEqual(denied, 404, 'denied delete returns 404');
        assert.strictEqual(saveStub.callCount, 0, 'denied delete triggered no Orm.db.save() (was: 1)');

        const missing = await dispatch(ormRequest, handler, makeRequest({ method: 'DELETE', url: `/animals/${MISSING_ID}`, params: { id: String(MISSING_ID) } }));
        assert.strictEqual(missing, 404, 'missing delete returns 404');
        assert.strictEqual(saveStub.callCount, 0, 'delete of a record that never existed triggered no save either (was: 1)');

        const allowed = await dispatch(ormRequest, handler, makeRequest({ method: 'DELETE', url: `/animals/${VISIBLE_ID}`, params: { id: String(VISIBLE_ID) } }));
        assert.strictEqual(allowed, 204, 'allowed delete returns 204');
        assert.strictEqual(saveStub.callCount, 1, 'an ALLOWED delete still autosaves exactly once');
      } finally {
        config.orm.db.autosave = originalAutosave;
        saveStub.restore();
      }
    });
  });

  // =========================================================================
  // The create collision oracle (assertions 22-23)
  //
  // createHandler's duplicate-id check runs BEFORE the filter and store.find
  // sees hidden records, so an unconditional 409 made POST a complete existence
  // oracle even with GET /:id correctly answering 404. Refinement's D1 ruling
  // justified 403-on-POST with "there is no pre-existing record whose existence
  // could leak"; a POST that COLLIDES has one.
  // =========================================================================
  module('create collision', function() {
    test('[DEFECT] assertion 22 — POST colliding with a HIDDEN id is indistinguishable from POST against an id that never existed', async function(assert) {
      const ormRequest = new OrmRequest({ model: 'animal', access });
      const handler = ormRequest.handlers.post['/'];

      const post = id => dispatch(ormRequest, handler, makeRequest({
        method: 'POST',
        url: '/animals',
        body: { data: { type: 'animal', id, attributes: { type: 1, age: 1, size: 'small', owner: 'restricted' } } },
      }));

      const collidesWithHidden = await post(HIDDEN_ID);
      const neverExisted = await post(MISSING_ID);

      assert.strictEqual(collidesWithHidden, 403, 'colliding with a hidden id is 403 (was: 409 — "record exists")');
      assert.strictEqual(neverExisted, 403, 'a never-existed id is 403');
      assert.strictEqual(collidesWithHidden, neverExisted,
        'the two are equal — two unauthenticated requests per id no longer enumerate the id space');
      assert.ok(store.get('animal', HIDDEN_ID), 'the colliding record was not touched');
      assert.notOk(store.get('animal', MISSING_ID), 'the denied create left nothing behind');
    });

    test('[GUARD] assertion 23 — POST colliding with a VISIBLE id is still 409', async function(assert) {
      // 409 discloses nothing the caller cannot already learn from GET /:id, so
      // the conflict status is preserved exactly where it is safe. This also
      // proves assertion 22 is not green merely because every POST is 403.
      const ormRequest = new OrmRequest({ model: 'animal', access });

      const response = await dispatch(ormRequest, ormRequest.handlers.post['/'], makeRequest({
        method: 'POST',
        url: '/animals',
        body: { data: { type: 'animal', id: VISIBLE_ID, attributes: { type: 1, age: 1, size: 'small', owner: 'gina' } } },
      }));

      assert.strictEqual(response, 409, 'colliding with a visible record is still 409');
      assert.strictEqual(store.get('animal', VISIBLE_ID).age, 3, 'the existing visible record is unchanged');
    });
  });

  // =========================================================================
  // Persist-gate boundaries (assertions 24-25)
  //
  // Both were surviving mutants: `>= 400` -> `> 400` on the gate, and dropping
  // `{ _skipAutoPersist: true }` from the create rollback.
  // =========================================================================
  module('persist gate boundaries (stubbed sqlDb)', function(boundaryHooks) {
    let persistStub;

    boundaryHooks.beforeEach(function() {
      persistStub = sinon.stub().resolves();
      Orm.initialized = true;
      Orm.instance.sqlDb = { persist: persistStub };
    });

    test('[GUARD] assertion 24 — the gate is `>= 400`: a 400 and a 409 write reach persist no more than a 403 does', async function(assert) {
      // Pins the boundary of the gate itself. `>= 400` -> `> 400` survived the
      // whole suite before this, because nothing asserted that a merely FAILED
      // write is kept away from persist — only a denied one.
      const ormRequest = new OrmRequest({ model: 'animal', access });
      const handler = ormRequest.handlers.post['/'];

      const badRequest = await dispatch(ormRequest, handler, makeRequest({
        method: 'POST',
        url: '/animals',
        body: { data: { attributes: { age: 1 } } }, // no `type` -> 400
      }));
      assert.strictEqual(badRequest, 400, 'a POST with no type is 400');

      const conflict = await dispatch(ormRequest, handler, makeRequest({
        method: 'POST',
        url: '/animals',
        body: { data: { type: 'animal', id: VISIBLE_ID, attributes: { type: 1, age: 1, size: 'small', owner: 'gina' } } },
      }));
      assert.strictEqual(conflict, 409, 'a POST colliding with a visible record is 409');

      assert.strictEqual(persistStub.getCalls().filter(call => call.args[0] === 'create').length, 0,
        'neither the 400 nor the 409 reached persist');
    });

    test('[DEFECT] assertion 25 — the denied-create rollback does not issue a SQL delete for a row that was never written', async function(assert) {
      // createRecord writes to the store before the predicate can run, so the
      // handler rolls back with store.remove(..., { _skipAutoPersist: true }).
      // Without that flag store.remove fires sqlDb.persist('delete', ...) itself
      // (src/store.ts:181) — a DELETE against a row no INSERT ever created.
      // Assertion 14 pins the rollback but runs in the tier where sqlDb is null,
      // so the only part of it that touches SQL was the untested part.
      const ormRequest = new OrmRequest({ model: 'animal', access });

      const response = await dispatch(ormRequest, ormRequest.handlers.post['/'], makeRequest({
        method: 'POST',
        url: '/animals',
        body: { data: { type: 'animal', id: CREATE_ID, attributes: { type: 1, age: 1, size: 'small', owner: 'restricted' } } },
      }));

      assert.strictEqual(response, 403, 'denied create is 403');
      assert.notOk(store.get('animal', CREATE_ID), 'the record was rolled back out of the store');
      assert.strictEqual(persistStub.getCalls().filter(call => call.args[0] === 'delete').length, 0,
        'the rollback issued no delete persist');
      assert.strictEqual(persistStub.getCalls().filter(call => call.args[0] === 'create').length, 0,
        'and the denied create issued no create persist');
    });
  });

  // =========================================================================
  // A throwing predicate (assertion 26)
  // =========================================================================
  module('predicate failure mode', function() {
    test('[DEFECT] assertion 26 — a predicate that throws fails CLOSED, and cannot be used as an oracle', async function(assert) {
      // Unguarded, a throw escapes to express's default handler, which answers
      // 500 (with a stack trace outside NODE_ENV=production) while a missing id
      // still answers 404 — so a record-dependent throw re-separates "hidden"
      // from "does not exist".
      const throwsOnHidden = () => rec => {
        if (String(rec.id) === String(HIDDEN_ID)) throw new Error('predicate blew up');
        return true;
      };
      const ormRequest = new OrmRequest({ model: 'animal', access: throwsOnHidden });
      const handler = ormRequest.handlers.get['/:id'];

      const thrown = await dispatch(ormRequest, handler, makeRequest({ url: `/animals/${HIDDEN_ID}`, params: { id: String(HIDDEN_ID) } }));
      const missing = await dispatch(ormRequest, handler, makeRequest({ url: `/animals/${MISSING_ID}`, params: { id: String(MISSING_ID) } }));

      assert.strictEqual(thrown, 404, 'a throwing predicate denies rather than propagating (was: uncaught, so express answered 500)');
      assert.strictEqual(thrown, missing, 'and is indistinguishable from a record that never existed');

      const visible = await dispatch(ormRequest, handler, makeRequest({ url: `/animals/${VISIBLE_ID}`, params: { id: String(VISIBLE_ID) } }));
      assert.strictEqual(String(visible.data.id), String(VISIBLE_ID), 'a record the predicate does not throw on is unaffected');
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

      // AC 16 says seven surfaces; collection GET and POST are the two the
      // earlier revision of this assertion left out.
      const collection = await dispatch(ormRequest, ormRequest.handlers.get['/'], makeRequest({ url: '/animals' }));
      assert.ok(collection.data.some(r => String(r.id) === String(HIDDEN_ID)), 'collection GET unaffected when no filter is present');

      const created = await dispatch(ormRequest, ormRequest.handlers.post['/'], makeRequest({
        method: 'POST',
        url: '/animals',
        body: { data: { type: 'animal', id: CREATE_ID, attributes: { type: 1, age: 1, size: 'small', owner: 'restricted' } } },
      }));
      assert.strictEqual(String(created.data.id), String(CREATE_ID), 'POST of a would-be-denied record succeeds when no filter is present');

      const deleted = await dispatch(ormRequest, ormRequest.handlers.delete['/:id'], makeRequest({
        method: 'DELETE',
        url: `/animals/${HIDDEN_ID}`,
        params: { id: String(HIDDEN_ID) },
      }));
      assert.strictEqual(deleted, 204, 'DELETE of an EXISTING record is still 204 — the behaviour change is scoped to the missing case');
    });
  });
});
