// @ts-nocheck
/**
 * The reference access sample, measured against the same spellings — #265.
 *
 * test/sample/access/global-access.ts is what every other test in this suite
 * runs behind and what a contributor reads to learn what a correct access class
 * looks like. Before #265 it used `originalUrl.endsWith(...)`: mount-safe, but
 * still raw client text, and it failed open on all seven spellings below. It was
 * never measured against them — only against the one spelling the suite used.
 *
 * Filename note: does NOT end in `-test.ts`, so the main suite's glob
 * (test/**\/*-test.ts) cannot pull it into the shared process.
 */
import QUnit from 'qunit';
import { createRecord, store } from '@stonyx/orm';
import RestServer from '@stonyx/rest-server';
import { setupIntegrationTests } from 'stonyx/test-helpers';
import config from 'stonyx/config';
import { raw, serialized } from '../../sample/payload.js';

const { module, test } = QUnit;

const PROTECTED = 'angela';

let origin;

/**
 * The ids a response actually served, as a JSON:API document.
 *
 * Not a substring search over the body: Express's default 404 page is
 * `Cannot GET /OwNeRs/angela`, which contains the protected id and would fail a
 * naive "the body does not mention angela" check on a response that disclosed
 * nothing. Parse the document and look at `data`.
 */
function disclosedIds(body) {
  let document;

  try {
    document = JSON.parse(body);
  } catch {
    return [];
  }

  if (Array.isArray(document?.data)) return document.data.map(record => record.id);
  if (document?.data) return [document.data.id];

  return [];
}

module('[Integration] reference access sample (#265)', function(hooks) {
  setupIntegrationTests(hooks);

  hooks.before(function() {
    origin = `http://localhost:${config.restServer.port}`;

    for (const category of serialized.categories) createRecord('category', category);
    for (const trait of serialized.traits) createRecord('trait', trait);
    for (const phoneNumber of serialized.phoneNumbers) createRecord('phone-number', phoneNumber);
    for (const owner of raw.owners) createRecord('owner', owner);
    for (const animal of raw.animals) createRecord('animal', animal);
  });

  hooks.after(function() {
    try { RestServer.close(); } catch { /* force-exit hook handles the rest */ }
  });

  test('authorization runs AFTER route matching — request.params is populated', async function(assert) {
    // Named explicitly (Phase 2 WARNING 5) so a regression in this guarantee
    // diagnoses itself instead of looking like an ORM access defect. The
    // ordering is @stonyx/rest-server's contract — `ef7e6a3 Fix: populate
    // request.params before auth runs (#11)`, asserted upstream at
    // test/integration/rest-server-test.ts:120 — and every sample in this repo
    // authorizes on request.params, so if params were empty at auth() time the
    // documented sample would fail OPEN, not closed.
    //
    // This is the whole PR's load-bearing assumption stated once, in one place.
    const response = await fetch(`${origin}/owners/${PROTECTED}`);

    assert.ok(
      response.status >= 400,
      `GET /owners/${PROTECTED} -> ${response.status}: access() saw a populated request.params.id. ` +
      'If this is 200, params were empty when auth() ran and every access class in this repo fails open.'
    );

    const survived = Boolean(await store.find('owner', PROTECTED));
    assert.ok(survived, `"${PROTECTED}" exists, so the refusal above is a denial and not a 404`);
  });

  test('the protected record is refused on read and on delete', async function(assert) {
    const read = await fetch(`${origin}/owners/${PROTECTED}`);
    assert.equal(read.status, 403, `GET /owners/${PROTECTED} -> 403`);

    const remove = await fetch(`${origin}/owners/${PROTECTED}`, { method: 'DELETE' });
    assert.equal(remove.status, 403, `DELETE /owners/${PROTECTED} -> 403`);

    const survived = Boolean(await store.find('owner', PROTECTED));
    assert.ok(survived, `record "${PROTECTED}" still exists after the DELETE`);

    // Contain the blast radius so one regression cannot fail every later test.
    if (!survived) createRecord('owner', raw.owners.find(o => o.name === PROTECTED));
  });

  test('the record-level bypass spellings are refused', async function(assert) {
    // Asserted as an effect, not as 403. abofs/stonyx-rest-server#47 / #50 (PR
    // #64 open) make the mount match case-sensitively and strictly, at which
    // point the first two spellings 404 — the record becomes MORE protected.
    for (const spelling of ['/OwNeRs/angela', '/owners/angela/', '/owners/%61ngela']) {
      const response = await fetch(`${origin}${spelling}`);

      assert.ok(response.status >= 400, `GET ${spelling} -> ${response.status} (refused; 403 lenient | 404 strict)`);

      const served = disclosedIds(await response.text());
      assert.notOk(served.includes(PROTECTED), `GET ${spelling} serves no record for "${PROTECTED}" — served [${served}]`);
    }

    assert.ok(await store.find('owner', PROTECTED), `"${PROTECTED}" is reachable-but-denied, not merely absent`);
  });

  test('the collection-level bypass spellings do not carry the protected record', async function(assert) {
    // Exact survivor lists rather than "angela is absent": absence alone is
    // satisfied by an empty or errored response. filter[age]=36 legitimately
    // yields [] because angela is the only 36-year-old.
    const EXPECTED = {
      '/owners?filter[age]=36': [],
      '/owners?x=1': ['bob', 'gina', 'michael'],
      '/owners/': ['bob', 'gina', 'michael'],
      '/OWNERS': ['bob', 'gina', 'michael'],
    };

    for (const [spelling, expected] of Object.entries(EXPECTED)) {
      const response = await fetch(`${origin}${spelling}`);

      assert.ok(
        [200, 404].includes(response.status),
        `GET ${spelling} -> ${response.status} (200 lenient | 404 strict)`
      );

      if (response.status === 404) {
        const served = disclosedIds(await response.text());
        assert.notOk(served.includes(PROTECTED), `GET ${spelling} 404s without serving "${PROTECTED}" — served [${served}]`);

        continue;
      }

      const { data } = await response.json();
      assert.ok(Array.isArray(data), `GET ${spelling} returns a JSON:API collection document`);

      const ids = data.map(record => record.id).sort();
      assert.deepEqual(ids, expected, `GET ${spelling} returns exactly [${expected}] — got [${ids}]`);
    }
  });

  test('controls — the sample is not a blanket refusal', async function(assert) {
    const single = await fetch(`${origin}/owners/gina`);
    assert.equal(single.status, 200, 'GET /owners/gina -> 200');

    const collection = await fetch(`${origin}/owners`);
    assert.equal(collection.status, 200, 'GET /owners -> 200');

    const { data } = await collection.json();
    const ids = data.map(record => record.id);

    // Non-vacuity: "angela is absent" above is satisfied by an empty response,
    // so require the unprotected records to actually be present.
    for (const id of ['gina', 'michael', 'bob']) {
      assert.ok(ids.includes(id), `collection carries "${id}" — got [${ids}]`);
    }

    const remove = await fetch(`${origin}/owners/bob`, { method: 'DELETE' });
    assert.equal(remove.status, 204, 'DELETE /owners/bob -> 204 — the guard denies angela, not everyone');
    assert.notOk(await store.find('owner', 'bob'), 'unprotected record was actually removed');

    createRecord('owner', raw.owners.find(o => o.name === 'bob'));
  });

  test('KNOWN #256 — the animal collection filter removes nothing, and that is pinned', async function(assert) {
    // global-access.ts:34 returns `record => record.owner !== 'angela'`, but
    // record.owner is the related Record instance, not the id string, so the
    // predicate is never false. Phase 3 and Phase 4 measured this independently
    // and got the same numbers; this pins it so the reference sample cannot
    // silently endorse the shape, and so #256 landing is a visible event here
    // rather than a quiet change.
    //
    // WHEN #256 IS FIXED THIS TEST GOES RED. That is the point: flip the
    // expectation to `leaked.length === 0` in the same commit that fixes it.
    const response = await fetch(`${origin}/animals`);
    assert.equal(response.status, 200, 'GET /animals -> 200');

    const { data } = await response.json();
    const leaked = data.filter(record => record.relationships?.owner?.data?.id === PROTECTED);

    assert.ok(data.length > 0, `the collection is non-empty — got ${data.length} animals`);
    assert.ok(
      leaked.length > 0,
      `#256 is still live: ${leaked.length} of ${data.length} animals belong to "${PROTECTED}" and the filter did not remove them (ids [${leaked.map(r => r.id)}])`
    );

    // The widened surface, also inert only because the predicate never fires.
    for (const spelling of ['/animals/', '/ANIMALS', '/animals?x=1']) {
      const wide = await fetch(`${origin}${spelling}`);

      assert.ok([200, 404].includes(wide.status), `GET ${spelling} -> ${wide.status} (200 lenient | 404 strict)`);
    }
  });


  // ==========================================================================
  // AC-3, as an OUTCOME. The string-id model was never "safe by design" — it
  // was safe by the coincidence that getId() did not touch string ids, and one
  // permissive token turned `GET /owners/ANGELA` into 200-with-the-record and
  // `DELETE /owners/ANGELA` into a real destroy, with 961 assertions green.
  //
  // Bound to what was SERVED and to the record's POST-STATE, never to the
  // status code: #274 means a DELETE that resolved nothing also returns 204,
  // so status alone cannot tell "refused" from "never found".
  //
  // Deliberately NOT bound to a particular status either, because both regimes
  // are correct outcomes of #270: today the normaliser does not case-fold and
  // `ANGELA` resolves nothing (404), and if it ever did case-fold, the
  // predicate would see the same folded value and refuse (403). Both are
  // "the record is not disclosed and not destroyed", which is the property.
  // ==========================================================================
  module('AC-3 (#270) — a case-variant spelling of the protected id discloses nothing', function() {
    test('GET /owners/ANGELA does not serve the protected record', async function(assert) {
      assert.ok(await store.find('owner', PROTECTED), `"${PROTECTED}" is present, so this is reachable-but-refused rather than merely absent`);

      const response = await fetch(`${origin}/owners/ANGELA`);
      const served = disclosedIds(await response.text());

      assert.notOk(
        served.includes(PROTECTED),
        `GET /owners/ANGELA -> ${response.status} and serves no record for "${PROTECTED}" — served [${served}]`
      );
      assert.notEqual(response.status, 200, `GET /owners/ANGELA -> ${response.status} — not a successful record read`);
    });

    test('DELETE /owners/ANGELA leaves the protected record intact', async function(assert) {
      const before = Boolean(await store.find('owner', PROTECTED));

      assert.ok(before, `"${PROTECTED}" is present before the DELETE`);

      const response = await fetch(`${origin}/owners/ANGELA`, { method: 'DELETE' });
      const after = Boolean(await store.find('owner', PROTECTED));

      // The post-state IS the assertion. 204 here is #274 and is not the point.
      assert.ok(after, `record "${PROTECTED}" still exists after DELETE /owners/ANGELA (response was ${response.status})`);

      if (!after) createRecord('owner', raw.owners.find(owner => owner.name === PROTECTED));
    });
  });

  test('the documented Intentional Gap is still intentional', async function(assert) {
    // global-access.ts:28 states it does not block angela's related routes.
    // Pinned so the gap stays a decision rather than quietly becoming an
    // accident. The gap is a DISCLOSURE of the protected record's related data;
    // it is tracked as part of abofs/stonyx-orm#202 (access() cannot see the
    // model, so a per-model rule cannot reach the related routes). If #202 or a
    // successor closes it, this test is the one that will read as a regression
    // — flip it there rather than deleting it.
    const related = await fetch(`${origin}/owners/${PROTECTED}/pets`);
    assert.equal(related.status, 200, `GET /owners/${PROTECTED}/pets -> 200 (documented gap)`);
  });
});
