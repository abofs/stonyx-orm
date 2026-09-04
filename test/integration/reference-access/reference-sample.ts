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
    for (const spelling of ['/OwNeRs/angela', '/owners/angela/', '/owners/%61ngela']) {
      const response = await fetch(`${origin}${spelling}`);
      assert.equal(response.status, 403, `GET ${spelling} -> 403`);
    }
  });

  test('the collection-level bypass spellings do not carry the protected record', async function(assert) {
    for (const spelling of ['/owners?filter[age]=36', '/owners?x=1', '/owners/', '/OWNERS']) {
      const response = await fetch(`${origin}${spelling}`);
      assert.equal(response.status, 200, `GET ${spelling} -> 200`);

      const { data } = await response.json();
      assert.ok(Array.isArray(data), `GET ${spelling} returns a JSON:API collection document`);

      const ids = data.map(record => record.id);
      assert.notOk(ids.includes(PROTECTED), `GET ${spelling} omits "${PROTECTED}" — got [${ids}]`);
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

  test('the documented Intentional Gap is still intentional', async function(assert) {
    // global-access.ts states it does not block angela's related routes. Pinned
    // so the gap stays a decision rather than quietly becoming an accident.
    const related = await fetch(`${origin}/owners/${PROTECTED}/pets`);
    assert.equal(related.status, 200, `GET /owners/${PROTECTED}/pets -> 200 (documented gap)`);
  });
});
