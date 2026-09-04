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

const { module, test } = QUnit;

/** The record the documented sample exists to protect. */
const PROTECTED = 'angela';

let origin;

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

module('[Integration] README access() sample (#265)', function(hooks) {
  setupIntegrationTests(hooks);

  hooks.before(function() {
    origin = `http://localhost:${config.restServer.port}`;

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

    /** Collection-level spellings must answer, but must not carry the record. */
    const FILTERED = [
      ['/owners?filter[age]=36', 'query string that selects the protected record'],
      ['/owners?x=1', 'arbitrary query string'],
      ['/owners/', 'trailing slash on the collection'],
      ['/OWNERS', 'upper-case mount segment'],
    ];

    for (const [spelling, why] of DENIED) {
      test(`GET ${spelling} (${why}) is denied`, async function(assert) {
        const response = await fetch(`${origin}${spelling}`);

        assert.equal(response.status, 403, `GET ${spelling} -> 403`);
      });
    }

    for (const [spelling, why] of FILTERED) {
      test(`GET ${spelling} (${why}) does not carry the protected record`, async function(assert) {
        const response = await fetch(`${origin}${spelling}`);

        assert.equal(response.status, 200, `GET ${spelling} -> 200`);

        const { data } = await response.json();
        const ids = data.map(record => record.id);

        // Control: assert the collection is non-empty, so "absent" cannot be
        // satisfied by an empty or errored response.
        assert.ok(ids.length > 0, `GET ${spelling} returns a non-empty collection — got [${ids}]`);
        assert.notOk(ids.includes(PROTECTED), `GET ${spelling} omits "${PROTECTED}" — got [${ids}]`);
      });
    }
  });
});
