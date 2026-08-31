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

// `owner` is the shipped STRING-id model (`id = attr('string')`,
// test/sample/models/owner.ts) and is the only one in the fixture, so AC3 and
// AC4 have to use it. They also have to control its contents exactly: AC4's
// whole point is that the store holds the LANDING key and nothing else, and the
// integration fixture seeds real owners into the same map.
//
// Snapshot-clear-restore rather than `store.get('owner')?.clear()` (which is
// what test/unit/create-record-test.ts does, destructively): every owner this
// file did not create is put back byte-for-byte in a `finally`, so an assertion
// that throws cannot leak an emptied owner store into every later file.
function withIsolatedOwnerStore(fn) {
  const owners = store.get('owner') as Map<string | number, unknown>;
  const snapshot = new Map(owners);

  owners.clear();

  try {
    return fn();
  } finally {
    owners.clear();
    for (const [key, value] of snapshot) owners.set(key, value);
  }
}

function seedOwner(id, age) {
  return createRecord('owner', { id, gender: 'female', age, pets: [], phoneNumbers: [] }, { serialize: false, _skipAutoPersist: true });
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
    // LABELLED [GUARD] DELIBERATELY, AND THE LABEL IS LOAD-BEARING. This is
    // GREEN on unfixed dev: `assignRecordId` concatenates, so it hands back
    // `'bob1'`, which satisfies every assertion below. It proves NOTHING about
    // #203.
    //
    // What it guards is the defect the FIX introduces. Measured: a naive
    // `Math.max` over mixed ids yields `NaN`, the string transform
    // (transforms.ts:7 -> `String(value)`) turns it into the literal `'NaN'`,
    // and a second no-id create then collides with it. Nothing in the shipped
    // suite catches that — test/unit/create-record-test.ts:13 makes exactly
    // this call and asserts only `record.gender === undefined`, which is why
    // the naive fix scored 951/951.
    //
    // The AC pins the INVARIANT, not the value: `'bob1'` and `'1'` both pass,
    // `'NaN'` does not. Consumers relying on the old concatenated value are
    // called out in the PR body — no shipped test pins it.
    withIsolatedOwnerStore(() => {
      seedOwner('gina', 30);
      seedOwner('bob', 40);

      const owners = store.get('owner');
      const keysBefore = Array.from(owners.keys());
      const sizeBefore = owners.size;
      const created = createRecord('owner', { gender: 'male', age: 50, pets: [], phoneNumbers: [] }, { serialize: false, _skipAutoPersist: true });

      // AC3.1
      assert.strictEqual(owners.size, sizeBefore + 1, 'the store grew by exactly one');

      // AC3.2 — the assertion a Math.max fix turns red.
      assert.strictEqual(typeof created.id, 'string', 'the assigned id is a string, as the model declares');
      assert.notStrictEqual(created.id, '', 'and it is not empty');
      assert.notStrictEqual(created.id, 'NaN',
        'and it is not the literal "NaN" (a Math.max over mixed ids yields NaN, which String() renders as "NaN")');
      assert.notOk(keysBefore.includes(created.id), 'and it is not an id the store already held');

      // AC3.3
      assert.strictEqual(store.get('owner', 'gina').age, 30, 'owner gina is unchanged');
      assert.strictEqual(store.get('owner', 'bob').age, 40, 'owner bob is unchanged');
    });
  });

  test('[GUARD] AC4 — the occupancy guard is evaluated on the LANDING key', function(assert) {
    // LABELLED [GUARD], and this is the seam the story exists to keep closed.
    //
    // GREEN on unfixed dev by coincidence: `'1' + 1` is `'11'`, which happens
    // to miss. It is red under a fix that computes the max correctly but writes
    // its occupancy guard against the RAW assigned value:
    //
    //     if (storeMap.has(rawData.id)) ...        // checks the NUMBER 1
    //     ...                                      // record lands under '1'
    //
    // `StandaloneDB` (src/standalone-db.ts:130-146) is the working reference
    // for max selection and NaN-safety, but it has no model or id-type concept
    // at all, so its reduce maps every string id to 0 and its `maxId + 1` is
    // the NUMBER 1 — which on a string-id model lands under the STRING key
    // '1'. Transplanting it whole reproduces exactly this.
    //
    // Measured under that raw-value guard: owner '1' age 55 -> 9, store size
    // unchanged, HTTP 200, no error. That is #205's lookup-key / landing-key
    // divergence reappearing INSIDE #203's own fix. #203 and #205 are sequenced
    // apart deliberately; this assertion is what keeps them apart.
    withIsolatedOwnerStore(() => {
      seedOwner('1', 55);

      const owners = store.get('owner');
      const sizeBefore = owners.size;
      assert.strictEqual(sizeBefore, 1, 'precondition: the owner store holds exactly the landing key "1"');
      assert.strictEqual(store.get('owner', '1').age, 55, 'precondition: and that record has a known age');

      let refusal;
      let created;
      try {
        created = createRecord('owner', { gender: 'male', age: 9, pets: [], phoneNumbers: [] }, { serialize: false, _skipAutoPersist: true });
      } catch (error) {
        refusal = error;
      }

      // AC4.1 — the assertion that fails silently under a raw-value guard.
      assert.strictEqual(store.get('owner', '1').age, 55,
        'the pre-existing owner "1" was NOT overwritten (was, under a raw-value guard: age 55 -> 9, silently, with a 200)');
      assert.strictEqual(store.get('owner', '1').gender, 'female', 'and its other attributes are intact too');

      // AC4.2 — either outcome is acceptable; SILENCE is not. This branch also
      // records which policy the fix chose, so a later change of policy is a
      // deliberate edit to this assertion rather than an unnoticed drift.
      if (refusal) {
        assert.strictEqual(owners.size, sizeBefore, 'REFUSAL POLICY: the create was refused with a defined error and nothing was written');
      } else {
        assert.strictEqual(owners.size, sizeBefore + 1, 'NEXT-FREE-KEY POLICY: the create landed on a free key and the store grew by exactly one');
        assert.notStrictEqual(created.id, '1', 'and it did not land on the occupied key');
      }
    });
  });

  test('AC5 — negative controls: the existing contracts survive', function(assert) {
    // -- AC5.1: a legitimate create still gets a fresh id AND grows the store.
    //
    // Without this the whole story is satisfiable by refusing every
    // server-assigned create and creating nothing. Passes on dev, passes under
    // a naive max, RED under a refuse-all fix.
    const ASC_LOW = 9620;
    const ASC_HIGH = 9621;
    seedAnimal(ASC_LOW, 1);
    seedAnimal(ASC_HIGH, 2);

    const ascSizeBefore = store.get('animal').size;
    const ascMaxBefore = maxNumericAnimalKey();
    const fresh = createRecord('animal', { type: 1, age: 3, size: 'small', traits: [] }, { serialize: false, _skipAutoPersist: true });

    assert.strictEqual(fresh.id, ascMaxBefore + 1, 'AC5.1 — an ASCENDING store still yields max + 1 (9622)');
    assert.strictEqual(store.get('animal').size, ascSizeBefore + 1, 'AC5.1 — and the store grew by exactly one');
    cleanup();

    // -- AC5.2: a CLIENT-SUPPLIED duplicate still performs last-entry-wins.
    //
    // KILLING MUTATION: transplant src/standalone-db.ts:143-146's BLANKET
    // duplicate refusal into createRecord:52-55. It is the right shape for
    // StandaloneDB and the wrong shape here — `createRecord` deliberately
    // updates on a client-supplied duplicate, and
    // test/unit/create-record-test.ts:24-34 pins that contract. Any duplicate
    // refusal this fix adds must be scoped to SERVER-ASSIGNED ids only; this
    // assertion and that file both go red otherwise.
    const DUP = 9630;
    const first = seedAnimal(DUP, 1);
    const dupSizeBefore = store.get('animal').size;
    const second = createRecord('animal', { id: DUP, type: 1, age: 77, size: 'small', traits: [] }, { serialize: false, _skipAutoPersist: true });

    assert.strictEqual(first, second, 'AC5.2 — a client-supplied duplicate returns the SAME record object');
    assert.strictEqual(second.age, 77, 'AC5.2 — and its attributes were updated to the latest values');
    assert.strictEqual(store.get('animal').size, dupSizeBefore, 'AC5.2 — and no second store entry was created');
    cleanup();

    // -- AC5.3: SQL-mode pending negatives, pinned NON-VACUOUSLY.
    //
    // As the criterion was originally written it could not fail:
    // `assignRecordId` returns at manage-record.ts:209-213 for a numeric-id
    // model in SQL mode, BEFORE any max is computed, so a pending negative can
    // never reach the max path at all. A test asserting "the max is not
    // perturbed by negatives" would be a check that could not fail.
    //
    // So this pins THE EARLY RETURN ITSELF. The store is seeded with a HIGHER
    // max first, so a positive `maxId + 1` is a distinguishable outcome.
    //
    // KILLING MUTATION: delete or reorder the :209-213 early return — the id
    // becomes maxId + 1 (9641), positive, and both assertions go red.
    seedAnimal(9640, 1);

    const originalSqlDb = Orm.instance.sqlDb;
    try {
      Orm.instance.sqlDb = { persist: () => Promise.resolve() };

      const rawData = { type: 1, age: 1, size: 'small', traits: [] };
      const pending = createRecord('animal', rawData, { serialize: false, _skipAutoPersist: true });

      assert.ok((pending.id as number) < 0,
        `AC5.3 — in SQL mode a numeric-id model gets a NEGATIVE pending id, deferring to AUTO_INCREMENT (got ${pending.id})`);
      assert.strictEqual(rawData.__pendingSqlId, true, 'AC5.3 — and it is flagged __pendingSqlId for the adapter');

      // Negative ids must survive the number transform — that is exactly why
      // manage-record.ts:206-208 uses them instead of string pending ids, and
      // it is what the "transforms.number is out of scope" boundary protects.
      assert.strictEqual(store.get('animal', pending.id as number), pending,
        'AC5.3 — and the negative id survives the number transform intact, so the record is reachable under it (manage-record.ts:206-208)');

      store.remove('animal', pending.id as number, { _skipAutoPersist: true });
    } finally {
      Orm.instance.sqlDb = originalSqlDb;
    }
  });

  test('[DEFECT] AC6 — an explicit id: 0 is honoured and not reassigned', function(assert) {
    // manage-record.ts:204 guards on FALSINESS, not on presence:
    //
    //     if (rawData.id) return;
    //
    // `0` is a legal value for an `attr('number')` id, so a caller that supplies
    // it gets a DIFFERENT record back — measured on dev, the create landed on a
    // server-assigned id in the 9600 band and key 0 was absent from the store.
    //
    // KILLING MUTATION: restore `if (rawData.id) return;` at :204.
    //
    // BOUNDARY, and it is not incidental: `''` must STILL be treated as absent.
    // access-filter-enforcement-test.ts assertion 44 pins `''` as the only
    // string that means "no id" — coercing it instead gives `parseInt('')` =
    // NaN, and a record CAN be held under NaN, so `POST {"id":""}` would answer
    // 409 against a record it never named. Widening this guard to plain
    // presence (`!== undefined`) breaks that. Asserted below so the boundary is
    // pinned here rather than only in another file.
    assert.notOk(store.get('animal').has(0), 'precondition: the animal store does not already hold key 0');

    const created = createRecord('animal', { id: 0, type: 1, age: 8, size: 'small', traits: [] }, { serialize: false, _skipAutoPersist: true });

    // AC6.1
    assert.strictEqual(store.get('animal', 0), created, 'the record landed under store key 0');
    // AC6.2
    assert.strictEqual(created.id, 0, 'and no other id was assigned to it');

    store.remove('animal', 0, { _skipAutoPersist: true });

    // The `''` boundary, in the same test so it cannot drift away from the guard
    // it constrains.
    const sizeBeforeEmpty = store.get('animal').size;
    const emptyId = createRecord('animal', { id: '', type: 1, age: 9, size: 'small', traits: [] }, { serialize: false, _skipAutoPersist: true });

    assert.notStrictEqual(emptyId.id, '', 'BOUNDARY — `""` still means NO id and is still server-assigned (assertion 44 depends on this)');
    assert.strictEqual(store.get('animal').size, sizeBeforeEmpty + 1, 'BOUNDARY — and that create inserted rather than overwrote');
  });
});
