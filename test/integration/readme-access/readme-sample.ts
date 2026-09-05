// @ts-nocheck
/**
 * The shipped README access() sample, driven verbatim — abofs/stonyx-orm#265.
 *
 * The class the server under this process loads was written to disk by
 * ./setup.ts straight out of README.md. Every request below therefore measures
 * the documented sample itself, not a hand-copy of it that can drift.
 *
 * Filename note: this file deliberately does NOT end in `-test.ts`. The main
 * suite's glob is `test/**\/*-test.ts`; if it matched, this module would boot
 * inside the default-route process, where `paths.access` points at
 * test/sample/access and the README sample is not loaded at all.
 *
 * Two properties are measured:
 *
 *  1. The protected record is protected — 403 on read and on delete, and the
 *     record survives the delete. Bound to the outcome, not to an identifier:
 *     the shipped sample and the tested sample differ in *two* identifiers
 *     (`request.url` -> `originalUrl` and `/owner` -> `/owners`) and fixing
 *     either one alone still returns 200/204 with the record destroyed.
 *
 *  2. It holds under the seven spellings that a URL-string predicate lets
 *     through. These are plain `fetch` calls, not crafted headers — a consumer
 *     reaches all seven from a browser address bar.
 */
import QUnit from 'qunit';
import { createRecord, store } from '@stonyx/orm';
import RestServer from '@stonyx/rest-server';
import { setupIntegrationTests } from 'stonyx/test-helpers';
import config from 'stonyx/config';
import { raw, serialized } from '../../sample/payload.js';
import { rawRequest, jsonBody } from '../../helpers/raw-http.js';

const { module, test } = QUnit;

/** The record the documented sample exists to protect. */
const PROTECTED = 'angela';

/**
 * The record the SECOND documented sample protects. `animal` has numeric ids,
 * which is the case the owner sample cannot exercise: `isNaN('angela')` is true,
 * so getId() returns it untouched and the string sample is safe by accident of
 * the model it picked (Phase 3 BLOCKER 1 / Phase 4 addendum HIGH 3).
 */
const PROTECTED_ANIMAL = 7;

let origin;
let port;

/**
 * Re-seed the protected record if a probe destroyed it, so one failing
 * assertion cannot cascade into false failures in every later test. The
 * assertion still fails; only the blast radius is contained.
 */
async function restoreProtectedRecord() {
  if (await store.find('owner', PROTECTED)) return false;

  // Seeded from the raw payload, the same shape hooks.before used.
  createRecord('owner', raw.owners.find(o => o.name === PROTECTED));
  return true;
}

/**
 * Same containment for the numeric-id record. Without it a destructive probe
 * silently turns every LATER assertion vacuous — measured: once `DELETE
 * /animals/007` destroyed record 7, "PATCH is denied and the record is
 * unmodified" and "GET /animals omits the protected record" both went GREEN
 * because there was no longer a record to disclose.
 */
async function restoreProtectedAnimal() {
  if (await store.find('animal', PROTECTED_ANIMAL)) return false;

  createRecord('animal', raw.animals.find(animal => animal.id === PROTECTED_ANIMAL));
  return true;
}

module('[Integration] README access() sample (#265)', function(hooks) {
  setupIntegrationTests(hooks);

  hooks.before(function() {
    port = Number(config.restServer.port);
    origin = `http://localhost:${port}`;

    // Fresh process, empty store — seed the sample dataset.
    for (const category of serialized.categories) createRecord('category', category);
    for (const trait of serialized.traits) createRecord('trait', trait);
    for (const phoneNumber of serialized.phoneNumbers) createRecord('phone-number', phoneNumber);
    for (const owner of raw.owners) createRecord('owner', owner);
    for (const animal of raw.animals) createRecord('animal', animal);
  });

  hooks.after(function() {
    try { RestServer.close(); } catch { /* force-exit hook handles the rest */ }
  });

  // ==========================================================================
  // The filed defect: 200 on read, 204 on delete, record destroyed.
  // ==========================================================================
  module('the protected record is protected', function() {
    test('GET /owners/angela is denied', async function(assert) {
      const response = await fetch(`${origin}/owners/${PROTECTED}`);

      assert.equal(response.status, 403, `GET /owners/${PROTECTED} -> 403`);
    });

    test('DELETE /owners/angela is denied and the record survives', async function(assert) {
      const response = await fetch(`${origin}/owners/${PROTECTED}`, { method: 'DELETE' });

      assert.equal(response.status, 403, `DELETE /owners/${PROTECTED} -> 403`);

      const survived = Boolean(await store.find('owner', PROTECTED));
      assert.ok(survived, `record "${PROTECTED}" still exists after the DELETE`);

      const restored = await restoreProtectedRecord();
      assert.notOk(restored, 'record did not have to be re-seeded — nothing destroyed it');
    });
  });

  // ==========================================================================
  // Controls. A sample that refused everything would satisfy every 403
  // assertion above, so pin the access the sample is supposed to grant.
  // ==========================================================================
  module('controls — the sample still grants what it grants', function() {
    test('GET /owners/gina returns the record', async function(assert) {
      const response = await fetch(`${origin}/owners/gina`);

      assert.equal(response.status, 200, 'GET /owners/gina -> 200');

      const { data } = await response.json();
      assert.equal(data.id, 'gina', 'unprotected record is returned in full');
    });

    test('GET /owners returns the other owners and omits the protected one', async function(assert) {
      const response = await fetch(`${origin}/owners`);

      assert.equal(response.status, 200, 'GET /owners -> 200');

      const { data } = await response.json();
      const ids = data.map(record => record.id);

      assert.deepEqual(ids, ['gina', 'michael', 'bob'], `collection excludes "${PROTECTED}" — got [${ids}]`);
    });

    test('DELETE /owners/bob is allowed — the guard is not a blanket refusal', async function(assert) {
      const response = await fetch(`${origin}/owners/bob`, { method: 'DELETE' });

      assert.equal(response.status, 204, 'DELETE /owners/bob -> 204');
      assert.notOk(await store.find('owner', 'bob'), 'unprotected record was actually removed');

      createRecord('owner', raw.owners.find(o => o.name === 'bob'));
    });
  });

  // ==========================================================================
  // The seven spellings a URL-string predicate lets through. Each is measured
  // individually; none of them is asserted by proxy.
  // ==========================================================================
  module('bypass spellings', function() {
    /** Record-level spellings must be refused outright. */
    const DENIED = [
      ['/OwNeRs/angela', 'mixed-case mount segment'],
      ['/owners/angela/', 'trailing slash on the record'],
      ['/owners/%61ngela', 'percent-encoded first character of the id'],
    ];

    /**
     * Collection-level spellings must answer, but must not carry the record.
     * The expected id list is spelled out per case rather than asserted as
     * "angela is absent": absence alone is satisfied by an empty or errored
     * response, and `filter[age]=36` legitimately produces an empty collection
     * because angela is the only 36-year-old. Naming the survivors makes the
     * empty case a measurement instead of a loophole.
     */
    const FILTERED = [
      ['/owners?filter[age]=36', 'query string that selects the protected record', []],
      ['/owners?filter[age]=34', 'query string that selects an unprotected record', ['gina']],
      ['/owners?x=1', 'arbitrary query string', ['bob', 'gina', 'michael']],
      ['/owners/', 'trailing slash on the collection', ['bob', 'gina', 'michael']],
      ['/OWNERS', 'upper-case mount segment', ['bob', 'gina', 'michael']],
    ];

    for (const [spelling, why] of DENIED) {
      test(`GET ${spelling} (${why}) is denied`, async function(assert) {
        const response = await fetch(`${origin}${spelling}`);

        assert.equal(response.status, 403, `GET ${spelling} -> 403`);
      });
    }

    for (const [spelling, why, expected] of FILTERED) {
      test(`GET ${spelling} (${why}) does not carry the protected record`, async function(assert) {
        const response = await fetch(`${origin}${spelling}`);

        assert.equal(response.status, 200, `GET ${spelling} -> 200`);

        const { data } = await response.json();
        assert.ok(Array.isArray(data), `GET ${spelling} returns a JSON:API collection document`);

        const ids = data.map(record => record.id).sort();

        assert.deepEqual(ids, expected, `GET ${spelling} returns exactly [${expected}] — got [${ids}]`);
        assert.notOk(ids.includes(PROTECTED), `GET ${spelling} omits "${PROTECTED}"`);
      });
    }
  });

  // ==========================================================================
  // The numeric-id class. src/orm-request.ts getId() coerces a numeric-looking
  // id through parseInt() BEFORE it resolves the record; the documented
  // predicate compares the raw text. Those are different values, and parseInt
  // is aggressively lossy, so one address-bar spelling is denied and every
  // alias of it is granted.
  //
  // Driven over RAW SOCKETS (test/helpers/raw-http.ts, new — abofs/stonyx-orm#266
  // records that no such client existed). This is not ceremony: the finding is
  // about the request TARGET, and `fetch` rewrites the property under test.
  // `/animals/ 7` carries a literal space, which fetch percent-encodes before
  // it reaches the wire, so a fetch-based test would measure the client.
  // ==========================================================================
  module('numeric-id aliases (getId parseInt coercion)', function() {
    /**
     * Every spelling parseInt() folds onto 7. Measured, not reasoned: each was
     * confirmed to resolve record 7 under the pre-fix sample.
     */
    const ALIASES = [
      ['/animals/7', 'the exact spelling the sample names'],
      ['/animals/007', 'leading zeroes'],
      ['/animals/7.0', 'trailing decimal'],
      ['/animals/7.9', 'fractional — parseInt truncates'],
      ['/animals/7e0', 'exponent notation'],
      ['/animals/0x7', 'hex — parseInt auto-detects the 0x radix'],
      ['/animals/%207', 'percent-encoded leading space'],
      ['/animals/%2B7', 'percent-encoded plus sign'],
      ['/animals/7%0A', 'percent-encoded trailing newline'],
      // Found by the raw-socket sweep; neither appears in any SME variant table.
      ['/animals/%097', 'percent-encoded tab'],
      ['/animals/+7', 'a bare, unencoded + in the request target'],
    ];

    test('control — the raw-socket client reaches the server and reads an unprotected record', async function(assert) {
      // Without this, every `status >= 400` assertion below passes vacuously
      // against a client that cannot talk to the server at all.
      const response = await rawRequest({ port, target: '/animals/8' });

      assert.equal(response.status, 200, 'GET /animals/8 over a raw socket -> 200');
      assert.equal(jsonBody(response)?.data?.id, 8, 'the raw-socket client parses a real JSON:API body');
    });

    test('control — the protected animal exists and is reachable by the router', async function(assert) {
      // Proves the 403s below are reachable-but-denied, not merely absent.
      assert.ok(await store.find('animal', PROTECTED_ANIMAL), `animal ${PROTECTED_ANIMAL} is seeded`);
    });

    for (const [target, why] of ALIASES) {
      test(`GET ${target} (${why}) does not serve the protected record`, async function(assert) {
        const response = await rawRequest({ port, target });
        const served = jsonBody(response)?.data?.id;

        assert.notEqual(served, PROTECTED_ANIMAL, `GET ${target} must not disclose animal ${PROTECTED_ANIMAL} — served id ${served}`);
        assert.ok(response.status >= 400, `GET ${target} -> ${response.status} (${response.statusLine})`);
      });
    }

    test('DELETE /animals/007 is denied and the record survives', async function(assert) {
      const response = await rawRequest({ port, method: 'DELETE', target: '/animals/007' });

      assert.ok(response.status >= 400, `DELETE /animals/007 -> ${response.status} (denied)`);

      const survived = Boolean(await store.find('animal', PROTECTED_ANIMAL));
      assert.ok(survived, `animal ${PROTECTED_ANIMAL} still exists after the DELETE`);

      const restored = await restoreProtectedAnimal();
      assert.notOk(restored, 'record did not have to be re-seeded — nothing destroyed it');
    });

    test('PATCH /animals/7.9 is denied and the record is unmodified', async function(assert) {
      const before = await store.find('animal', PROTECTED_ANIMAL);

      // Non-vacuity: a PATCH cannot be proven harmless against a record that a
      // previous probe already destroyed.
      assert.ok(before, `animal ${PROTECTED_ANIMAL} is present before the PATCH`);

      const size = before?.size;

      const response = await rawRequest({
        port,
        method: 'PATCH',
        target: '/animals/7.9',
        headers: { 'Content-Type': 'application/vnd.api+json' },
        body: JSON.stringify({ data: { id: '7', type: 'animals', attributes: { size: 'PWNED' } } }),
      });

      assert.ok(response.status >= 400, `PATCH /animals/7.9 -> ${response.status} (denied)`);

      const after = await store.find('animal', PROTECTED_ANIMAL);
      assert.equal(after?.size, size, `animal ${PROTECTED_ANIMAL}.size is unchanged — was "${size}", now "${after?.size}"`);
    });

    test('GET /animals omits the protected record', async function(assert) {
      const response = await rawRequest({ port, target: '/animals' });

      assert.equal(response.status, 200, 'GET /animals -> 200');

      const ids = jsonBody(response)?.data?.map(record => record.id) ?? [];

      // Non-vacuity: "omits 7" is satisfied by a store from which 7 was deleted.
      assert.ok(await store.find('animal', PROTECTED_ANIMAL), `animal ${PROTECTED_ANIMAL} is still in the store`);
      assert.ok(ids.length > 0, `the collection is non-empty — got ${ids.length} records`);
      assert.notOk(ids.includes(PROTECTED_ANIMAL), `GET /animals omits ${PROTECTED_ANIMAL} — got [${ids}]`);
    });

    test('control — the numeric sample is not a blanket refusal', async function(assert) {
      // A sample that denied everything would satisfy every assertion above.
      const response = await rawRequest({ port, target: '/animals/8' });

      assert.equal(response.status, 200, 'GET /animals/8 -> 200');
      assert.equal(jsonBody(response)?.data?.id, 8, 'an unprotected animal is served in full');
    });

    test('a LITERAL space in the request target is rejected by the HTTP parser, not by the sample', async function(assert) {
      // Phase 4's addendum lists `GET /animals/ 7 -> 200, served data.id 7`.
      // Over a raw socket it does not reproduce: node's HTTP parser rejects the
      // request line before Express sees it, because an unencoded space
      // terminates the request target. Their measurement is consistent with a
      // client that percent-encoded the space first — which is `%207`, a real
      // bypass that IS in the list above.
      //
      // Pinned rather than dropped: this spelling is safe for a reason that has
      // nothing to do with the access sample, so if the parser ever loosens,
      // this goes red instead of quietly joining the alias set.
      const response = await rawRequest({ port, target: '/animals/ 7' });

      assert.equal(response.status, 400, `GET "/animals/ 7" -> ${response.status} (${response.statusLine})`);
      assert.notEqual(jsonBody(response)?.data?.id, PROTECTED_ANIMAL, 'nothing is served');
    });

    test('control — a non-numeric id is not silently folded onto the protected record', async function(assert) {
      // getId() returns '7abc' untouched (isNaN is true), so it must 404 rather
      // than resolve 7. This is the boundary that proves the aliases above are
      // parseInt semantics and not a wildcard.
      const response = await rawRequest({ port, target: '/animals/7abc' });

      assert.notEqual(jsonBody(response)?.data?.id, PROTECTED_ANIMAL, 'GET /animals/7abc does not resolve record 7');
    });
  });
});
