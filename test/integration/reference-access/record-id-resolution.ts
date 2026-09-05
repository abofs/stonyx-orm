// @ts-nocheck
/**
 * The id the ORM ACTUALLY resolves the record with — abofs/stonyx-orm#270.
 *
 *   AC-2  For every spelling in the alias corpus, the value handed to
 *         store.find / store.get / store.remove deep-equals
 *         normalizeRecordId(rawSpelling).
 *
 *         Observed FROM THE RESOLUTION PATH, with a sinon spy on the store
 *         singleton the running server uses, during a live request driven over
 *         a raw socket. Not by calling the normaliser twice: comparing f(x) to
 *         f(x) agrees with every implementation and is the vacuous form the
 *         refinement rejects by name. What this compares is "the key the
 *         framework looked the record up by" against "the value the exported
 *         function returns", which is exactly the equivalence #270 is about,
 *         and it is the assertion that dies when a second, private normaliser
 *         reappears at the resolution site.
 *
 *   AC-3  request.recordId is what the predicate sees, it equals
 *         normalizeRecordId(request.params.id), and request.params is NOT
 *         mutated. Observed through the public hook API (docs/hooks.md), which
 *         hands the hook the same request object access() was called with, so
 *         nothing here reaches into module internals.
 *
 * Why this process. The main glob shares one store with every other module in
 * it, so seeding or destroying records there makes other suites' assertions
 * vacuous. This harness has its own port, its own db file and a dataset that is
 * already seeded, and it boots the REFERENCE access sample — the file a
 * contributor reads to learn the pattern. It is also untouched by
 * abofs/stonyx-orm#271, which relocates readme-sample-test.ts.
 *
 * Filename note: does NOT end in `-test.ts`, so the main suite's glob
 * (test/**\/*-test.ts) cannot pull it into the shared process, where
 * paths.access points somewhere else entirely.
 */
import QUnit from 'qunit';
import sinon from 'sinon';
import { createRecord, store, beforeHook, clearAllHooks, normalizeRecordId } from '@stonyx/orm';
import { setupIntegrationTests } from 'stonyx/test-helpers';
import config from 'stonyx/config';
import { raw, serialized } from '../../sample/payload.js';
import { rawRequest, jsonBody } from '../../helpers/raw-http.js';

const { module, test } = QUnit;

/**
 * An animal the reference sample grants full CRUD on. The corpus MUST address
 * a permitted record: a denied request never reaches the resolution path, so a
 * corpus built on the protected record would measure the guard instead of the
 * lookup, and would stay green under a divergent normaliser.
 */
const ALLOWED_ANIMAL = 8;

/** An owner the reference sample grants full CRUD on. */
const ALLOWED_OWNER = 'michael';

/**
 * [ wire target, the decoded params.id Express produces, the id the ORM must
 *   resolve by ].
 *
 * The decoded column is written out rather than computed: the wire spelling and
 * `params.id` differ (percent-decoding), and deriving one from the other in the
 * test would hide a decoding change instead of measuring one.
 *
 * WHAT THIS FILE DOES NOT ASSERT, AND WHY. It pins EQUIVALENCE — "the key the
 * lookup used is the value the exported function returns" — and it pins
 * OUTCOMES. It deliberately does NOT pin the normaliser's meaning to literal
 * values; test/unit/normalize-record-id-test.ts owns that.
 *
 * The split is load-bearing, not tidiness. The property #270 buys is that a
 * PERMISSIVE change to the shared normaliser is harmless: both sides move
 * together, the predicate still refuses, the record survives, and these suites
 * stay green. A literal pin here would red on exactly that change and would
 * therefore vote against the property the issue exists to establish. A change
 * of MEANING must still be caught — it is, in the unit tier, where it is a
 * deliberate reviewed edit rather than a security regression.
 */
const NUMERIC_CORPUS = [
  [`/animals/${ALLOWED_ANIMAL}`, '8', 'the exact spelling'],
  ['/animals/008', '008', 'leading zeroes'],
  ['/animals/8.0', '8.0', 'trailing decimal'],
  ['/animals/8.9', '8.9', 'fractional — parseInt truncates'],
  ['/animals/8e0', '8e0', 'exponent notation'],
  ['/animals/0x8', '0x8', 'hex — parseInt has NO radix, so 0x8 is 8 and not 0'],
  ['/animals/%208', ' 8', 'percent-encoded leading space'],
  ['/animals/%2B8', '+8', 'percent-encoded plus sign'],
  ['/animals/%098', '\t8', 'percent-encoded tab'],
  ['/animals/8%0A', '8\n', 'percent-encoded trailing newline'],
  ['/animals/+8', '+8', 'a bare, unencoded + in the request target'],
];

const STRING_CORPUS = [
  [`/owners/${ALLOWED_OWNER}`, 'michael', 'the exact spelling'],
  ['/owners/MICHAEL', 'MICHAEL', 'upper case — whatever the shared normaliser returns, the lookup must have used it'],
  ['/owners/8michael', '8michael', 'a numeric prefix does not make it numeric'],
];

/**
 * A coverage FLOOR on the two corpora above, in the same shape as
 * PROBED_TARGET_COUNTS in test/integration/readme-sample-test.ts.
 *
 * Both corpora drive their assertions from a `for ... of` loop, so a deleted row
 * deletes its own test. Nothing counted the rows, so the loss was invisible.
 * Measured at this head, deleting five NUMERIC_CORPUS rows and one
 * STRING_CORPUS row: this process went from 30 pass / 0 fail to 24 pass / 0
 * fail, rc=0 — six alias spellings stopped being measured and no assertion
 * moved.
 *
 * STRING_CORPUS is pinned too, not just the corpus the review named. Pinning
 * one of two harnesses with the same gap is the defect this pin exists to fix,
 * one harness over.
 *
 * A floor, not an equality: adding a spelling should never need this line
 * touched. Deleting one should. If a row goes on purpose, lower the number in
 * the same commit and the diff says what coverage was given up.
 */
const NUMERIC_CORPUS_FLOOR = 11;
const STRING_CORPUS_FLOOR = 3;

let port;

/** Every id the store was asked to resolve for `model` since the last reset. */
function resolvedIds(spies, model) {
  const ids = [];

  for (const spy of Object.values(spies)) {
    for (const call of spy.getCalls()) {
      if (call.args[0] !== model) continue;
      if (call.args.length < 2) continue; // store.get(key) with no id returns the Map, not a record

      ids.push(call.args[1]);
    }
  }

  return ids;
}

module('[Integration] record id resolution (#270)', function(hooks) {
  setupIntegrationTests(hooks);

  let spies;

  hooks.before(function() {
    port = Number(config.restServer.port);

    for (const category of serialized.categories) createRecord('category', category);
    for (const trait of serialized.traits) createRecord('trait', trait);
    for (const phoneNumber of serialized.phoneNumbers) createRecord('phone-number', phoneNumber);
    for (const owner of raw.owners) createRecord('owner', owner);
    for (const animal of raw.animals) createRecord('animal', animal);

    // Spy, not stub: the real lookup still runs, so the request behaves exactly
    // as it would without the instrumentation and the response is still a
    // measurement rather than a fixture.
    spies = {
      find: sinon.spy(store, 'find'),
      get: sinon.spy(store, 'get'),
      remove: sinon.spy(store, 'remove'),
    };
  });

  hooks.after(function() {
    for (const spy of Object.values(spies ?? {})) spy.restore();
    clearAllHooks();

    // Deliberately does NOT call RestServer.close(). This module shares a
    // process with reference-sample.ts, and closing the server here leaves
    // every test in the other module failing with `fetch failed` — measured.
    // test/zz-exit-test.ts owns process teardown.
  });

  hooks.beforeEach(function() {
    for (const spy of Object.values(spies)) spy.resetHistory();
  });

  module('AC-2 — the resolved id equals the exported normaliser', function() {
    test('control — neither corpus has been silently shrunk', function(assert) {
      // Every other assertion in this module is GENERATED from a corpus row, so
      // deleting rows deletes assertions and the suite stays green with less
      // coverage. This is the only assertion here that does not come from a row.
      assert.ok(
        NUMERIC_CORPUS.length >= NUMERIC_CORPUS_FLOOR,
        `NUMERIC_CORPUS carries ${NUMERIC_CORPUS.length} numeric alias spelling(s); the floor requires at least ${NUMERIC_CORPUS_FLOOR}. ` +
        'Rows were deleted. If that was deliberate, lower NUMERIC_CORPUS_FLOOR in the same commit so the diff says what coverage was given up.'
      );

      assert.ok(
        STRING_CORPUS.length >= STRING_CORPUS_FLOOR,
        `STRING_CORPUS carries ${STRING_CORPUS.length} string-id spelling(s); the floor requires at least ${STRING_CORPUS_FLOOR}. ` +
        'Rows were deleted. If that was deliberate, lower STRING_CORPUS_FLOOR in the same commit so the diff says what coverage was given up.'
      );
    });

    test('control — the spy observes a resolution key on an ordinary request, and the request succeeds', async function(assert) {
      // Without this every assertion below could pass against a spy that never
      // fires, or against a request the router refused before any lookup.
      const response = await rawRequest({ port, target: `/animals/${ALLOWED_ANIMAL}` });

      assert.equal(response.status, 200, `GET /animals/${ALLOWED_ANIMAL} -> 200 (the corpus addresses a PERMITTED record, so it reaches the lookup)`);
      assert.equal(jsonBody(response)?.data?.id, ALLOWED_ANIMAL, 'and the record is served');

      const observed = resolvedIds(spies, 'animal');

      assert.ok(observed.length > 0, `the store was asked to resolve at least one 'animal' id — observed [${observed}]`);
      assert.ok(
        observed.every(id => id === ALLOWED_ANIMAL),
        `every observed key is ${ALLOWED_ANIMAL} — observed [${observed.map(id => `${typeof id}:${String(id)}`)}]`
      );
    });

    for (const [target, decoded, why] of NUMERIC_CORPUS) {
      test(`GET ${target} (${why}) resolves with normalizeRecordId(${JSON.stringify(decoded)})`, async function(assert) {
        const response = await rawRequest({ port, target });

        assert.equal(response.status, 200, `GET ${target} -> ${response.status} (${response.statusLine}) — a refused request never reaches the lookup, so a non-200 here makes the rest of this test vacuous`);

        const observed = resolvedIds(spies, 'animal');

        assert.ok(observed.length > 0, `the resolution path ran — observed [${observed}]`);

        // The equivalence #270 exists to hold: the key the framework looked the
        // record up by IS what a consumer gets from the exported function.
        for (const id of observed) {
          assert.strictEqual(
            id,
            normalizeRecordId(decoded),
            `the store was asked for ${JSON.stringify(id)} (${typeof id}); normalizeRecordId(${JSON.stringify(decoded)}) is ${JSON.stringify(normalizeRecordId(decoded))} (${typeof normalizeRecordId(decoded)})`
          );
        }

        assert.equal(jsonBody(response)?.data?.id, ALLOWED_ANIMAL, `and the record served is ${ALLOWED_ANIMAL}`);
      });
    }

    for (const [target, decoded, why] of STRING_CORPUS) {
      test(`GET ${target} (${why}) resolves with normalizeRecordId(${JSON.stringify(decoded)})`, async function(assert) {
        const response = await rawRequest({ port, target });
        const observed = resolvedIds(spies, 'owner');

        assert.ok(observed.length > 0, `the resolution path ran — observed [${observed}]`);

        for (const id of observed) {
          assert.strictEqual(
            id,
            normalizeRecordId(decoded),
            `the store was asked for ${JSON.stringify(id)}; normalizeRecordId(${JSON.stringify(decoded)}) is ${JSON.stringify(normalizeRecordId(decoded))}`
          );
        }

      });
    }

    test('DELETE resolves by the same value the GET path does', async function(assert) {
      // The delete path has its own getId() call sites (:364, :402) plus two
      // more inside the hook wrapper (:447, :453). All of them must agree, and
      // a divergence on the destructive path is the one that cannot be undone.
      const doomed = 9001;

      createRecord('animal', { id: doomed, type: 'goat', size: 'small', color: 'white' });
      assert.ok(store.get('animal', doomed), `animal ${doomed} exists before the DELETE`);

      for (const spy of Object.values(spies)) spy.resetHistory();

      const response = await rawRequest({ port, method: 'DELETE', target: '/animals/09001' });

      assert.equal(response.status, 204, `DELETE /animals/09001 -> ${response.status} (${response.statusLine})`);

      const observed = resolvedIds(spies, 'animal');

      assert.ok(observed.length > 0, `the resolution path ran — observed [${observed}]`);

      for (const id of observed) {
        assert.strictEqual(id, normalizeRecordId('09001'), `the delete path resolved by ${JSON.stringify(id)}, which is normalizeRecordId('09001')`);
      }

      // Bound to the post-state, not to the status code: #274 means DELETE on a
      // record that was never resolved ALSO returns 204.
      assert.notOk(store.get('animal', doomed), `animal ${doomed} was actually destroyed — the 204 is a real delete, not #274's phantom`);
    });
  });

  module('AC-3 — access() is handed the normalised id on the request', function() {
    /** Captures the request object the ORM hands to the hook layer. */
    async function observeRequest(target) {
      const seen = [];
      const unsubscribe = beforeHook('get', 'animal', context => {
        seen.push({
          recordId: context.request?.recordId,
          paramsId: context.request?.params?.id,
          params: context.request?.params,
        });
      });

      try {
        const response = await rawRequest({ port, target });

        return { response, seen };
      } finally {
        unsubscribe();
      }
    }

    test('control — the observation point fires and carries a request', async function(assert) {
      const { response, seen } = await observeRequest(`/animals/${ALLOWED_ANIMAL}`);

      assert.equal(response.status, 200, `GET /animals/${ALLOWED_ANIMAL} -> 200`);
      assert.equal(seen.length, 1, 'the hook observed exactly one request');
      assert.ok(seen[0].params, 'and that request carries params');
    });

    test('request.recordId is attached, and it is the NORMALISED value', async function(assert) {
      const { seen } = await observeRequest('/animals/008');

      assert.strictEqual(seen[0].recordId, 8, "request.recordId is 8 for '/animals/008' — a number, not the text the client sent");
      assert.strictEqual(
        seen[0].recordId,
        normalizeRecordId(seen[0].paramsId),
        `request.recordId (${JSON.stringify(seen[0].recordId)}) === normalizeRecordId(request.params.id) (${JSON.stringify(normalizeRecordId(seen[0].paramsId))})`
      );
    });

    test('request.params is NOT mutated — params.id is still the raw client text', async function(assert) {
      // Twelve getId(...) call sites, the serializer and consumer hooks all
      // read request.params. Changing params.id from string to number
      // underneath them would be a silent behaviour change on paths #270 is
      // not about, so the normalised value is attached ALONGSIDE it.
      const { seen } = await observeRequest('/animals/008');

      assert.strictEqual(seen[0].paramsId, '008', "request.params.id is still the string '008'");
      assert.strictEqual(typeof seen[0].paramsId, 'string', 'and it is still a string');
    });

    test('a collection route carries no recordId, so the documented `undefined` branch still works', async function(assert) {
      // Both documented samples tell a collection request from a record
      // request by the ABSENCE of an id. normalizeRecordId('') is '' — a
      // falsy value that is a legitimate key (#167) — so auth() attaches
      // undefined when the route carries no :id at all, rather than folding
      // "no record" onto "the record whose id is the empty string".
      const seen = [];
      const unsubscribe = beforeHook('list', 'animal', context => {
        seen.push({ recordId: context.request?.recordId, paramsId: context.request?.params?.id });
      });

      try {
        const response = await rawRequest({ port, target: '/animals' });

        assert.equal(response.status, 200, 'GET /animals -> 200');
        assert.equal(seen.length, 1, 'the hook observed the collection request');
        assert.strictEqual(seen[0].paramsId, undefined, 'request.params.id is undefined on the collection route');
        assert.strictEqual(seen[0].recordId, undefined, 'so request.recordId is undefined, NOT the empty string');
      } finally {
        unsubscribe();
      }
    });

    test('access() still receives exactly one argument — #202 stays out of scope', async function(assert) {
      // #270 must not spend #202's inversion budget. Measured here rather than
      // asserted about the source text: the reference sample's guard still
      // fires, which it could not do if the call signature had changed.
      const response = await rawRequest({ port, target: '/owners/angela' });

      assert.equal(response.status, 403, 'GET /owners/angela -> 403 — the one-argument predicate still runs and still refuses');
    });
  });
});
