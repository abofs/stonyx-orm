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
// src/manage-record.ts:217-219 (`dev` numbering) ALSO scores 951 pass / 0
// fail — identical.
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
// ---------------------------------------------------------------------------
// MUTATION MATRIX — MEASURED, not reasoned. Every row was applied to the fixed
// source, built, and run as:
//
//   ORM_TEST_REST_PORT=42801 node --import tsx/esm --import ./test/setup.ts \
//     node_modules/qunit/bin/qunit.js test/unit/assign-record-id-test.ts test/zz-exit-test.ts
//
// Unmutated: 9 pass / 0 fail. Read this table as the answer to "could this
// assertion have failed?" — every AC here has a production change that turns it
// red, and none of them turns ALL of them red, which is what distinguishes
// coverage from a tripwire.
//
// ALL LINE NUMBERS BELOW ARE POST-MERGE. An earlier revision of this file cited
// `dev` numbering throughout, including inside a shipped assertion MESSAGE, so
// the baseline is stated once here and used everywhere.
//
//   mutation                                                | red              | green
//   ---------------------------------------------------------|------------------|--------
//   A   manage-record.ts:265-345 — revert the WHOLE selection to
//       `at(-1).id + 1`, i.e. `dev`                          | 1,2,3,6,7,8,9    | 4, 5
//   A2  revert only `maxNumericId`, KEEP the walk            | 2,3,8,9          | 1,4,5,6,7
//   B   utils.ts `maxNumericId` -> `Math.max(0, ...ids)`     | 2,3,8,9          | 1,4,5,6,7
//   C   manage-record.ts:383 — occupancy guard on the RAW
//       candidate: `storeMap.has(toCandidate(candidate))`    | 4,8,9            | rest
//   D   manage-record.ts:250-254 — disable the SQL
//       pending-negative early return                        | 5 (5.3, got 9641)| rest
//   E   manage-record.ts:52-56 — blanket duplicate refusal   | 5 (5.2)          | rest
//   F   manage-record.ts:239 — `if (rawData.id) return;`     | 6                | rest
//   G   refuse EVERY server-assigned create                  | 1,2,3,5,6,7,8,9  | 4
//   H   manage-record.ts:346-351 — delete the restart-from-1 | 7                | rest
//   I   manage-record.ts:397 — weaken the bound to
//       `if (++attempts > 0)`                                | 7,8,9            | rest
//   J   manage-record.ts:397 — delete the bound              | 8 **HANGS**      | —
//   K   manage-record.ts:323-325 — bare-number candidate for
//       a string-keyed model (`value => value`)              | 3,8,9            | rest
//   L   manage-record.ts:448-458 — delete the `catch` retry in
//       `storeKeyDeriver`                                    | 4,9              | rest
//   M   orm-request.ts:785-798 — delete the `createRecord`
//       try/catch that answers 409                           | 8 (route)        | rest
//
// EVERY AC HAS AT LEAST ONE KILLING MUTATION, and no mutation kills all nine:
//
//   AC1 <- A, G          AC4 <- C, L          AC7 <- A, G, H, I
//   AC2 <- A, A2, B, G   AC5 <- D, E, G       AC8 <- A, A2, B, C, G, I, K, M
//   AC3 <- A, A2, B, G, K  AC6 <- A, F, G     AC9 <- A, A2, B, C, G, I, K, L
//
// Six rows are worth reading twice:
//
//   A2 vs A. Reverting ONLY the max computation leaves AC1 GREEN — the walk
//   steps past the occupied slot and repairs a wrong max. AC2 is the only
//   assertion that pins the max COMPUTATION itself. A is the full `dev` revert
//   and is what turns AC1 red.
//
//   B is the naive fix. It is caught by AC2 and AC3, and it leaves AC1 green
//   for the same reason A2 does. Before this file existed it scored 951/0.
//
//   B was ALSO mis-recorded here for one review round as turning AC5 red. It
//   does not, and never did: AC5 alone under B is green. Its redness was a
//   CASCADE from AC2's aborted cleanup leaking a `NaN`-keyed record that the old
//   range-based `cleanup()` structurally could not sweep. `cleanup()` is now
//   snapshot-based and every intra-test removal is in a `finally`, which is the
//   actual fix; the row is corrected rather than annotated.
//
//   G leaves AC4 GREEN, and that is by design: AC4 accepts "refused with a
//   defined error" as well as "landed on a free key", because either is an
//   acceptable collision policy and silence is the only unacceptable one. AC5.1
//   is the control that catches refuse-all, which is exactly why it exists.
//
//   I leaves AC4 green too, for the same reason, which is why AC8.1 exists: the
//   bound's THRESHOLD is a separate property from its existence, and AC4 cannot
//   see it.
//
//   J manifests as a HANG, not a red. That is information the next reader needs
//   before applying it: an unbounded walk over a non-injective id transform
//   spins forever inside a synchronous store walk. "No mutation kills this" and
//   "the killing mutation hangs" are different facts and this file states which.
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

// SNAPSHOT-BASED, NOT RANGE-BASED, and the difference produced a wrong row in
// this file's own mutation matrix.
//
// The previous version swept numeric keys in 9600-9699. Several assertions
// deliberately create records OUTSIDE that range — the `NaN` key (AC2), key `0`
// (AC6), a negative pending id (AC5.3) and 2^53 (AC7) — and `NaN >= 9600` is
// `false`, so a range sweep could not reach any of them. When AC2 threw under a
// mutation, its trailing `store.remove` never ran, the `NaN`-keyed record
// survived into AC5, and AC5 went red for a reason that had nothing to do with
// the mutation being measured. A measurement instrument that leaks its own
// fixtures reports cascades as detections.
//
// So: every key this module did not start with is removed, whatever its type,
// wherever it sits. `Set.has` uses SameValueZero, so `NaN` is matched. Records
// present before the module ran are left completely alone.
let animalKeysAtStart: Set<string | number> | undefined;

function cleanup() {
  if (!animalKeysAtStart) return;

  for (const key of animalKeys()) {
    if (!animalKeysAtStart.has(key)) store.remove('animal', key, { _skipAutoPersist: true });
  }
}

// Kept as the FIRST sweep only, before the snapshot is taken, so a record leaked
// into this file's band by an earlier file is not adopted into the baseline and
// then left behind. Everything after that is `cleanup()`'s job.
function sweepBand() {
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

// The `await`-safe form. `withIsolatedOwnerStore` runs its `finally` the moment
// `fn()` RETURNS, which for an async callback is when the promise is created,
// not when it settles — so an async assertion would run against a restored
// store. Two functions rather than one so neither has to be read twice.
async function withIsolatedOwnerStoreAsync(fn) {
  const owners = store.get('owner') as Map<string | number, unknown>;
  const snapshot = new Map(owners);

  owners.clear();

  try {
    return await fn();
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
    animalKeysAtStart = undefined;
    sweepBand();
    animalKeysAtStart = new Set(animalKeys());
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
    //
    // THE SCOPE OF THIS INVARIANT, because an earlier revision of this file
    // stated it without one. "Exceeds every numeric key" holds while `max + 1`
    // is representable, i.e. while `max < 2^53`. Above that `max + 1 === max`
    // and there is no id above the max to assign, so the walk restarts from 1
    // and this assertion would be FALSE. That case is not visible from the
    // 9600-9699 fixture band at all — it is AC7's, and AC7 exists because this
    // assertion could not have caught it.
    assert.ok(maxBefore < Number.MAX_SAFE_INTEGER, 'precondition: max + 1 is representable, so "exceeds every key" is the applicable rule (AC7 covers the other case)');
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
    // falsy guard at manage-record.ts:239, and the model's id transform
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

    // IN A `finally`. When this test threw under a mutation, the trailing
    // `store.remove` did not run and the NaN-keyed record leaked into AC5,
    // which then failed for an unrelated reason and was recorded in the matrix
    // as a detection. `cleanup()` is snapshot-based now and would also catch it;
    // both, because the matrix is read as an instrument.
    try {
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
    } finally {
      store.remove('animal', nanKey, { _skipAutoPersist: true });
    }
  });

  test('[GUARD] AC3 — a no-id create on a string-id model gets an id that is usable ON THE ROUTE', async function(assert) {
    // LABELLED [GUARD] DELIBERATELY, AND THE LABEL IS LOAD-BEARING. This is
    // GREEN on unfixed dev: `assignRecordId` concatenates, so it hands back
    // `'bob1'`, which satisfies every assertion below. It proves NOTHING about
    // #203.
    //
    // What it guards is the defect the FIX introduces — and there turned out to
    // be TWO, one after the other.
    //
    // (1) A naive `Math.max` over mixed ids yields `NaN`, the string transform
    //     (transforms.ts:9 -> `String(value)`) turns it into the literal
    //     `'NaN'`, and a second no-id create then collides with it. Nothing in
    //     the shipped suite catches that — test/unit/create-record-test.ts:13
    //     makes exactly this call and asserts only `record.gender ===
    //     undefined`, which is why the naive fix scored 951/951.
    //
    // (2) A BARE-NUMBER candidate hands a string-id model the id `'1'`, and
    //     that record is CREATED BUT NOT ADDRESSABLE. `coerceId`
    //     (orm-request.ts:322) resolves a numeric-looking string to the NUMBER
    //     `1` on every record-level surface, while the model files it under the
    //     STRING key `'1'`. Measured over the route, store `{'1': owner}`:
    //
    //       GET    /owners/1     -> 404      (the record exists)
    //       DELETE /owners/1     -> 404
    //       GET    /owners/owner-1 -> 200    (non-numeric-looking id)
    //
    //     and `_withHooks` (orm-request.ts:1185) hands an after-`create` hook
    //     `context.record === undefined` for the same reason. `dev` assigned
    //     `'bob1'`, which is not numeric-looking, so `dev` has neither problem.
    //     A bare-number candidate would move abofs/stonyx-orm#209 — which is
    //     REOPENED — from "a caller supplied a numeric-looking id" onto the
    //     DEFAULT path for every server-assigned create on every string-id
    //     model. That is why the assigned value is `<model>-<n>`.
    //
    // KILLING MUTATIONS: (B) `Math.max(0, ...ids)` for `maxNumericId` -> the id
    // becomes `'owner-NaN'` and AC3.2 goes red. (K) `toCandidate` at
    // manage-record.ts:323-325 replaced by `value => value` -> the id becomes
    // `'1'`, AC3.2 goes red and AC3.4's route lookup 404s.
    await withIsolatedOwnerStoreAsync(async () => {
      seedOwner('gina', 30);
      seedOwner('bob', 40);

      const owners = store.get('owner');
      const keysBefore = Array.from(owners.keys());
      const sizeBefore = owners.size;
      const created = createRecord('owner', { gender: 'male', age: 50, pets: [], phoneNumbers: [] }, { serialize: false, _skipAutoPersist: true });

      // AC3.1
      assert.strictEqual(owners.size, sizeBefore + 1, 'the store grew by exactly one');

      // AC3.2 — the assertion mutations B and K both turn red.
      //
      // THE FORMAT IS PINNED, not just the invariant, and that is a deliberate
      // change from the previous revision of this file. `<model>-<n>` is now a
      // documented consumer-facing value (README `### Breaking changes` 8): it
      // has to be non-numeric-looking to stay addressable, and it has to be
      // derived from a NUMBER so that a poisoned max is visible here rather than
      // hidden behind a prefix. An invariant-only assertion accepts
      // `'owner-NaN'`.
      assert.strictEqual(typeof created.id, 'string', 'the assigned id is a string, as the model declares');
      assert.ok(/^owner-[1-9][0-9]*$/.test(created.id),
        `the assigned id is <model>-<n> with n a positive integer (got ${JSON.stringify(created.id)}; a Math.max over mixed ids gives "owner-NaN", a bare-number candidate gives "1")`);
      assert.notOk(keysBefore.includes(created.id), 'and it is not an id the store already held');

      // AC3.3
      assert.strictEqual(store.get('owner', 'gina').age, 30, 'owner gina is unchanged');
      assert.strictEqual(store.get('owner', 'bob').age, 40, 'owner bob is unchanged');

      // AC3.4 — REACHABILITY, at the store tier and at the route tier.
      //
      // The store-tier half is the property the previous revision assumed and
      // did not state (`transform(landingKey) === landingKey`); the route-tier
      // half is the one that was actually broken, because it goes through
      // `coerceId` and the store lookup does not.
      assert.strictEqual(store.get('owner', created.id), created,
        'AC3.4 — the record is reachable under the id it was given (the derived key IS the landing key)');

      const ormRequest = new OrmRequest({ model: 'owner', access: noFilterAccess });
      const response = await dispatch(ormRequest, ormRequest.handlers.get['/:id'], makeRequest({
        url: `/owners/${created.id}`,
        params: { id: String(created.id) },
      }));

      assert.strictEqual(typeof response, 'object',
        'AC3.4 — and GET /owners/<assigned id> answers a resource, not 404 (a numeric-looking string id is filed under the STRING key and addressed under the NUMBER — abofs/stonyx-orm#209)');
      assert.strictEqual(response?.data?.id, created.id, 'AC3.4 — and it is the record that was just created');
    });
  });

  test('[GUARD] AC4 — the occupancy guard is evaluated on the LANDING key', async function(assert) {
    // LABELLED [GUARD], and this is the seam the story exists to keep closed.
    //
    // `createRecord` looks a record up under `rawData.id` (manage-record.ts:50)
    // and WRITES it under `record.id` (:69), after the model's declared id
    // transform has run inside `serialize`. A guard written against the RAW
    // candidate therefore checks a key the record will never occupy, misses an
    // occupied slot and overwrites it — silently, with a 200 and no change in
    // store size. That is abofs/stonyx-orm#205's lookup-key/landing-key
    // divergence reappearing INSIDE #203's own fix. #203 and #205 are sequenced
    // apart deliberately; this assertion is what keeps them apart.
    //
    // KILLING MUTATION (C): `while (storeMap.has(landingKey))` at
    // manage-record.ts:383 -> `while (storeMap.has(toCandidate(candidate)))`.
    // AC4.2 goes red: `OWNER-1` age 12 -> 9, store size unchanged, no error.
    //
    // WHY AC4.1 IS NOT THAT ASSERTION ANY MORE, STATED RATHER THAN LEFT AS AN
    // UNKILLED SURVIVOR. AC4.1 is the scenario this AC was written for — an
    // owner already filed under `'1'`, with `StandaloneDB`'s reduce
    // (src/standalone-db.ts:137-151) transplanted whole, which has no id-type
    // concept and hands back the NUMBER 1 that lands under `'1'`. Measured under
    // that transplant: owner `'1'` age 55 -> 9, size unchanged, HTTP 200. Since
    // a string-keyed candidate is now `<model>-<n>` (#209 — see AC3), a
    // number-derived key can no longer collide with a caller's `'1'` at all, so
    // AC4.1 is GREEN under every mutation in this file's matrix. It is kept as a
    // regression control on the original scenario; AC4.2 is what carries the
    // landing-key property, and it uses a transform whose output actually
    // differs from its input, which is the only shape where raw and landing
    // diverge.
    withIsolatedOwnerStore(() => {
      seedOwner('1', 55);

      const owners = store.get('owner');
      const sizeBefore = owners.size;
      assert.strictEqual(sizeBefore, 1, 'precondition: the owner store holds exactly the key "1"');
      assert.strictEqual(store.get('owner', '1').age, 55, 'precondition: and that record has a known age');

      let refusal;
      let created;
      try {
        created = createRecord('owner', { gender: 'male', age: 9, pets: [], phoneNumbers: [] }, { serialize: false, _skipAutoPersist: true });
      } catch (error) {
        refusal = error;
      }

      // AC4.1 — the original scenario, kept as a control.
      assert.strictEqual(store.get('owner', '1').age, 55,
        'AC4.1 — the pre-existing owner "1" was NOT overwritten (was, under a transplanted StandaloneDB reduce: age 55 -> 9, silently, with a 200)');
      assert.strictEqual(store.get('owner', '1').gender, 'female', 'AC4.1 — and its other attributes are intact too');

      // Either outcome is acceptable; SILENCE is not. This branch also records
      // which policy the fix chose, so a later change of policy is a deliberate
      // edit to this assertion rather than an unnoticed drift.
      if (refusal) {
        assert.strictEqual(owners.size, sizeBefore, 'AC4.1 — REFUSAL POLICY: the create was refused with a defined error and nothing was written');
      } else {
        assert.strictEqual(owners.size, sizeBefore + 1, 'AC4.1 — NEXT-FREE-KEY POLICY: the create landed on a free key and the store grew by exactly one');
        assert.notStrictEqual(created.id, '1', 'AC4.1 — and it did not land on the occupied key');
      }
    });

    // AC4.2 — THE LANDING KEY, with a transform whose output differs from its
    // input. Substituted into `Orm.instance.transforms` (main.ts:70) because
    // that is the one registry BOTH `storeKeyDeriver` and `ModelProperty.value`
    // (model-property.ts:33) read, so the derivation and the actual landing
    // write move together — which is the property under test.
    const originalTransform = Orm.instance.transforms.string;

    try {
      withIsolatedOwnerStore(() => {
        Orm.instance.transforms.string = value => (value as string)?.toUpperCase();
        seedOwner('OWNER-1', 12);

        const owners = store.get('owner');
        const sizeBefore = owners.size;
        assert.strictEqual(sizeBefore, 1, 'precondition: the store holds exactly the LANDING key the first candidate produces');
        assert.notOk(owners.has('owner-1'), 'precondition: and it does NOT hold the RAW candidate, so the two are distinguishable');

        const created = createRecord('owner', { gender: 'male', age: 9, pets: [], phoneNumbers: [] }, { serialize: false, _skipAutoPersist: true });

        assert.strictEqual(store.get('owner', 'OWNER-1').age, 12,
          'AC4.2 — the occupied LANDING key was not overwritten (under a raw-candidate guard: age 12 -> 9, size unchanged, no error)');
        assert.strictEqual(owners.size, sizeBefore + 1, 'AC4.2 — and the create inserted rather than overwrote');
        assert.strictEqual(created.id, 'OWNER-2', 'AC4.2 — on the next free landing key');
      });
    } finally {
      Orm.instance.transforms.string = originalTransform;
    }
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
    // KILLING MUTATION: transplant src/standalone-db.ts:153-157's BLANKET
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
    // `assignRecordId` returns at manage-record.ts:250-254 for a numeric-id
    // model in SQL mode, BEFORE any max is computed, so a pending negative can
    // never reach the max path at all. A test asserting "the max is not
    // perturbed by negatives" would be a check that could not fail.
    //
    // So this pins THE EARLY RETURN ITSELF. The store is seeded with a HIGHER
    // max first, so a positive `maxId + 1` is a distinguishable outcome.
    //
    // KILLING MUTATION: delete or reorder the :250-254 early return — the id
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
      // manage-record.ts:241-244 uses them instead of string pending ids, and
      // it is what the "transforms.number is out of scope" boundary protects.
      assert.strictEqual(store.get('animal', pending.id as number), pending,
        'AC5.3 — and the negative id survives the number transform intact, so the record is reachable under it (manage-record.ts:241-244)');
    } finally {
      // In the `finally`, not after the last assertion: a negative key is
      // outside every band a range sweep could reach, so an assertion that
      // threw used to leak it into later tests. See `cleanup()`.
      const pendingKey = Array.from((store.get('animal') as Map<string | number, unknown>).keys())
        .find(key => typeof key === 'number' && key < 0);

      if (pendingKey !== undefined) store.remove('animal', pendingKey, { _skipAutoPersist: true });
      Orm.instance.sqlDb = originalSqlDb;
    }
  });

  test('[DEFECT] AC6 — an explicit id: 0 is honoured and not reassigned', function(assert) {
    // manage-record.ts:239 guards on FALSINESS, not on presence:
    //
    //     if (rawData.id) return;
    //
    // `0` is a legal value for an `attr('number')` id, so a caller that supplies
    // it gets a DIFFERENT record back — measured on dev, the create landed on a
    // server-assigned id in the 9600 band and key 0 was absent from the store.
    //
    // KILLING MUTATION: restore `if (rawData.id) return;` at :239.
    //
    // THE `''` BOUNDARY, AND WHY IT IS NOT THE ASSERTION IT USED TO BE.
    //
    // `''` must STILL be treated as absent: it is the one string that means "no
    // id", `parseInt('')` is `NaN`, and a record CAN be held under `NaN`. The
    // named mutation is widening the guard to `rawData.id !== undefined`.
    //
    // The previous revision asserted `notStrictEqual(emptyId.id, '')` and a
    // size-grew check, and stated that the widening also turned
    // access-filter-enforcement-test.ts assertion 44 red. BOTH HALVES WERE
    // MEASURED FALSE. Under the widening the id becomes `NaN`, so `NaN !== ''`
    // passes — and on `animal` the number transform means `.id` can never BE the
    // string `''`, so that assertion was structurally incapable of failing for
    // any change to `assignRecordId`. Assertion 44 stayed green too.
    //
    // What the widening ACTUALLY does is land `''` on the store's `NaN` slot and
    // overwrite whatever is there — silently, with the size still growing
    // elsewhere. That is #203's own defect class. So the boundary is asserted
    // against the state it protects: the `NaN` slot SEEDED FIRST, exactly as AC2
    // and assertion 44 construct it. Measured: green on the shipped guard, all
    // three red under the widening, the last reporting `(got NaN)`.
    assert.notOk(store.get('animal').has(0), 'precondition: the animal store does not already hold key 0');

    const created = createRecord('animal', { id: 0, type: 1, age: 8, size: 'small', traits: [] }, { serialize: false, _skipAutoPersist: true });

    try {
      // AC6.1
      assert.strictEqual(store.get('animal', 0), created, 'the record landed under store key 0');
      // AC6.2
      assert.strictEqual(created.id, 0, 'and no other id was assigned to it');
    } finally {
      // `finally`, and key `0` is outside every band a range sweep could reach.
      store.remove('animal', 0, { _skipAutoPersist: true });
    }

    // The `''` boundary, in the same test so it cannot drift away from the guard
    // it constrains.
    createRecord('animal', { id: '   ', type: 1, age: 22, size: 'small', traits: [] }, { serialize: false, _skipAutoPersist: true });
    const nanKey = animalKeys().find(key => typeof key === 'number' && Number.isNaN(key));

    try {
      assert.ok(Number.isNaN(nanKey), 'BOUNDARY precondition: the store holds a record under the key NaN');

      const sizeBeforeEmpty = store.get('animal').size;
      const emptyId = createRecord('animal', { id: '', type: 1, age: 9, size: 'small', traits: [] }, { serialize: false, _skipAutoPersist: true });

      assert.strictEqual(store.get('animal', nanKey).age, 22,
        'BOUNDARY — `""` did NOT land on the NaN slot and overwrite it (it does under `rawData.id !== undefined`)');
      assert.strictEqual(store.get('animal').size, sizeBeforeEmpty + 1,
        'BOUNDARY — and the create inserted rather than overwrote');
      assert.ok(typeof emptyId.id === 'number' && !Number.isNaN(emptyId.id),
        `BOUNDARY — \`""\` still means NO id and still got a real server-assigned one (got ${emptyId.id})`);
    } finally {
      store.remove('animal', nanKey, { _skipAutoPersist: true });
    }
  });

  test('[DEFECT] AC7 — one record at the numeric ceiling does not disable the collection', async function(assert) {
    // THE FLOAT CEILING. `9007199254740992 + 1 === 9007199254740992` in float64,
    // so `maxId + 1` does not exceed `maxId` and `candidate += 1` inside the
    // next-free-key walk is a NO-OP. Measured over the public route against the
    // first revision of this fix, with no access filter needed and no
    // authentication:
    //
    //   POST /traits {"id":9007199254740992}  -> 200
    //   POST /traits (no id)                  -> 500
    //   POST /traits (no id)                  -> 500   ... and every one after,
    //                                                  until that record was
    //                                                  DELETED.
    //   dev, same sequence                    -> 200
    //
    // One unauthenticated request permanently disabled a collection's create
    // route, and it reached even a filter-protected collection: GATE 0
    // (orm-request.ts:706-714) refuses a direct `POST /animals {"id":2^53}`,
    // but the same id lands through `POST /owners` with a `pets` linkage,
    // because has-many.ts:65 calls `createRecord` outside GATE 0
    // (abofs/stonyx-orm#207).
    //
    // #203 traded a silent overwrite for a silent 200; this traded it for a
    // permanent denial of service on writes. The rule the fix now honours: a
    // store containing one adversarial record must not disable its collection.
    //
    // KILLING MUTATION: delete the restart-from-1 block at
    // manage-record.ts:346-351 -> the walk returns NO_FREE_KEY, `assignRecordId`
    // throws, and the route answers 409 instead of a resource. AC7.1 red.
    //
    // WHY AC1 COULD NOT SEE THIS. AC1's "exceeds every numeric key" is false
    // above 2^53, and this file's fixture band is 9600-9699 — 2^53 is
    // structurally outside anything a band could hold. Widening the band was not
    // enough on its own; `cleanup()` had to stop being range-based too.
    const CEILING = Number.MAX_SAFE_INTEGER + 1;
    assert.strictEqual(CEILING + 1, CEILING, 'precondition: float64 has no integer successor at 2^53, so `max + 1` cannot exceed `max`');

    const ormRequest = new OrmRequest({ model: 'animal', access: noFilterAccess });
    const post = body => dispatch(ormRequest, ormRequest.handlers.post['/'], makeRequest({
      method: 'POST',
      url: '/animals',
      body: { data: { type: 'animal', ...body } },
    }));

    const attributes = { type: 1, age: 3, size: 'small' };
    const poison = await post({ id: CEILING, attributes });

    assert.ok(poison?.data, 'precondition: the ceiling record was created over the public route, unauthenticated');
    assert.strictEqual(maxNumericAnimalKey(), CEILING, 'precondition: and it is now the highest numeric key in the store');

    const sizeBefore = store.get('animal').size;
    const first = await post({ attributes: { type: 1, age: 41, size: 'small' } });

    // AC7.1 — a DEFINED, SUCCESSFUL outcome, not a status code.
    assert.strictEqual(typeof first, 'object',
      'AC7.1 — the next no-id create answers a resource, not a status code (was: an uncaught throw -> express default handler -> 500 with a stack)');
    assert.ok(first?.data, 'AC7.1 — and that response carries a created resource');
    assert.strictEqual(store.get('animal').size, sizeBefore + 1, 'AC7.1 — and the store grew by exactly one');
    assert.notStrictEqual(first.data.id, CEILING, 'AC7.1 — on a key that is not the occupied ceiling');
    assert.ok(store.get('animal', first.data.id), 'AC7.1 — and the created record is reachable under the id it was given');

    // AC7.2 — NOT PERMANENT. The failure mode was every subsequent create, not
    // one, so a single success is not evidence.
    const second = await post({ attributes: { type: 1, age: 42, size: 'small' } });

    assert.ok(second?.data, 'AC7.2 — and so does the one after it (the regression was permanent, not transient)');
    assert.notStrictEqual(second.data.id, first.data.id, 'AC7.2 — with a different id again');

    // AC7.3
    assert.strictEqual(store.get('animal', CEILING).age, 3, 'AC7.3 — and the record at the ceiling was not overwritten');
  });

  test('[GUARD] AC8 — the next-free-key walk is BOUNDED, its threshold is exact, and the refusal is a 409', async function(assert) {
    // THREE SEPARATE THINGS, none of which any assertion reached before.
    //
    // The bound exists because a NON-INJECTIVE id transform collapses every
    // candidate onto the same store key, and an unbounded walk then spins
    // forever inside a synchronous store walk and pins a worker. That is a
    // reachable consumer state, not a hypothesis: `transforms.boolean`
    // (transforms.ts:4) is non-injective, and `Orm.instance.transforms`
    // (main.ts:70) is a public MUTABLE instance property, so a consumer can
    // register an arbitrary transform and name it as an id type. This test
    // substitutes into that same registry — which is the registry both
    // `storeKeyDeriver` and `ModelProperty.value` (model-property.ts:33) read,
    // so the substitution reaches the derivation and the landing write
    // identically.
    //
    // KILLING MUTATIONS:
    //   (I) weaken the bound to `if (++attempts > 0)` at manage-record.ts:397
    //       -> AC8.1 red: the walk refuses on the FIRST collision instead of
    //          stepping past it. AC4 does NOT catch this — AC4.2 accepts a
    //          refusal as an acceptable collision policy, by design.
    //   (J) delete the bound entirely -> AC8.2 HANGS rather than failing.
    //   (M) delete the `createRecord` try/catch at orm-request.ts:785-798
    //       -> AC8.3 red: the route rejects instead of answering 409.
    const originalTransform = Orm.instance.transforms.string;

    try {
      // ---- AC8.1: the THRESHOLD. The walk must step PAST an occupied landing
      // key, not refuse at it. `storeMap.size + 1` candidates against at most
      // `storeMap.size` occupied keys is exactly tight.
      withIsolatedOwnerStore(() => {
        seedOwner('owner-1', 55);

        const owners = store.get('owner');
        const sizeBefore = owners.size;
        assert.strictEqual(sizeBefore, 1, 'precondition: the owner store holds exactly the FIRST candidate landing key');

        const created = createRecord('owner', { gender: 'male', age: 9, pets: [], phoneNumbers: [] }, { serialize: false, _skipAutoPersist: true });

        assert.strictEqual(owners.size, sizeBefore + 1, 'AC8.1 — the create walked PAST the occupied first candidate and inserted (a bound of 0 refuses here)');
        assert.strictEqual(created.id, 'owner-2', 'AC8.1 — on the next free key');
        assert.strictEqual(store.get('owner', 'owner-1').age, 55, 'AC8.1 — and the occupied key was not overwritten');
      });

      // ---- AC8.2: the bound EXISTS. Every candidate collapses onto one key.
      withIsolatedOwnerStore(() => {
        Orm.instance.transforms.string = () => 'collapsed';
        seedOwner('collapsed', 55);

        const owners = store.get('owner');

        assert.throws(
          () => createRecord('owner', { gender: 'male', age: 9, pets: [], phoneNumbers: [] }, { serialize: false, _skipAutoPersist: true }),
          /no free id available/,
          'AC8.2 — the walk is bounded and refuses with a defined error rather than hanging the request'
        );
        assert.strictEqual(owners.size, 1, 'AC8.2 — and nothing was written');
        assert.strictEqual(store.get('owner', 'collapsed').age, 55, 'AC8.2 — the existing record is untouched (the throw precedes any store write)');
      });

      // ---- AC8.3: the refusal is a DEFINED ROUTE OUTCOME.
      //
      // `createHandler` had no try/catch, and neither does @stonyx/rest-server's
      // dispatcher (dist/request.js:41-70), so express 5 auto-forwarded the
      // rejection to its default error handler: a 500 carrying the STACK, with
      // absolute install paths and the internal module graph, to an
      // unauthenticated caller outside NODE_ENV=production. That is the hazard
      // orm-request.ts:553-558 names in this same subsystem, and every sibling
      // refusal in that handler returns an integer status. 409 matches the
      // client-duplicate precedent at orm-request.ts:713.
      await withIsolatedOwnerStoreAsync(async () => {
        Orm.instance.transforms.string = () => 'collapsed';
        seedOwner('collapsed', 55);

        const ownerRequest = new OrmRequest({ model: 'owner', access: noFilterAccess });
        const response = await dispatch(ownerRequest, ownerRequest.handlers.post['/'], makeRequest({
          method: 'POST',
          url: '/owners',
          body: { data: { type: 'owner', attributes: { gender: 'female', age: 30 } } },
        }));

        assert.strictEqual(response, 409,
          'AC8.3 — the route answers 409, the sibling refusal status, rather than letting the throw reach express (was: 500 with a full stack trace)');
        assert.strictEqual(store.get('owner').size, 1, 'AC8.3 — and nothing was written');
      });
    } finally {
      Orm.instance.transforms.string = originalTransform;
    }
  });

  test('[GUARD] AC9 — an id transform written for strings is not handed a number', function(assert) {
    // `transforms.uppercase` and `transforms.trim` (transforms.ts:11-12) call a
    // string method on the value directly. On `dev` they only ever saw
    // `lastRecord.id + 1`, which is a STRING when the last id is a string, so a
    // model declaring `id = attr('uppercase')` WORKED.
    //
    // Measured against the first revision of this fix, which fed the transform
    // the numeric candidate:
    //
    //   id = attr('uppercase'), seed 'ABC'   dev: assigns 'ABC1'
    //                                     branch: TypeError:
    //                                             value?.toUpperCase is not a
    //                                             function   -> uncaught -> 500
    //   id = attr('trim'),      seed 'abc'   dev: assigns 'abc1'
    //                                     branch: TypeError: value?.trim ...
    //
    // A legal, registered id type must not regress from working to a 500.
    //
    // NOT COVERED, STATED RATHER THAN IMPLIED: `date` and `timestamp` id models
    // are broken on `dev` and broken here. `transforms.date` returns a NEW
    // object every call and a `Map` keys by identity, so `storeMap.has(landing
    // key)` is always `false` and the occupancy check is VACUOUS for them. The
    // "createRecord:50 and :69 agree by construction" claim holds for idempotent
    // transforms — number, float, string, passthrough, uppercase, trim — and not
    // for those two. Out of scope for #203; recorded so no artifact claims a
    // class is closed that was not enumerated (abofs/stonyx-orm#212 § AC5).
    //
    // KILLING MUTATION: delete the `catch` retry in `storeKeyDeriver` at
    // manage-record.ts:448-458 -> this test goes red with
    // `value?.toUpperCase is not a function`.
    const originalTransform = Orm.instance.transforms.string;

    try {
      withIsolatedOwnerStore(() => {
        Orm.instance.transforms.string = value => (value as string)?.toUpperCase();

        const owners = store.get('owner');
        const created = createRecord('owner', { gender: 'male', age: 12, pets: [], phoneNumbers: [] }, { serialize: false, _skipAutoPersist: true });

        assert.strictEqual(typeof created.id, 'string', 'AC9.1 — the create succeeded (was: TypeError, uncaught, 500)');
        assert.strictEqual(created.id, 'OWNER-1', 'AC9.1 — and the id went through the model\'s declared transform');
        assert.strictEqual(owners.size, 1, 'AC9.2 — the store grew by exactly one');

        // AC9.3 — the DERIVED key is the key the record actually landed under.
        // This is the property `storeKeyDeriver` exists for, and the one AC4
        // tests for the shipped `string` transform; here it is tested for a
        // transform whose output differs from its input, which is where a
        // raw-candidate guard would silently diverge.
        assert.strictEqual(store.get('owner', created.id), created, 'AC9.3 — and the record is reachable under the id it was given');

        // AC9.4 — and the occupancy walk still works through it.
        const second = createRecord('owner', { gender: 'male', age: 13, pets: [], phoneNumbers: [] }, { serialize: false, _skipAutoPersist: true });

        assert.strictEqual(second.id, 'OWNER-2', 'AC9.4 — a second create walks past the occupied transformed key');
        assert.strictEqual(store.get('owner', 'OWNER-1').age, 12, 'AC9.4 — and does not overwrite it');
      });
    } finally {
      Orm.instance.transforms.string = originalTransform;
    }
  });

});
