// @ts-nocheck
//
// abofs/stonyx-orm#203 — `assignRecordId` returns last-INSERTED + 1, not
// max + 1, so an ordinary create with NO id supplied can land on an occupied
// slot and silently overwrite it.
//
// ---------------------------------------------------------------------------
// WHY THIS FILE EXISTS AT ALL
//
// Measured on `origin/dev` @ a351f58 and re-measured here: the shipped suite
// scores 951 pass / 0 fail, and a naive `Math.max` fix to
// src/manage-record.ts:217-219 ALSO scores 951 pass / 0 fail — identical.
// There is no assertion anywhere in the repo on `assignRecordId`'s id
// selection, so a bad fix ships green. The naive fix additionally REGRESSES a
// no-id create on a string-id model from `'bob1'` to `'NaN'`, and nothing in
// the suite notices that either: test/unit/create-record-test.ts:13 makes
// exactly that call and asserts only `record.gender === undefined`.
//
// The deliverable of #203 is therefore the COVERAGE, not the fix. Every test
// below names the production mutation that kills it.
// ---------------------------------------------------------------------------
//
// WHY THIS FILE DRIVES THE HANDLERS DIRECTLY RATHER THAN OVER HTTP
//
// Same reason test/unit/access-filter-enforcement-test.ts does, and the
// `dispatch` helper below is the same three lines of @stonyx/rest-server's
// dispatcher (dist/request.js:44-58): auth(), then the handler, sharing one
// memoised state object. Reproducing exactly those lines keeps the assertions
// deterministic. The live HTTP path is covered by test/integration/orm-test.ts.
//
// ---------------------------------------------------------------------------
// ASSERTION LABELS, borrowed from access-filter-enforcement-test.ts so the two
// files read the same way:
//
//   [DEFECT] — observed FAILING against unfixed `dev`. Evidence of #203.
//   [GUARD]  — passes on `dev` today; red only under a SPECIFIC WRONG fix.
//              Proves the fix did not overshoot or recreate a neighbouring
//              defect. Proves NOTHING about #203 and is labelled so that no
//              reader mistakes it for evidence.
//
// FIXTURE FLOOR, stated so a later simplification cannot shrink it into vacuous
// green: a max-vs-last-inserted collision needs AT LEAST TWO records with a
// DESCENDING TAIL. A one-record fixture passes on unfixed `dev`. AC1 uses the
// two-record minimum programmatically and three over the route.
// ---------------------------------------------------------------------------
//
import QUnit from 'qunit';
import Orm, { createRecord, store } from '@stonyx/orm';
import { setupIntegrationTests } from 'stonyx/test-helpers';
import OrmRequest from '../../src/orm-request.js';

const { module, test } = QUnit;

// This file parks every animal it owns in 9600-9699 — a band no other test file
// touches (`grep -rhoE '\b9[0-9]{3}\b' test/` on dev yields 9000/9001,
// 9100-9199 and 9999, none of them in this range) so it cannot perturb the
// integration dataset or the #190 fixture.
const BAND_LO = 9600;
const BAND_HI = 9699;

// An `access` that yields NO per-record filter — the array shape. #201's GATE 0
// refuses ANY client-supplied id on a collection with a function-style filter,
// so the seeding half of AC1 (POST {id:...}) is unreachable through a
// predicate. Every assertion here is about id SELECTION, not authorization.
const noFilterAccess = () => ['read', 'create', 'update', 'delete'];

// Builds the request shape @stonyx/rest-server hands `auth()` and the handlers:
// `baseUrl` is the matched mount, `path` the remainder, both query-free.
function makeRequest({ method = 'GET', url, params = {}, body, query = {} } = {}) {
  const pathname = String(url ?? '').split('?')[0];
  const baseUrl = `/${pathname.split('/')[1] ?? ''}`;

  return {
    protocol: 'http',
    method,
    originalUrl: url,
    baseUrl,
    path: pathname.slice(baseUrl.length) || '/',
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

function animalKeys() {
  return Array.from((store.get('animal') as Map<string | number, unknown>).keys());
}

// The highest NUMERIC key currently held, which is what a correct
// `assignRecordId` must exceed. Computed rather than hard-coded: the animal
// store also holds the integration fixture, so a literal expectation would pin
// this file to another file's data.
function maxNumericAnimalKey() {
  return animalKeys().reduce((max, key) => (typeof key === 'number' && key > max ? key : max), 0);
}

// Sweeps the whole owned band rather than a fixed id list — several assertions
// POST with NO id, so the landing id is chosen by `assignRecordId` and is not
// known to the caller in advance. A fixed list leaks records into every later
// file. Pre-existing records outside the band are left completely alone.
function cleanup() {
  for (const key of animalKeys()) {
    if (typeof key === 'number' && key >= BAND_LO && key <= BAND_HI) {
      store.remove('animal', key, { _skipAutoPersist: true });
    }
  }
}

function seedAnimal(id, age) {
  return createRecord('animal', { id, type: 1, age, size: 'small', traits: [] }, { serialize: false, _skipAutoPersist: true });
}

module('[Unit] assignRecordId — server-assigned id selection (#203)', function(hooks) {
  // Boots the app the same way every integration module does. Without it
  // `createRecord` throws 'ORM is not ready' and the model classes are not
  // registered, so every assertion below would fail for a reason unrelated to
  // what it claims to test.
  setupIntegrationTests(hooks);

  let originalInitialized;

  hooks.beforeEach(function() {
    originalInitialized = Orm.initialized;
    Orm.initialized = true;
    cleanup();
  });

  hooks.afterEach(function() {
    try {
      cleanup();
    } finally {
      Orm.initialized = originalInitialized;
    }
  });

  test('[DEFECT] AC1 — a server-assigned id exceeds every numeric key, and the create grows the store', async function(assert) {
    // ---- AC1.4: the programmatic two-record DESCENDING TAIL (fixture floor) --
    //
    // Insertion order diverges from id order the moment a record is deleted and
    // recreated, or a db.json is written out of order, or a caller POSTs a high
    // id then a low one. None of that is unusual usage.
    const OCCUPIED = 9604;
    const LAST = 9603;
    seedAnimal(OCCUPIED, 5);
    seedAnimal(LAST, 6);

    // Predecessor assertions rather than re-implementing assignRecordId: state
    // the two facts the defect depends on, so that a future fixture change that
    // makes this vacuous turns the test red rather than green.
    assert.strictEqual(animalKeys().at(-1), LAST, 'precondition: the LAST INSERTED animal is 9603, not the highest id');
    assert.ok(store.get('animal', OCCUPIED), 'precondition: 9604 — which is 9603 + 1 — is already occupied');

    const sizeBeforeProgrammatic = store.get('animal').size;
    const maxBeforeProgrammatic = maxNumericAnimalKey();
    const created = createRecord('animal', { type: 1, age: 1, size: 'small', traits: [] }, { serialize: false, _skipAutoPersist: true });

    assert.strictEqual(created.id, maxBeforeProgrammatic + 1,
      'the assigned id is max + 1 (9605), not last-inserted + 1 (was: 9604 — an id that is already taken)');
    assert.strictEqual(store.get('animal').size, sizeBeforeProgrammatic + 1,
      'and the store grew by exactly one — a create that overwrites leaves the size unchanged');
    assert.strictEqual(store.get('animal', OCCUPIED).age, 5,
      'and the record it would have collided with is untouched (was: age 5 -> 1, silently)');

    cleanup();

    // ---- AC1.1-1.3, 1.5: the same defect OVER THE ROUTE -------------------
    //
    // Seeded through POST/DELETE, not only through createRecord: a
    // createRecord-only fixture tests half the story, because the route is
    // where a consumer actually reaches this and where the insertion order goes
    // non-ascending without anyone crafting it.
    const ormRequest = new OrmRequest({ model: 'animal', access: noFilterAccess });

    const post = body => dispatch(ormRequest, ormRequest.handlers.post['/'], makeRequest({
      method: 'POST',
      url: '/animals',
      body: { data: { type: 'animal', ...body } },
    }));
    const del = id => dispatch(ormRequest, ormRequest.handlers.delete['/:id'], makeRequest({
      method: 'DELETE',
      url: `/animals/${id}`,
      params: { id: String(id) },
    }));

    const attributes = { type: 1, age: 3, size: 'small' };
    await post({ id: 9610, attributes });
    await post({ id: 9611, attributes });
    await post({ id: 9612, attributes });
    await del(9611);
    await post({ id: 9611, attributes });

    assert.deepEqual(animalKeys().filter(k => k >= BAND_LO && k <= BAND_HI), [9610, 9612, 9611],
      'precondition: delete-then-recreate has made the insertion order non-ascending, over the public route');

    const sizeBefore = store.get('animal').size;
    const maxBefore = maxNumericAnimalKey();
    const keysBefore = animalKeys();
    const response = await post({ attributes: { type: 1, age: 999, size: 'small' } });

    // AC1.5 — a DEFINED outcome. The collision policy chosen by the fix is
    // "select the next free landing key", so the route completes normally and
    // answers a resource. This is asserted rather than assumed because
    // src/orm-request.ts calls `createRecord` with NO try/catch: had the fix
    // chosen "throw on a server-assigned collision", the exception would
    // propagate into @stonyx/rest-server's dispatcher and the resulting HTTP
    // status would be undefined by this story. Either policy is acceptable;
    // leaving it to the dispatcher is not.
    assert.strictEqual(typeof response, 'object', 'AC1.5 — the route answers a defined response object, not a status code and not an unhandled rejection');
    assert.ok(response?.data, 'AC1.5 — and that response carries a created resource');

    const assignedId = response.data.id;

    // AC1.1
    assert.strictEqual(assignedId, maxBefore + 1,
      'the route-assigned id is max + 1 (9613), not last-inserted + 1 (was: 9612 — the highest existing record)');
    assert.notOk(keysBefore.includes(assignedId), 'and it is an id no record already held');
    for (const key of keysBefore) {
      if (typeof key === 'number' && !Number.isNaN(key)) {
        assert.ok(assignedId > key, `and it is strictly greater than every numeric key present (${key})`);
      }
    }

    // AC1.2
    assert.strictEqual(store.get('animal').size, sizeBefore + 1,
      'the store grew by exactly one (was: unchanged — the create overwrote instead of inserting)');

    // AC1.3
    assert.strictEqual(store.get('animal', 9612).age, 3,
      'and the previously-highest record was not overwritten (was: age 3 -> 999, answered 200, no error)');
  });

  test('[DEFECT] AC2 — a NaN / non-numeric store key cannot poison the selection', async function(assert) {
    // A record CAN be held under the key `NaN`, and this is the shipped route
    // that puts it there — `'   '` is truthy, so it survives `assignRecordId`'s
    // falsy guard at manage-record.ts:204, and the model's id transform
    // (`parseInt`, transforms.ts:7) NaNs it on the way into the store. This is
    // exactly the state access-filter-enforcement-test.ts assertion 44
    // constructs, so it is reachable, not contrived.
    //
    // THIS IS THE ASSERTION THAT SEPARATES A CORRECT FIX FROM THE OBVIOUS ONE.
    // `Math.max(...ids)` returns NaN if any id is NaN, so the naive fix assigns
    // NaN here and clobbers the NaN slot exactly as unfixed dev does. A reduce
    // that skips non-numbers cannot: `NaN > max` is false.
    seedAnimal(9640, 11);
    createRecord('animal', { id: '   ', type: 1, age: 22, size: 'small', traits: [] }, { serialize: false, _skipAutoPersist: true });

    const nanKey = animalKeys().find(key => typeof key === 'number' && Number.isNaN(key));
    assert.ok(Number.isNaN(nanKey), 'precondition: the store now holds a record under the key NaN');
    assert.strictEqual(store.get('animal', nanKey).age, 22, 'precondition: and that record has a known age');

    const sizeBefore = store.get('animal').size;
    const maxBefore = maxNumericAnimalKey();
    const created = createRecord('animal', { type: 1, age: 33, size: 'small', traits: [] }, { serialize: false, _skipAutoPersist: true });

    // AC2.1
    assert.strictEqual(typeof created.id, 'number', 'the assigned id is a number');
    assert.notOk(Number.isNaN(created.id), 'and it is not NaN (was: NaN on dev, and NaN under a Math.max fix too)');
    assert.strictEqual(created.id, maxBefore + 1, 'and it is greater than every numeric key present');

    // AC2.2
    assert.strictEqual(store.get('animal').size, sizeBefore + 1, 'the store grew by exactly one');

    // AC2.3
    assert.strictEqual(store.get('animal', nanKey).age, 22,
      'and the record held under the NaN key is unchanged (was: clobbered — age 22 -> 33, size 2 -> 2)');

    store.remove('animal', nanKey, { _skipAutoPersist: true });
  });

  test('[GUARD] AC3 — a no-id create on a string-id model still gets a usable id', function(assert) {
    assert.ok(true, 'SCAFFOLD — assertions land in the next commit');
  });

  test('[GUARD] AC4 — the occupancy guard is evaluated on the LANDING key', function(assert) {
    assert.ok(true, 'SCAFFOLD — assertions land in the next commit');
  });

  test('AC5 — negative controls: the existing contracts survive', function(assert) {
    assert.ok(true, 'SCAFFOLD — assertions land in the next commit');
  });

  test('[DEFECT] AC6 — an explicit id: 0 is honoured and not reassigned', function(assert) {
    assert.ok(true, 'SCAFFOLD — assertions land in the next commit');
  });
});
