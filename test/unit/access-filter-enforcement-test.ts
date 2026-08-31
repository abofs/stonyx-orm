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
import transforms from '../../src/transforms.js';

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

// Builds the request shape @stonyx/rest-server hands `auth()` and the handlers.
//
// `baseUrl` and `path` are what the shipped matcher reads now, so this helper
// has to produce them the way Express does when `RestServer.mountRoute` mounts
// each model as a sub-app: `baseUrl` is the MATCHED MOUNT (case as the caller
// sent it, no query string, unaffected by an absolute-form target) and `path`
// is the remainder, also query-free. Measured against express 5.2.1:
//
//   GET /owners/angela                        baseUrl /owners  path /angela
//   GET /OwNeRs/angela                        baseUrl /OwNeRs  path /angela
//   GET /owners/angela?filter[age]=30         baseUrl /owners  path /angela
//   GET http://anything.example/owners/angela baseUrl /owners  path /angela
//   GET /api/animals/22  (mounted at /api)    baseUrl /api/animals path /22
//
// The default `mount` is the first path segment, which is the shape
// setup-rest-server produces for the default `ORM_REST_ROUTE` of '/'. Pass
// `mount` explicitly for a configured route. This helper is a STAND-IN: the
// integration tier drives the real router and is what proves these values are
// the ones express actually supplies — see the absolute-form assertion in
// test/integration/orm-test.ts.
function makeRequest({ method = 'GET', url, mount, path, params = {}, body, query = {} } = {}) {
  const target = String(url ?? '');
  const pathname = target.includes('://')
    ? `/${target.split('://')[1].split('/').slice(1).join('/')}`.split('?')[0]
    : target.split('?')[0];
  const baseUrl = mount !== undefined ? mount : `/${pathname.split('/')[1] ?? ''}`;
  const rest = path !== undefined
    ? path
    : (typeof baseUrl === 'string' ? (pathname.slice(baseUrl.length) || '/') : '/');

  return {
    protocol: 'http',
    method,
    originalUrl: url,
    baseUrl,
    path: rest,
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
  // Sweeps the whole 9100-9199 band this file parks its subjects in, rather
  // than a fixed id list. Several assertions now POST WITHOUT an id -- they have
  // to, because a client-supplied id under a per-record filter is refused
  // before createRecord is ever reached -- so the id a create lands on is
  // assigned by assignRecordId and is not known to the caller in advance.
  // A fixed list leaked those records into every later file.
  const animals = store.get('animal') as Map<string | number, unknown> | undefined;
  for (const key of Array.from(animals?.keys() ?? [])) {
    if (typeof key === 'number' && key >= 9100 && key <= 9199) {
      store.remove('animal', key, { _skipAutoPersist: true });
    }
  }

  while (ownedOwners.length) {
    const id = ownedOwners.pop();
    if (store.get('owner', id)) store.remove('owner', id, { _skipAutoPersist: true });
  }
}

// The ids currently held by the animal store, for assertions that must prove a
// denied create added or removed NOTHING without knowing which id it would have
// landed on.
function animalIds() {
  return Array.from((store.get('animal') as Map<string | number, unknown>).keys());
}

// An `access` that yields NO per-record filter -- the array shape. Used wherever
// an assertion is about the unfiltered population: 409-on-collision, and the
// raw-vs-normalised id lookup, both of which are unreachable through a
// function-style filter now that GATE 0 refuses client-supplied ids.
const noFilterAccess = () => ['read', 'create', 'update', 'delete'];

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

      // NO `id` in the body, deliberately. GATE 0 now refuses a client-supplied
      // id under a per-record filter BEFORE createRecord runs, so an id-bearing
      // payload would return 403 without ever reaching the rollback -- the
      // assertion would still be green and would have stopped testing the thing
      // it is named for. The id-bearing case is assertion 22's subject.
      const before = animalIds();

      const response = await dispatch(ormRequest, handler, makeRequest({
        method: 'POST',
        url: '/animals',
        body: { data: { type: 'animal', attributes: { type: 1, age: 1, size: 'small', owner: 'restricted' } } },
      }));

      assert.strictEqual(response, 403, 'denied create is 403, explicitly not 404 (was: 200)');
      assert.deepEqual(animalIds(), before, 'denied create left no record behind (was: persisted)');
    });

    test('[GUARD] assertion 15 — POST passing the filter still succeeds and persists', async function(assert) {
      const ormRequest = new OrmRequest({ model: 'animal', access });
      const handler = ormRequest.handlers.post['/'];

      const before = animalIds();

      const response = await dispatch(ormRequest, handler, makeRequest({
        method: 'POST',
        url: '/animals',
        body: { data: { type: 'animal', attributes: { type: 1, age: 1, size: 'small', owner: 'gina' } } },
      }));

      assert.notStrictEqual(response, 403, 'allowed create is not blocked');
      assert.strictEqual(animalIds().length, before.length + 1, 'exactly one record was added');
      assert.ok(store.get('animal', response.data.id), 'allowed create persisted the record at the id it reported');
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

      // No `id`: an id-bearing payload is refused by GATE 0 before createRecord
      // runs, which is a different code path and does not exercise GATE 2.
      const denied = await dispatch(ormRequest, ormRequest.handlers.post['/'], makeRequest({
        method: 'POST',
        url: '/animals',
        body: { data: { type: 'animal', attributes: { type: 1, age: 1, size: 'small', owner: 'restricted' } } },
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
        body: { data: { type: 'animal', attributes: { type: 1, age: 1, size: 'small', owner: 'gina' } } },
      }));

      assert.ok(store.get('animal', response.data.id), 'allowed create succeeds');
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
    test('[DEFECT] assertion 22 — the POST oracle is closed for EVERY payload, not just a denied one', async function(assert) {
      // WHAT THE PREVIOUS VERSION OF THIS ASSERTION PROVED, AND WHY IT WAS NOT
      // ENOUGH. It posted twice and both payloads carried `owner:"restricted"`,
      // so both were DENIED creates and both were 403. It pinned the branch and
      // not the property: the oracle is payload-dependent, and the one payload
      // shape it used is the one shape that cannot exhibit it. Measured against
      // the reviewed head with an ALLOWED payload — three-way distinguishable in
      // ONE request per id:
      //
      //   POST {id: HIDDEN,  owner:'gina'} -> 403   a hidden record has this id
      //   POST {id: MISSING, owner:'gina'} -> 200   this id is free
      //   POST {id: VISIBLE, owner:'gina'} -> 409   a visible record has this id
      //
      // So this varies the payload across allowed AND denied, and the id across
      // hidden, visible and free. Every cell must be the SAME status.
      const ormRequest = new OrmRequest({ model: 'animal', access });
      const handler = ormRequest.handlers.post['/'];

      const post = (id, owner) => dispatch(ormRequest, handler, makeRequest({
        method: 'POST',
        url: '/animals',
        body: { data: { type: 'animal', id, attributes: { type: 1, age: 1, size: 'small', owner } } },
      }));

      const results = [];
      for (const owner of ['gina', 'restricted']) {           // allowed / denied payload
        for (const id of [HIDDEN_ID, VISIBLE_ID, MISSING_ID]) { // hidden / visible / free id
          for (const shape of [id, String(id)]) {              // numeric / string-typed
            results.push({ owner, id, shape, status: await post(shape, owner) });
          }
        }
      }

      const statuses = [...new Set(results.map(r => r.status))];
      assert.deepEqual(statuses, [403],
        'every (payload x id x id-type) cell is 403 — one status, so one request per id ' +
        'distinguishes nothing (was: 403 hidden / 200 free / 409 visible under an ALLOWED payload)');

      assert.ok(store.get('animal', HIDDEN_ID), 'the hidden colliding record was not touched');
      assert.strictEqual(store.get('animal', VISIBLE_ID).age, 3, 'the visible colliding record was not touched');
      assert.notOk(store.get('animal', MISSING_ID), 'no denied create left a record behind');
    });

    test('[GUARD] assertion 23 — the refusal is scoped to filtered callers: 409 and 200 both survive without a filter', async function(assert) {
      // Proves assertion 22 is not green merely because every POST is 403 now,
      // and pins the scope of GATE 0. An unfiltered caller — the population the
      // oracle does not exist for, since there are no hidden records — keeps
      // the documented 409-on-duplicate and still creates at a chosen id.
      const ormRequest = new OrmRequest({ model: 'animal', access: noFilterAccess });
      const handler = ormRequest.handlers.post['/'];

      const conflict = await dispatch(ormRequest, handler, makeRequest({
        method: 'POST',
        url: '/animals',
        body: { data: { type: 'animal', id: VISIBLE_ID, attributes: { type: 1, age: 1, size: 'small', owner: 'gina' } } },
      }));
      assert.strictEqual(conflict, 409, 'an unfiltered caller still gets 409 on a duplicate id');
      assert.strictEqual(store.get('animal', VISIBLE_ID).age, 3, 'and the existing record is unchanged');

      const created = await dispatch(ormRequest, handler, makeRequest({
        method: 'POST',
        url: '/animals',
        body: { data: { type: 'animal', id: CREATE_ID, attributes: { type: 1, age: 1, size: 'small', owner: 'gina' } } },
      }));
      assert.strictEqual(String(created.data.id), String(CREATE_ID), 'and still creates at a client-supplied id');
    });

    test('[DEFECT] assertion 29 — a string-typed id cannot skip the collision lookup', async function(assert) {
      // `createHandler` looked the collision up with the RAW body value while
      // every other surface normalised through `getId()`. The store is a Map
      // keyed by the coerced value, so `store.find(model, '9102')` missed the
      // entry held under `9102`, the duplicate check was skipped, and
      // createRecord took its last-entry-wins branch. On `dev` that silently
      // OVERWROTE the colliding record and answered 200. Half of the blocker.
      //
      // Exercised through an UNFILTERED caller because that is the only caller
      // that now reaches the lookup at all — which is also the population this
      // silent-overwrite bug is live for.
      const ormRequest = new OrmRequest({ model: 'animal', access: noFilterAccess });

      const response = await dispatch(ormRequest, ormRequest.handlers.post['/'], makeRequest({
        method: 'POST',
        url: '/animals',
        body: { data: { type: 'animal', id: String(VISIBLE_ID), attributes: { type: 1, age: 42, size: 'large', owner: 'restricted' } } },
      }));

      assert.strictEqual(response, 409, 'a string-typed duplicate id is 409, exactly as the numeric one is (was: 200)');
      assert.strictEqual(store.get('animal', VISIBLE_ID).age, 3, 'and the colliding record was NOT overwritten (was: age 42)');
    });

    test('[DEFECT] assertion 30 — no POST payload can make a denied create remove a pre-existing record', async function(assert) {
      // THE BLOCKER, as a property over the payload space rather than one case.
      //
      //   POST /animals {"id":"21", ..., "owner":"restricted"}
      //     -> 403, and hidden record 21 is DELETED.
      //
      // The rollback required for a denied create was implemented as
      // `store.remove(model, record.id)`. Keyed by a caller-supplied value that
      // the collision lookup could be made to skip, a rollback IS a write
      // primitive: the 403 branch became the destructor, and an unauthenticated
      // caller could delete any id, hidden or not, with no DELETE request.
      //
      // Verified against `dev` by the reviewer: `dev` only ever OVERWRITES here.
      // The deletion is introduced by the rollback, so it must be pinned over
      // the whole payload space and not just the one shape that found it.
      const ormRequest = new OrmRequest({ model: 'animal', access });
      const handler = ormRequest.handlers.post['/'];

      const hiddenBefore = store.get('animal', HIDDEN_ID);
      const visibleBefore = store.get('animal', VISIBLE_ID);

      for (const owner of ['restricted', 'gina', undefined]) {
        for (const id of [HIDDEN_ID, VISIBLE_ID, MISSING_ID, 0]) {
          for (const shape of [id, String(id)]) {
            await dispatch(ormRequest, handler, makeRequest({
              method: 'POST',
              url: '/animals',
              body: { data: { type: 'animal', id: shape, attributes: { type: 1, age: 77, size: 'small', owner } } },
            }));

            assert.strictEqual(store.get('animal', HIDDEN_ID), hiddenBefore,
              `hidden record survives POST id=${JSON.stringify(shape)} owner=${owner} (was: DELETED for a string-typed id)`);
            assert.strictEqual(store.get('animal', VISIBLE_ID), visibleBefore,
              `visible record survives POST id=${JSON.stringify(shape)} owner=${owner}`);
          }
        }
      }

      assert.strictEqual(store.get('animal', HIDDEN_ID).age, 2, 'and the hidden record was not overwritten either');
    });

    test('[DEFECT] assertion 31 — the rollback removes only a slot THIS request created', async function(assert) {
      // The other half of the blocker, and the half that survives GATE 0.
      //
      // `assignRecordId` returns last-INSERTED + 1, not max + 1, so a store
      // whose insertion order is not ascending hands a create an id that is
      // ALREADY TAKEN. createRecord then mutates that record in place. The
      // rollback used to `store.remove` it — destroying a pre-existing record
      // for a request that supplied no id at all, which GATE 0 therefore cannot
      // refuse.
      //
      // Identity alone does NOT catch this: the overwrite is in place, so
      // `store.get(model, record.id) === record` is true for a record this
      // request did not create. The store's size is the signal that separates an
      // insert from an overwrite.
      //
      // LIMIT OF THIS ASSERTION, stated: the pre-existing record's ATTRIBUTES
      // are still clobbered by the colliding assignRecordId — that is a distinct
      // pre-existing defect, filed as abofs/stonyx-orm#203 and not fixed here.
      // This pins the ROLLBACK only: a 403 must not remove the slot.
      const OCCUPIED = 9104;
      const LAST = 9103;
      createRecord('animal', { id: OCCUPIED, type: 1, age: 5, size: 'small', owner: 'gina', traits: [] }, { serialize: false, _skipAutoPersist: true });
      createRecord('animal', { id: LAST, type: 1, age: 6, size: 'small', owner: 'gina', traits: [] }, { serialize: false, _skipAutoPersist: true });

      // Predecessor assertion rather than re-implementing assignRecordId: the
      // id a no-id create lands on is last-inserted + 1, and that slot is taken.
      assert.strictEqual(animalIds().at(-1), LAST, 'the last INSERTED animal is 9103, not the highest id');
      assert.ok(store.get('animal', OCCUPIED), 'and 9104 — which is 9103 + 1 — is already occupied');

      const ormRequest = new OrmRequest({ model: 'animal', access });
      const response = await dispatch(ormRequest, ormRequest.handlers.post['/'], makeRequest({
        method: 'POST',
        url: '/animals',
        body: { data: { type: 'animal', attributes: { type: 1, age: 1, size: 'small', owner: 'restricted' } } },
      }));

      assert.strictEqual(response, 403, 'the create is denied');
      assert.ok(store.get('animal', OCCUPIED),
        'the pre-existing record it collided with was NOT removed by the rollback (was: DELETED — a 403 that destroys a record no request named)');
    });
  });

  // =========================================================================
  // GATE 0's other channels, and its boundary (assertions 39-44)
  //
  // Round 3 closed the POST existence oracle by refusing a client-supplied `id`
  // under a function-style filter. Verification then walked round it by moving
  // the id ONE FIELD, and pinned two of GATE 0's stated properties to nothing:
  //
  //   * `createHandler` strips `attributes.id` and then re-admitted a caller id
  //     eleven lines later through an unfiltered `Object.entries(rels)` loop
  //     whose `key` is verbatim from the body (assertion 39).
  //   * `updateHandler`'s ATTRIBUTE loop guards `key === 'id'`; its
  //     RELATIONSHIPS loop did not (assertion 40) -- and the ATTRIBUTE guard
  //     that WAS already there turned out to be unkillable too, so 39 and 40
  //     each sweep BOTH channels rather than only the one that was missing.
  //   * "the refusal happens BEFORE any store lookup" is the LATENCY half of the
  //     closure, and moving the refusal after a `store.find` survived at 920/0
  //     (assertion 41).
  //   * `id: null` — the boundary of `id !== undefined` (assertion 42).
  //   * the body-id coercion diverged from the URL surface's, on a hex-shaped
  //     id (assertion 43) and on whitespace (assertion 44).
  // =========================================================================
  module('GATE 0 — the other id channels and the boundary', function() {
    test('[DEFECT] assertion 39 — a caller id cannot reach createRecord through `relationships` or `attributes`', async function(assert) {
      // THE BYPASS. `createHandler` deliberately strips `attributes.id`:
      //
      //   const { id: _ignoredId, ...sanitizedAttributes } = attributes || {};
      //
      // and then wrote every relationship key straight back into that same
      // object, with `key` taken verbatim from the request body and never
      // checked. `key === 'id'` therefore put the caller's id into
      // `recordAttributes` while top-level `id` stayed `undefined` — so GATE 0
      // never fired, the collision lookup never ran, and `createRecord` took its
      // last-entry-wins branch. Measured over the real router, unauthenticated:
      //
      //   GET  /animals/21                              -> 404  (hidden)
      //   POST /animals {"id":21, ...}                  -> 403  GATE 0 works
      //   POST /animals {"relationships":{"id":{"data":{"id":21}}},
      //                  "attributes":{"owner":"gina"}} -> 200  *** BYPASS ***
      //   GET  /animals/21                              -> 200  *** de-hidden ***
      //
      // The hidden record is overwritten in place and its `owner` reset to a
      // value the caller chose, which removes it from the filter's scope FOR
      // GOOD. That is #190 itself, on the create surface, reachable by moving
      // one field in the JSON body.
      //
      // PROVENANCE: the unfiltered key loop is INHERITED — `origin/dev` carries
      // it verbatim, and on `dev` there is no filter on create at all, so
      // merging does not regress it. It does NOT reach a deletion: with an
      // existing id the store does not grow, `createdNewSlot` is false and the
      // rollback correctly skips. What made it a blocker is that four artifacts
      // asserted a guarantee it defeats. The general form — the loop accepts ANY
      // key, not just `id` — is filed as abofs/stonyx-orm#204.
      const ormRequest = new OrmRequest({ model: 'animal', access });
      const handler = ormRequest.handlers.post['/'];
      const getOne = ormRequest.handlers.get['/:id'];

      // Both non-top-level channels. `attributes.id` is stripped on the line
      // above the relationships loop and has been for longer, but nothing in
      // this file pinned it either — it was killed only incidentally, by a
      // pre-existing integration test that is about something else. A guarantee
      // that rests on two strips should be pinned by assertions that name both.
      const channelBody = (channel, id, owner) => ({ data: {
        type: 'animal',
        ...(channel === 'relationships'
          ? { relationships: { id: { data: { id } } }, attributes: { type: 1, age: 77, size: 'large', owner } }
          : { attributes: { id, type: 1, age: 77, size: 'large', owner } }),
      } });

      const relsPost = (id, owner, channel = 'relationships') => dispatch(ormRequest, handler, makeRequest({
        method: 'POST',
        url: '/animals',
        body: channelBody(channel, id, owner),
      }));

      const hiddenBefore = store.get('animal', HIDDEN_ID);
      assert.strictEqual(
        await dispatch(ormRequest, getOne, makeRequest({ url: `/animals/${HIDDEN_ID}`, params: { id: String(HIDDEN_ID) } })),
        404, 'precondition: the hidden record reads as absent');

      for (const channel of ['relationships', 'attributes']) {
        for (const owner of ['gina', 'restricted']) {
          for (const shape of [HIDDEN_ID, String(HIDDEN_ID)]) {
            const response = await relsPost(shape, owner, channel);

            assert.strictEqual(store.get('animal', HIDDEN_ID), hiddenBefore,
              `the hidden record still occupies its slot after ${channel}.id=${JSON.stringify(shape)} owner=${owner}`);
            assert.strictEqual(store.get('animal', HIDDEN_ID).age, 2,
              `and was NOT overwritten via ${channel} (was: age 77, owner ${owner}, permanently de-hidden)`);
            assert.notStrictEqual(response?.data?.id, HIDDEN_ID,
              `and no create landed on the caller-chosen id via ${channel}`);
          }
        }
      }

      assert.strictEqual(
        await dispatch(ormRequest, getOne, makeRequest({ url: `/animals/${HIDDEN_ID}`, params: { id: String(HIDDEN_ID) } })),
        404, 'the hidden record still reads as absent afterwards (was: 200 — permanently de-hidden)');

      // The same channel on the UNFILTERED population — the shape `dev` is live
      // for. GATE 0 does not apply there, so what must hold is that the id is
      // ignored rather than used: no silent overwrite of the colliding record.
      const unfiltered = new OrmRequest({ model: 'animal', access: noFilterAccess });
      const visibleBefore = store.get('animal', VISIBLE_ID);

      for (const channel of ['relationships', 'attributes']) {
        const keysBefore = animalIds();
        await dispatch(unfiltered, unfiltered.handlers.post['/'], makeRequest({
          method: 'POST',
          url: '/animals',
          body: { data: {
            type: 'animal',
            ...(channel === 'relationships'
              ? { relationships: { id: { data: { id: VISIBLE_ID } } }, attributes: { type: 1, age: 88, size: 'large', owner: 'gina' } }
              : { attributes: { id: VISIBLE_ID, type: 1, age: 88, size: 'large', owner: 'gina' } }),
          } },
        }));

        assert.strictEqual(store.get('animal', VISIBLE_ID), visibleBefore, `an unfiltered caller cannot re-key a create through ${channel} either`);
        assert.strictEqual(store.get('animal', VISIBLE_ID).age, 3, `and the colliding record was not overwritten via ${channel} (was: age 88)`);

        for (const key of animalIds()) {
          if (!keysBefore.includes(key)) store.remove('animal', key, { _skipAutoPersist: true });
        }
      }
    });

    test('[GUARD] assertion 39b — a DECLARED relationship key still reaches the record', async function(assert) {
      // Proves 39 is not green because the relationships loop stopped working.
      // Only the `id` key is dropped; `owner` — a real belongsTo — still applies.
      const unfiltered = new OrmRequest({ model: 'animal', access: noFilterAccess });

      const created = await dispatch(unfiltered, unfiltered.handlers.post['/'], makeRequest({
        method: 'POST',
        url: '/animals',
        body: { data: {
          type: 'animal',
          relationships: { owner: { data: { id: 'gina' } } },
          attributes: { type: 1, age: 4, size: 'small' },
        } },
      }));

      assert.strictEqual(created?.data?.relationships?.owner?.data?.id, 'gina',
        'the declared relationship was applied through the same loop');
    });

    test('[DEFECT] assertion 40 — a PATCH cannot re-key a record through `relationships` or `attributes`', async function(assert) {
      // The same missing key filter, two handlers apart. `updateHandler`'s
      // ATTRIBUTE loop has `if (key === 'id') continue;`; its RELATIONSHIPS loop
      // passed `key` straight into `updateRecord`. Measured:
      //
      //   PATCH /animals/9102 {"relationships":{"id":{"data":{"id":9101}}}}
      //     -> 200, and the record held under store key 9102 now reports id 9101
      //
      // The store key and the record's own id diverge, so a VISIBLE record ends
      // up claiming a HIDDEN record's identity — every downstream surface that
      // reads `record.id` rather than the map key (links, `toJSON`, relationship
      // linkage) then emits it. Gated by GATE 1 on the addressed record, so it
      // is not itself a filter bypass; it is store corruption reachable by any
      // caller who can PATCH anything.
      //
      // PROVENANCE: INHERITED — `origin/dev` has the identical loop. Filed with
      // the create-side channel as abofs/stonyx-orm#204.
      // BOTH channels, not just the one that was missing a filter. The
      // attribute loop's `if (key === 'id') continue;` was ALREADY there and
      // was UNKILLABLE — no test distinguished its presence from its absence,
      // measured, and it is load-bearing: `Object.hasOwn(record, 'id')` is
      // `true` on an OrmRecord, so dropping it re-keys the record exactly as the
      // relationships channel did. A guard that only one of two sibling loops
      // has, and that nothing pins, is how the second one goes missing.
      const ormRequest = new OrmRequest({ model: 'animal', access });
      const channels = [
        ['relationships', { relationships: { id: { data: { id: HIDDEN_ID } } }, attributes: { age: 12 } }],
        ['attributes', { attributes: { id: HIDDEN_ID, age: 12 } }],
      ];

      for (const [channel, data] of channels) {
        const hiddenBefore = store.get('animal', HIDDEN_ID);
        store.get('animal', VISIBLE_ID).age = 3;

        const response = await dispatch(ormRequest, ormRequest.handlers.patch['/:id'], makeRequest({
          method: 'PATCH',
          url: `/animals/${VISIBLE_ID}`,
          params: { id: String(VISIBLE_ID) },
          body: { data },
        }));

        assert.strictEqual(store.get('animal', VISIBLE_ID).id, VISIBLE_ID,
          `${channel}: the patched record keeps its own id (was: ${HIDDEN_ID} — the caller re-keyed it)`);
        assert.strictEqual(response?.data?.id, VISIBLE_ID, `${channel}: and the response reports the real id`);
        assert.strictEqual(store.get('animal', HIDDEN_ID), hiddenBefore, `${channel}: the hidden record is untouched`);
        assert.strictEqual(store.get('animal', VISIBLE_ID).age, 12,
          `${channel}: while the rest of the payload still applied — the loop is filtered, not disabled`);
      }
    });

    test('[GUARD] assertion 40b — a DECLARED relationship key still applies on PATCH', async function(assert) {
      // Counter-guard for 40: proves the relationships loop in updateHandler is
      // still live, so 40 is not green because the loop stopped applying
      // anything. Exercised on `/traits`, not `/animals`, because the animal
      // model carries a custom serializer and `updateRecord` runs the raw-shape
      // serializer path, under which a flat `{owner: 'x'}` maps to nothing —
      // measured, not assumed. `trait` has no serializer and a real
      // `belongsTo('category')`, so the loop's effect is observable there.
      const ormRequest = new OrmRequest({ model: 'trait', access: noFilterAccess });
      const TRAIT = 9150;
      const target = 'physical-9150';
      const other = 'appearance-9150';
      // Seeded here rather than borrowed: this file must run standalone, and the
      // category store is empty until the integration suite has run.
      for (const id of [target, other]) createRecord('category', { id, name: id }, { serialize: false, _skipAutoPersist: true });
      createRecord('trait', { id: TRAIT, type: 'habitat', value: 'farm', category: other }, { serialize: false, _skipAutoPersist: true });

      try {
        await dispatch(ormRequest, ormRequest.handlers.patch['/:id'], makeRequest({
          method: 'PATCH',
          url: `/traits/${TRAIT}`,
          params: { id: String(TRAIT) },
          body: { data: { relationships: { category: { data: { id: target } } } } },
        }));

        assert.strictEqual(store.get('trait', TRAIT).category?.id, target,
          `a declared relationship still resolves and applies through the same loop (was: ${other})`);
        assert.strictEqual(store.get('trait', TRAIT).id, TRAIT, 'and the record still holds its own id');
      } finally {
        store.remove('trait', TRAIT, { _skipAutoPersist: true });
        for (const id of [target, other]) store.remove('category', id, { _skipAutoPersist: true });
      }
    });

    test('[GUARD] assertion 41 — the refusal happens BEFORE any store lookup, not merely with the same status', async function(assert) {
      // The LATENCY half of the oracle closure. GATE 0's stated guarantee is
      // that "no status, and no LOOKUP COST, can depend on whether that id
      // exists" — which is what lets #197 be characterised as a ~0.06ms
      // post-fetch residual rather than a live timing oracle on POST.
      //
      // Status alone cannot pin that: moving the refusal to AFTER a
      // `store.find(model, normalizeBodyId(id))` and returning the same 403
      // leaves the whole suite at 920/0, while re-opening a measurable
      // hit-versus-miss difference on every id-bearing POST. Pinned by
      // observing the lookup itself rather than by timing it, which would be
      // flaky. Mutation `V_g0_after_lookup`.
      const ormRequest = new OrmRequest({ model: 'animal', access });
      const handler = ormRequest.handlers.post['/'];
      const findSpy = sinon.spy(store, 'find');

      for (const id of [HIDDEN_ID, VISIBLE_ID, MISSING_ID, String(HIDDEN_ID)]) {
        findSpy.resetHistory();

        const response = await dispatch(ormRequest, handler, makeRequest({
          method: 'POST',
          url: '/animals',
          body: { data: { type: 'animal', id, attributes: { type: 1, age: 1, size: 'small', owner: 'gina' } } },
        }));

        assert.strictEqual(response, 403, `id=${JSON.stringify(id)} is refused`);
        assert.strictEqual(findSpy.callCount, 0,
          `and the refusal issued NO store lookup for id=${JSON.stringify(id)} — ` +
          'a lookup here reintroduces a hit-vs-miss timing difference behind an identical status');
      }
    });

    test('[GUARD] assertion 42 — every FALSY id shape is refused: the boundary of `id !== undefined`', async function(assert) {
      // GATE 0 tests `id !== undefined`, deliberately — not `!= null`, and not
      // "truthy". Every falsy shape a body can carry has still NAMED the id
      // member of the resource object, and each one is its own exemption a
      // future edit can introduce while the suite stays green:
      //
      //   `id !== undefined && id !== null`   -> `V_g0_null`
      //   `id !== undefined && id !== 0`      -> `V_g0_zero`
      //
      // Both skip the refusal AND the collision lookup. `0` matters more than
      // it looks: it is a legitimate store key (assertion 30 sweeps it), so a
      // caller who could get past the gate with `{"id":0}` would learn from the
      // 409-vs-200 whether record 0 exists — the whole oracle, for one id.
      // `assignRecordId`'s falsy guard then hands the create a server id, which
      // is why nothing is left behind either way and why only the STATUS can
      // pin this.
      const ormRequest = new OrmRequest({ model: 'animal', access });
      const idsBefore = animalIds();

      for (const id of [null, 0, '0', '', false]) {
        for (const owner of ['gina', 'restricted']) {
          const response = await dispatch(ormRequest, ormRequest.handlers.post['/'], makeRequest({
            method: 'POST',
            url: '/animals',
            body: { data: { type: 'animal', id, attributes: { type: 1, age: 1, size: 'small', owner } } },
          }));

          assert.strictEqual(response, 403,
            `{"id": ${JSON.stringify(id)}, owner: "${owner}"} is refused exactly as a numeric id is ` +
            '(was: 200 for an allowed payload)');
        }
      }

      assert.deepEqual(animalIds(), idsBefore, 'and no record was created by any of them');
    });

    test('[DEFECT] assertion 43 — the body-id coercion agrees with the URL surface, and rejects rather than truncates', async function(assert) {
      // WHY THIS IS A DEFECT AND NOT A PREFERENCE. `normalizeBodyId` exists so
      // the collision lookup uses the key the store actually holds — the whole
      // point of the round-3 blocker fix. It used `parseInt(id, 10)`, with an
      // explicit radix, while `getId()` — the coercion the URL surface uses, and
      // therefore the one that decides which record an id ADDRESSES — uses
      // `parseInt(id)` with none. The two disagree on a hex-shaped id:
      //
      //   GET  /animals/0x2391                   -> record 9105   (getId -> 9105)
      //   POST /animals {"id":"0x2391"}          -> lookup under 0, a MISS
      //                                          -> 200, and record 9105 is OVERWRITTEN
      //
      // That is the raw-versus-normalised divergence the blocker was, in a
      // narrower form, reintroduced by the fix for it. The two coercions now
      // share one function, so they cannot diverge again by editing one of them.
      //
      // AND THE DELIBERATE CHOICE, since `Number` was the alternative: `Number`
      // agrees with `getId` on `'0x2391'` but disagrees on `'1e3'` and `'9105.5'`,
      // so it trades one divergence for two. `parseInt` BEHIND the existing
      // `isNaN(Number(id))` gate is what rejects a partially-numeric id instead
      // of truncating it — `parseInt('9105h')` is `9105`, and truncating a
      // partially-valid id into a DIFFERENT VALID key is exactly how the
      // collision lookup was skipped. The gate is what makes that safe, so the
      // `'9105h'` cell below pins the gate, not the parser.
      const unfiltered = new OrmRequest({ model: 'animal', access: noFilterAccess });
      const EXISTING = 9105;
      createRecord('animal', { id: EXISTING, type: 1, age: 7, size: 'small', owner: 'gina', traits: [] }, { serialize: false, _skipAutoPersist: true });

      // The URL surface is the reference: this is the record `0x2391` addresses.
      const addressed = await dispatch(unfiltered, unfiltered.handlers.get['/:id'], makeRequest({
        url: '/animals/0x2391', params: { id: '0x2391' },
      }));
      assert.strictEqual(addressed?.data?.id, EXISTING, 'precondition: GET /animals/0x2391 addresses record 9105');

      const post = id => dispatch(unfiltered, unfiltered.handlers.post['/'], makeRequest({
        method: 'POST',
        url: '/animals',
        body: { data: { type: 'animal', id, attributes: { type: 1, age: 99, size: 'large', owner: 'gina' } } },
      }));

      // [collides, why]
      const cases = [
        [String(EXISTING), true, 'the plain string form of an existing numeric key'],
        ['0x2391', true, 'the HEX form — the URL surface resolves it to 9105, so the body surface must too (was: parseInt radix 10 -> 0, a MISS, and 9105 was overwritten)'],
        [` ${EXISTING} `, true, 'whitespace-padded, which both coercions accept'],
        ['', false, 'empty names no id at all, so it collides with nothing'],
      ];

      for (const [id, collides, why] of cases) {
        const keysBefore = animalIds();
        const response = await post(id);

        if (collides) {
          assert.strictEqual(response, 409, `POST {"id":${JSON.stringify(id)}} is 409 — ${why}`);
        } else {
          assert.notStrictEqual(response, 409, `POST {"id":${JSON.stringify(id)}} is NOT 409 — ${why}`);
        }
        assert.strictEqual(store.get('animal', EXISTING).age, 7,
          `and record ${EXISTING} was not overwritten by {"id":${JSON.stringify(id)}}`);

        for (const key of animalIds()) {
          if (!keysBefore.includes(key)) store.remove('animal', key, { _skipAutoPersist: true });
        }
      }

      // THE RESIDUAL, PINNED RATHER THAN CLAIMED — and it is why the `isNaN`
      // gate is described above as the load-bearing half.
      //
      // `'9105h'` is correctly REJECTED by the lookup: `isNaN` sends it through
      // as a string, so it is not truncated to 9105 and does not answer a false
      // 409. But the MODEL's id transform is a bare `parseInt` with no such
      // gate, so `createRecord` lands the record on 9105 anyway and overwrites
      // it. The lookup key and the landing key disagree — the same shape as the
      // round-3 blocker, one layer down.
      //
      // NOT FIXED HERE, deliberately, and for the same reason #203 was not: the
      // id transform reaches every `createRecord` caller in the library, and
      // changing id coercion for everybody inside an authorization patch is how
      // a security patch acquires an unrelated regression. `normalizeBodyId`
      // cannot close it alone either — a model with a STRING id (`owner`,
      // `category`) needs `isNaN` to pass `'gina'` through, and dropping the
      // gate to match the numeric transform would make `POST {"id":"gina"}` miss
      // owner `gina` entirely. Filed as abofs/stonyx-orm#205.
      //
      // GATE 0 closes it for the filtered population — any client-supplied id is
      // 403 — so what remains is a data-integrity defect on UNFILTERED
      // collections, exactly like #203. Asserting it here means a future change
      // to either coercion is a red test rather than a silent behaviour change.
      const truncating = await post('9105h');
      assert.notStrictEqual(truncating, 409,
        'POST {"id":"9105h"} is NOT 409 — a partially numeric id is rejected at the LOOKUP, not truncated to 9105');
      assert.strictEqual(store.get('animal', EXISTING).age, 99,
        'RESIDUAL (abofs/stonyx-orm#205): the model id transform truncates it anyway, so the write still lands on 9105 — ' +
        'pinned so that closing #205 turns this assertion red rather than passing silently');

      store.remove('animal', EXISTING, { _skipAutoPersist: true });
    });

    test('[DEFECT] assertion 44 — `""` means NO id, while `"   "` addresses the slot `getId` says it does', async function(assert) {
      // `normalizeBodyId` diverges from `getId` in exactly one place, and this
      // is it. Both halves are killable and neither was pinned:
      //
      //   `""`    -> `""`.  It is the only string that means "no id":
      //             `createRecord` treats it as absent and assigns a server id.
      //             Coercing it instead gives `parseInt("")` = `NaN`, and a
      //             record CAN be held under `NaN` — so `POST {"id":""}` would
      //             answer 409 against a record it never named.
      //   `"   "` -> `NaN`.  It is truthy, so it survives `assignRecordId`'s
      //             falsy guard and NaNs in the id transform; `getId` maps it to
      //             `NaN` too, so it ADDRESSES that slot on every other route.
      //             The previous `id.trim() === ""` short-circuit made the body
      //             surface miss a record the URL surface can reach — the same
      //             class of divergence as the hex case in assertion 43.
      //
      // Measured, not assumed: the NaN slot below is created by the first POST.
      const unfiltered = new OrmRequest({ model: 'animal', access: noFilterAccess });
      const keysBefore = animalIds();
      const post = id => dispatch(unfiltered, unfiltered.handlers.post['/'], makeRequest({
        method: 'POST',
        url: '/animals',
        body: { data: { type: 'animal', id, attributes: { type: 1, age: 1, size: 'small', owner: 'gina' } } },
      }));

      try {
        await post('   ');
        assert.ok(animalIds().some(key => typeof key === 'number' && Number.isNaN(key)),
          'precondition: a whitespace id really does land the record under the NaN key');

        assert.strictEqual(await post('   '), 409,
          'a second `"   "` collides with it, exactly as GET /animals/%20%20%20 would reach it ' +
          '(was: a MISS, and the NaN-keyed record was silently overwritten)');

        const empty = await post('');
        assert.notStrictEqual(empty, 409,
          '`""` names no id, so it never collides — it must not be coerced to NaN and answer 409 ' +
          'against a record it never named');
        assert.notOk(animalIds().some(key => key === ''),
          'and nothing is ever held under `""`, which is why coercing it would address a foreign slot');
      } finally {
        for (const key of animalIds()) {
          if (!keysBefore.includes(key)) store.remove('animal', key, { _skipAutoPersist: true });
        }
      }
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

      // The 409 half must come from an UNFILTERED caller. Under a per-record
      // filter a client-supplied id is now refused by GATE 0 with a 403, so
      // asking the filtered request for a 409 would silently turn this into a
      // second 403 case and stop pinning the `>= 400` boundary at 409 at all.
      const unfiltered = new OrmRequest({ model: 'animal', access: noFilterAccess });
      const conflict = await dispatch(unfiltered, unfiltered.handlers.post['/'], makeRequest({
        method: 'POST',
        url: '/animals',
        body: { data: { type: 'animal', id: VISIBLE_ID, attributes: { type: 1, age: 1, size: 'small', owner: 'gina' } } },
      }));
      assert.strictEqual(conflict, 409, 'a POST colliding with an existing record is 409');

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

      const before = animalIds();
      const response = await dispatch(ormRequest, ormRequest.handlers.post['/'], makeRequest({
        method: 'POST',
        url: '/animals',
        body: { data: { type: 'animal', attributes: { type: 1, age: 1, size: 'small', owner: 'restricted' } } },
      }));

      assert.strictEqual(response, 403, 'denied create is 403');
      assert.deepEqual(animalIds(), before, 'the record was rolled back out of the store');
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
  // The per-handler guards GATE 1 shadows (assertions 32-33)
  //
  // Deleting `if (isDenied(filter, found)) return 404` from updateHandler and
  // `if (isDenied(filter, record)) return 404` from deleteHandler — separately
  // OR together — left the whole suite at 909/0. That is the `Md`/`Me` finding
  // again: unkillable code in an authorization diff reads as coverage and is
  // not. Deleting them is the WRONG remedy here, because unlike `Md`/`Me` (whose
  // both branches returned the same 404) these are reachable and load-bearing.
  //
  // WHAT MAKES THEM REACHABLE. GATE 1 computes its verdict BEFORE the
  // before-hook loop. `beforeHook` is a published extension point, and a
  // before-hook can change the answer — by mutating the record, or against a
  // predicate closing over per-request state. Between GATE 1 and the handler
  // there is a window in which the filter's verdict can flip from allow to deny,
  // and the handler check is the ONLY re-evaluation after it. Both assertions
  // below drive exactly that window, and both go red if the check is deleted.
  // =========================================================================
  module('per-handler guards behind GATE 1', function(guardHooks) {
    let unsubscribes;

    guardHooks.beforeEach(function() { unsubscribes = []; });
    guardHooks.afterEach(function() { while (unsubscribes.length) unsubscribes.pop()(); });

    // Allows everything until `hide` flips, then denies TARGET. GATE 1 reads it
    // before the hooks run, the handler reads it after.
    function flippingAccess(state, targetId) {
      return () => record => !(state.hide && String(record.id) === String(targetId));
    }

    test('[GUARD] assertion 32 — updateHandler re-checks the filter after the before-hooks, and a denial there still 404s', async function(assert) {
      const state = { hide: false };
      const ormRequest = new OrmRequest({ model: 'animal', access: flippingAccess(state, VISIBLE_ID) });
      unsubscribes.push(beforeHook('update', 'animal', () => { state.hide = true; }));

      const before = store.get('animal', VISIBLE_ID).age;
      const response = await dispatch(ormRequest, ormRequest.handlers.patch['/:id'], makeRequest({
        method: 'PATCH',
        url: `/animals/${VISIBLE_ID}`,
        params: { id: String(VISIBLE_ID) },
        body: { data: { attributes: { age: 999 } } },
      }));

      assert.strictEqual(response, 404,
        'a predicate that turns denying inside the before-hook window still 404s — GATE 1 already passed, ' +
        'so deleting updateHandler\'s own isDenied applies the update instead');
      assert.strictEqual(store.get('animal', VISIBLE_ID).age, before, 'and no attribute was applied');
    });

    test('[GUARD] assertion 33 — deleteHandler re-checks the filter after the before-hooks, and a denial there still 404s', async function(assert) {
      const state = { hide: false };
      const ormRequest = new OrmRequest({ model: 'animal', access: flippingAccess(state, VISIBLE_ID) });
      unsubscribes.push(beforeHook('delete', 'animal', () => { state.hide = true; }));

      const response = await dispatch(ormRequest, ormRequest.handlers.delete['/:id'], makeRequest({
        method: 'DELETE',
        url: `/animals/${VISIBLE_ID}`,
        params: { id: String(VISIBLE_ID) },
      }));

      assert.strictEqual(response, 404, 'the delete is refused at the handler, past GATE 1');
      assert.ok(store.get('animal', VISIBLE_ID),
        'and the record survives — deleting deleteHandler\'s own isDenied destroys it behind a 204');
    });

    test('[GUARD] assertion 34 — the same two requests SUCCEED when the before-hook does not flip the predicate', async function(assert) {
      // Proves 32 and 33 can fail in the opposite direction: they are not green
      // because this harness refuses every write.
      const state = { hide: false };
      const ormRequest = new OrmRequest({ model: 'animal', access: flippingAccess(state, VISIBLE_ID) });
      unsubscribes.push(beforeHook('update', 'animal', () => {}));

      const patched = await dispatch(ormRequest, ormRequest.handlers.patch['/:id'], makeRequest({
        method: 'PATCH',
        url: `/animals/${VISIBLE_ID}`,
        params: { id: String(VISIBLE_ID) },
        body: { data: { attributes: { age: 999 } } },
      }));
      assert.strictEqual(store.get('animal', VISIBLE_ID).age, 999, 'the update applies when nothing flips');
      assert.notStrictEqual(patched, 404, 'and the response is not a 404');

      const deleted = await dispatch(ormRequest, ormRequest.handlers.delete['/:id'], makeRequest({
        method: 'DELETE',
        url: `/animals/${VISIBLE_ID}`,
        params: { id: String(VISIBLE_ID) },
      }));
      assert.strictEqual(deleted, 204, 'and the delete succeeds');
    });
  });

  // =========================================================================
  // auth() failure modes (assertions 35-36)
  // =========================================================================
  module('auth() shape and failure handling', function() {
    test('[DEFECT] assertion 35 — auth() fails CLOSED for every access shape it does not implement', async function(assert) {
      // `AccessMethod` declares `string` legal and lists it FIRST, so
      // `return 'read'` is the natural reading of the type. It fell through
      // `!access`, `Array.isArray` and `typeof === 'function'` and returned
      // undefined — i.e. FULL CRUD, no filter. `return 'read'` GRANTED DELETE.
      // An object or a number did the same.
      const auth = (value, method) => {
        const ormRequest = new OrmRequest({ model: 'animal', access: () => value });
        return ormRequest.auth(makeRequest({ method, url: '/animals/1', params: { id: '1' } }), {});
      };

      assert.strictEqual(auth('read', 'DELETE'), 403,
        "a bare string is ONE permission, not a grant of all four (was: undefined — DELETE allowed)");
      assert.strictEqual(auth('read', 'GET'), undefined, 'and it does grant the permission it names');
      assert.strictEqual(auth('delete', 'DELETE'), undefined, 'for any of the four');

      assert.strictEqual(auth({}, 'DELETE'), 403, 'an object fails closed (was: undefined — DELETE allowed)');
      assert.strictEqual(auth({}, 'GET'), 403, 'on reads too');
      assert.strictEqual(auth(1, 'DELETE'), 403, 'a number fails closed (was: undefined)');

      assert.strictEqual(auth(true, 'DELETE'), undefined, 'and `true` still means full access');
      assert.strictEqual(auth(false, 'GET'), 403, 'and `false` still denies');
    });

    test('[DEFECT] assertion 36 — an access() that THROWS is a denial, not a 500', async function(assert) {
      // `isDenied` was hardened to fail closed; `auth()` was not. The documented
      // sample itself can throw — `request.originalUrl.split(...)` when
      // originalUrl is absent — so this is reachable by following the docs, and
      // an uncaught throw reaches express's default 500 handler.
      const ormRequest = new OrmRequest({ model: 'animal', access: () => { throw new TypeError('boom'); } });

      let thrown = null;
      let status;
      try {
        status = ormRequest.auth(makeRequest({ url: '/animals', params: {} }), {});
      } catch (error) {
        thrown = error;
      }

      assert.strictEqual(thrown, null, 'auth() does not propagate (was: TypeError escaped to express -> 500)');
      assert.strictEqual(status, 403, 'and answers 403');
    });
  });
  // =========================================================================
  // The shipped sample matcher (assertions 37, 38, 46, 47)
  //
  // FIVE fail-open shapes have now been found in one three-line example, each
  // after the previous was fixed. Variants 1 and 2 are pinned by assertion 1;
  // 3, 4 and 5 are below. The matcher no longer reconstructs the request path
  // at all — it reads `request.baseUrl`, the mount express actually matched —
  // so variants 1, 2, 4 and 5 become unconstructible rather than handled, and
  // only the case rule survives.
  //
  // These pin the fixture, which is now the same code the README teaches
  // (assertion 46). See the header of test/sample/access/global-access.ts and
  // abofs/stonyx-orm#202 — reading `baseUrl` is still a stopgap, not a safe
  // contract.
  // =========================================================================
  module('sample matcher fail-open variants', function() {
    test('[DEFECT] assertion 37 — the matcher is case-insensitive, because the ROUTER is', async function(assert) {
      // `RestServer` mounts with a bare `express()`, whose default is
      // `caseSensitive: false`, and express sets `req.baseUrl` to the text it
      // MATCHED — i.e. the caller's case (`/OwNeRs`), not the registered mount.
      // A case-SENSITIVE matcher therefore does not fire, `access()` falls
      // through to `['read','create','update','delete']`, and there is no filter
      // on any surface at once. Measured over a raw socket on the reviewed head:
      //
      //   GET    /owners/angela -> 404      GET    /OwNeRs/angela -> 200, angela in full
      //   GET    /OWNERS        -> all 5    DELETE /ANIMALS/22    -> 204, record destroyed
      //
      // That last one is #190 verbatim, reachable by shifting one character.
      for (const url of ['/OwNeRs/angela', '/OWNERS', '/Owners?filter[age]=30', '/ANIMALS/22', '/Animals']) {
        assert.strictEqual(typeof globalAccess.access(makeRequest({ url })), 'function',
          `${url} still yields a per-record filter (was: an array — full CRUD, no filter at all)`);
      }

      // Over the real handler, not just the matcher: the record stays hidden.
      const ormRequest = new OrmRequest({ model: 'animal', access });
      const response = await dispatch(ormRequest, ormRequest.handlers.delete['/:id'], makeRequest({
        method: 'DELETE',
        url: `/ANIMALS/${HIDDEN_ID}`,
        params: { id: String(HIDDEN_ID) },
      }));
      assert.strictEqual(response, 404, 'DELETE /ANIMALS/:id on a hidden record is 404 (was: 204)');
      assert.ok(store.get('animal', HIDDEN_ID), 'and the record survives (was: DESTROYED)');

      // And it must not have become a match-everything: a sibling collection is
      // still unfiltered, and record ids are NOT lower-cased.
      assert.strictEqual(typeof globalAccess.access(makeRequest({ url: '/owners-archive' })), 'object',
        'a sibling collection is still not matched');
      assert.strictEqual(typeof globalAccess.access(makeRequest({ url: '/xowners' })), 'object',
        'and neither is an unanchored one');
    });

    test('[DEFECT] assertion 38 — the mount comes from express, so ORM_REST_ROUTE needs no derivation at all', async function(assert) {
      // Variant 4 was: under `ORM_REST_ROUTE=/api` every url becomes
      // `/api/owners/...`, a hard-coded `/owners` matches nothing, and the
      // sample enforces NOTHING — environment-specifically, which is worse than
      // failing everywhere. The documented remediation was itself broken:
      // `` `${config.orm.restServer.route}owners` `` evaluates to `/apiowners`,
      // so a reader who followed the correction exactly still failed open and
      // believed they had handled it.
      //
      // `request.baseUrl` IS the configured mount. There is no prefix to build,
      // so neither the hard-coded form nor the `/apiowners` form can be written
      // — and the fixture no longer imports `stonyx/config` at all. This
      // assertion pins that the mounted shape still matches and that the two
      // broken shapes still do not.
      assert.notStrictEqual('/api' + 'owners', '/api/owners',
        "the old remediation expression evaluates to /apiowners, not /api/owners");

      for (const mount of ['/api/owners', '/api/animals', '/API/Owners', '/deeply/nested/api/owners']) {
        assert.strictEqual(typeof globalAccess.access(makeRequest({ url: `${mount}/angela`, mount })), 'function',
          `a model mounted at ${mount} yields a per-record filter (was: an array — no filter)`);
      }

      assert.strictEqual(typeof globalAccess.access(makeRequest({ url: '/apiowners', mount: '/apiowners' })), 'object',
        'and the broken remediation string matches nothing');
      assert.strictEqual(typeof globalAccess.access(makeRequest({ url: '/owners/angela' })), 'function',
        'and the default mount still matches');

      // The fixture must not have reacquired a config dependency: changing the
      // configured route cannot change any verdict, because the matcher never
      // reads it.
      const original = config.orm.restServer.route;
      try {
        config.orm.restServer.route = '/somewhere-else';
        assert.strictEqual(typeof globalAccess.access(makeRequest({ url: '/owners/angela' })), 'function',
          'the verdict does not depend on config.orm.restServer.route');
      } finally {
        config.orm.restServer.route = original;
      }
    });

    test('[DEFECT] assertion 46 — the shipped fixture and the README sample are ONE matcher', async function(assert) {
      // WHY THIS EXISTS. Every `F_*` mutation in the sweep targets
      // test/sample/access/global-access.ts, which `package.json`'s `files`
      // list EXCLUDES from the package. The matcher a consumer copies is the
      // one in README.md, and for four rounds it was independently written and
      // pinned by nothing — which is exactly how variant 5 came to be found in
      // the shipped copy while the tested copy was being mutated eight ways.
      //
      // So the two are now the same code, and this asserts it structurally
      // rather than by review: both `access(request) { ... }` bodies are
      // extracted, comments and blank lines stripped, and compared line for
      // line. Editing one without the other turns this red.
      const { readFile } = await import('node:fs/promises');

      const extract = (source, label) => {
        const start = source.indexOf('  access(request) {');
        assert.ok(start !== -1, `${label} contains an access(request) method`);
        const end = source.indexOf('\n  }', start);
        assert.ok(end !== -1, `${label}'s access(request) method is closed`);

        return source
          .slice(start, end)
          .split('\n')
          .map(line => line.trim())
          .filter(line => line && !line.startsWith('//'));
      };

      const fixtureSource = await readFile(new URL('../sample/access/global-access.ts', import.meta.url), 'utf8');
      const readmeSource = await readFile(new URL('../../README.md', import.meta.url), 'utf8');

      // The README carries exactly one `export default class GlobalAccess`
      // sample; take the fenced block it lives in.
      const blockStart = readmeSource.indexOf('export default class GlobalAccess');
      assert.ok(blockStart !== -1, 'README carries the GlobalAccess sample');
      const readmeBlock = readmeSource.slice(blockStart, readmeSource.indexOf('\n```', blockStart));

      assert.deepEqual(extract(readmeBlock, 'the README sample'), extract(fixtureSource, 'the shipped fixture'),
        'the README sample and the shipped fixture are the same matcher, line for line ' +
        '(was: two independently written copies, and variant 5 lived in the one nothing mutated)');
    });

    test('[DEFECT] assertion 47 — variant 5: an absolute-form request-target cannot walk past the filter, and an unidentifiable request FAILS CLOSED', async function(assert) {
      // VARIANT 5. HTTP/1.1 permits an absolute-form request-target. Express
      // routes on `parseurl(req).pathname`, so the request reaches the handler
      // normally — but `originalUrl` is the RAW target. Measured over a raw
      // socket against the reviewed head:
      //
      //   GET    http://anything.example/owners/angela  -> 200, angela in full
      //   DELETE http://anything.example/animals/22     -> 204, record destroyed
      //   GET    http://anything.example/owners/archived -> walked past `return false`
      //
      // `String(request.originalUrl ?? '').split('?')[0].toLowerCase()` yields
      // `http://anything.example/owners/angela`, which does not start with
      // `/owners`, so `access()` fell through to the full CRUD grant. `baseUrl`
      // is `/owners` either way — express sets it from the pathname it matched.
      const absolute = url => makeRequest({ url, mount: '/owners', path: '/angela' });

      for (const url of [
        'http://anything.example/owners/angela',
        'http://anything.example/OwNeRs/angela',
        'https://localhost:9999/owners/angela?filter[age]=30',
      ]) {
        assert.strictEqual(typeof globalAccess.access(absolute(url)), 'function',
          `${url} still yields a per-record filter (was: an array — full CRUD, no filter at all)`);
      }

      // The hard `return false` deny is reached through the same channel, and
      // it was walked past the same way.
      for (const path of ['/archived', '/ARCHIVED', '/Archived/2024']) {
        assert.strictEqual(
          globalAccess.access(makeRequest({ url: `http://anything.example/owners${path}`, mount: '/owners', path })),
          false, `the outright deny still fires on an absolute-form target at ${path} (was: a full CRUD grant)`);
      }

      // The path half is lower-cased for the same reason the mount half is: the
      // router matched case-insensitively, so a case-SENSITIVE sub-path rule is
      // stricter than the router and can be stepped around.
      assert.strictEqual(globalAccess.access(makeRequest({ url: '/owners/ARCHIVED', mount: '/owners', path: '/ARCHIVED' })),
        false, 'and a case-varied sub-path cannot step around it either');

      // FAIL CLOSED. `?? ''` converted an absent request target into a total
      // grant: the empty string matches no collection, so `access()` fell
      // through to `['read','create','update','delete']`. A guard added to stop
      // a throw traded fail-closed for fail-open. An input the matcher cannot
      // identify DENIES.
      const withBaseUrl = value => {
        const request = makeRequest({ url: '/owners/angela', path: '/angela' });
        request.baseUrl = value;

        return request;
      };

      for (const value of [undefined, null, '', 42, {}]) {
        assert.strictEqual(globalAccess.access(withBaseUrl(value)), false,
          `an absent or non-string baseUrl (${String(value)}) denies (was: full CRUD, no filter)`);
      }

      // Over the real handler: `auth()` turns that `false` into a 403 rather
      // than granting the request.
      const ormRequest = new OrmRequest({ model: 'owner', access });
      assert.strictEqual(ormRequest.auth(withBaseUrl(undefined), {}), 403, 'and auth() answers 403 for it');
    });
  });


  // =========================================================================
  // The authorization snapshot (assertion 48)
  //
  // `state` is the object `auth()` plants the filter in AND the object handed
  // to every before-hook as `context.state`. It is therefore an INPUT to the
  // authorization decision, not only an output channel, and a published
  // extension point can write to it. `_withHooks` snapshots `filter` once,
  // before the hook loop, and hands the handler the snapshot.
  // =========================================================================
  module('the authorization snapshot cannot be written by a hook', function(snapshotHooks) {
    let unsubscribes;

    snapshotHooks.beforeEach(function() { unsubscribes = []; });
    snapshotHooks.afterEach(function() { while (unsubscribes.length) unsubscribes.pop()(); });

    test('[DEFECT] assertion 48 — a before-hook cannot disarm the filter by mutating context.state', async function(assert) {
      // MEASURED on the reviewed head, with the fixture filter in force:
      //
      //   beforeHook('get', 'animal', ctx => { delete ctx.state.filter })
      //     GET /animals/9101 -> 404 became 200, hidden record in full
      //     GET /animals      -> 20 records became 22
      //
      // GATE 1 held, because it reads a `filter` destructured BEFORE the hook
      // loop. The read handlers did not: they re-destructured `filter` from the
      // same live object, after arbitrary consumer code had been handed it.
      // Writes were safe, reads were not, and the difference was invisible
      // because both spellings look identical at the call site.
      const ormRequest = new OrmRequest({ model: 'animal', access });

      // Every way a hook can reach the filter: remove it, replace it with an
      // allow-all, and replace it with a non-function truthy value.
      const sabotage = [
        ['delete', ctx => { delete ctx.state.filter; }],
        ['allow-all', ctx => { ctx.state.filter = () => true; }],
        ['non-function', ctx => { ctx.state.filter = 'read'; }],
      ];

      for (const [label, hook] of sabotage) {
        unsubscribes.push(beforeHook('get', 'animal', hook));
        unsubscribes.push(beforeHook('list', 'animal', hook));
        unsubscribes.push(beforeHook('update', 'animal', hook));
        unsubscribes.push(beforeHook('delete', 'animal', hook));

        const single = await dispatch(ormRequest, ormRequest.handlers.get['/:id'], makeRequest({
          url: `/animals/${HIDDEN_ID}`, params: { id: String(HIDDEN_ID) },
        }));
        assert.strictEqual(single, 404,
          `GET /:id stays 404 when a before-hook ${label}s state.filter (was: 200, the hidden record in full)`);

        const collection = await dispatch(ormRequest, ormRequest.handlers.get['/'], makeRequest({ url: '/animals' }));
        assert.notOk(collection.data.some(record => Number(record.id) === HIDDEN_ID),
          `the collection still omits the hidden record when a before-hook ${label}s state.filter (was: included)`);

        const patched = await dispatch(ormRequest, ormRequest.handlers.patch['/:id'], makeRequest({
          method: 'PATCH',
          url: `/animals/${HIDDEN_ID}`,
          params: { id: String(HIDDEN_ID) },
          body: { data: { attributes: { age: 999 } } },
        }));
        assert.strictEqual(patched, 404, `PATCH stays 404 when a before-hook ${label}s state.filter`);

        const deleted = await dispatch(ormRequest, ormRequest.handlers.delete['/:id'], makeRequest({
          method: 'DELETE', url: `/animals/${HIDDEN_ID}`, params: { id: String(HIDDEN_ID) },
        }));
        assert.strictEqual(deleted, 404, `DELETE stays 404 when a before-hook ${label}s state.filter`);
        assert.ok(store.get('animal', HIDDEN_ID), `and the hidden record survives the ${label} hook`);

        while (unsubscribes.length) unsubscribes.pop()();
      }
    });

    test('[GUARD] assertion 48b — the same requests still SUCCEED for a visible record, and state is still a live channel', async function(assert) {
      // Proves 48 is not green because this harness refuses everything, and
      // that pinning the filter did not sever `context.state` as the output
      // channel @stonyx/rest-server reads `redirect` and `pipe` back off.
      const ormRequest = new OrmRequest({ model: 'animal', access });
      const seen = [];

      unsubscribes.push(beforeHook('get', 'animal', ctx => { ctx.state.marker = 'written-by-before'; }));
      unsubscribes.push(afterHook('get', 'animal', ctx => { seen.push(ctx.state.marker); }));

      const state = {};
      const status = ormRequest.auth(makeRequest({ url: `/animals/${VISIBLE_ID}` }), state);
      assert.strictEqual(status, undefined, 'precondition: the request is authorized');

      const response = await ormRequest.handlers.get['/:id'](makeRequest({
        url: `/animals/${VISIBLE_ID}`, params: { id: String(VISIBLE_ID) },
      }), state);

      assert.strictEqual(Number(response?.data?.id), VISIBLE_ID, 'a visible record still comes back');
      assert.deepEqual(seen, ['written-by-before'],
        'and a before-hook write to context.state is still visible to an after-hook');
      assert.strictEqual(state.marker, 'written-by-before',
        'and lands on the SAME object the dispatcher holds, which is how state.redirect/state.pipe work');
    });
  });

  // =========================================================================
  // The coercion anchor (assertion 45) and the non-string passthrough (49)
  // =========================================================================
  module('coerceId — its anchor and its non-string boundary', function() {
    test('[GUARD] assertion 45 — coerceId is anchored on the model id TRANSFORM, which is radix-less', async function(assert) {
      // `coerceId` uses `parseInt(id)` with no radix. The reason is not that
      // `getId` happens to do the same — it is that `transforms.number` is what
      // produces the store KEY a record is filed under, and it is radix-less
      // too. Adding a radix there (`parseInt(value, 10)`) is a one-word edit in
      // a file with no connection to authorization; it would make the lookup key
      // and the landing key disagree on a hex-shaped id — reopening exactly the
      // divergence assertion 43 closes — while `coerceId`'s comment still read
      // as correct. Nothing pinned it, so this does.
      assert.strictEqual(transforms.number('0x2391'), 9105,
        'transforms.number is radix-less, so a hex-shaped id files the record under 9105 ' +
        '(adding a radix here files it under 0 while the lookup still resolves 9105)');
      assert.strictEqual(transforms.number('1e3'), 1,
        'and it is parseInt, not Number — Number("1e3") is 1000, which would file the record elsewhere again');
      assert.strictEqual(transforms.number('9105.5'), 9105,
        'and it truncates a float, which is the landing half of abofs/stonyx-orm#205');
    });

    test('[DEFECT] assertion 49 — a NON-STRING body id passes through uncoerced', async function(assert) {
      // `normalizeBodyId` returns early for anything that is not a string. That
      // line had no mutation in four rounds and it is load-bearing: without it
      // a float body id runs through `parseInt`, so `{"id":9105.5}` would look
      // the collision up under 9105 and answer 409 against a record it never
      // named — the same false-collision shape as the hex divergence, one type
      // over.
      //
      // It also widens abofs/stonyx-orm#205: "partially numeric" reads as
      // string-only, but `{"id":9105.5}`, `{"id":[9105]}` and `{"id":true}` are
      // the same defect — the LOOKUP correctly passes them through while the
      // model's id transform truncates them into a real key.
      const unfiltered = new OrmRequest({ model: 'animal', access: noFilterAccess });
      const EXISTING = 9105;
      createRecord('animal', { id: EXISTING, type: 1, age: 7, size: 'small', owner: 'gina', traits: [] }, { serialize: false, _skipAutoPersist: true });

      const post = id => dispatch(unfiltered, unfiltered.handlers.post['/'], makeRequest({
        method: 'POST',
        url: '/animals',
        body: { data: { type: 'animal', id, attributes: { type: 1, age: 99, size: 'large', owner: 'gina' } } },
      }));

      const keysBefore = animalIds();
      const response = await post(9105.5);

      assert.notStrictEqual(response, 409,
        'POST {"id":9105.5} is NOT 409 — the float is looked up as itself, not truncated to 9105 ' +
        '(dropping the non-string passthrough makes it a false collision against a record the caller never named)');

      // THE RESIDUAL, pinned rather than described — abofs/stonyx-orm#205 in its
      // widened form. The lookup is right; the model id transform truncates the
      // float anyway, so the write lands on 9105.
      assert.strictEqual(store.get('animal', EXISTING).age, 99,
        'RESIDUAL (abofs/stonyx-orm#205): the id transform truncates 9105.5 to 9105, so the write lands there — ' +
        'pinned so closing #205 turns this red rather than passing silently');

      for (const key of animalIds()) {
        if (!keysBefore.includes(key)) store.remove('animal', key, { _skipAutoPersist: true });
      }
      store.remove('animal', EXISTING, { _skipAutoPersist: true });
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
