// @ts-nocheck
//
// Regression coverage for abofs/stonyx-orm#234 — relationship LINKAGE
// (`relationships.*.data`) is emitted unconditionally by `Record.toJSON()`, so
// a record the access filter hides on every one of its own surfaces is still
// named, by id, inside another model's document.
//
// The trigger needs no query string and no cooperation from the caller:
//
//     GET /owners/angela  ->  404
//     GET /animals/1      ->  200, relationships.owner.data == {owner, angela}
//     GET /animals        ->  200, 8 of 20 records name angela
//
// ---------------------------------------------------------------------------
// SCOPE — LINKAGE ONLY, ON THE FOUR REQUEST-BOUND READ SURFACES
// ---------------------------------------------------------------------------
// This file asserts which IDS appear inside `relationships.*.data`. It asserts
// NOTHING about which resources appear in `included` — that is membership, and
// it belongs to abofs/stonyx-orm#233. A resource may legitimately appear in
// `included` while some document's linkage no longer names it.
//
// The four surfaces are the four `Record.toJSON()` call sites that already bind
// the request: `getCollectionHandler`, `getSingleHandler`, and the two
// related-resource route sites in `_generateRelationshipRoutes`.
//
// ASSERTION LABELS, as in test/unit/access-filter-enforcement-test.ts:
//   [DEFECT] — observed FAILING against unfixed dev at c5f7907.
//   [GUARD]  — passes on dev today; proves the fix did not overshoot.
//
import QUnit from 'qunit';
import sinon from 'sinon';
import Orm from '@stonyx/orm';
import { setupIntegrationTests } from 'stonyx/test-helpers';
import config from 'stonyx/config';
import RestServer from '@stonyx/rest-server';

const { module, todo } = QUnit;

let endpoint;

module('[Integration] #234 relationship linkage access', function(hooks) {
  setupIntegrationTests(hooks);

  hooks.before(function() {
    endpoint = `http://localhost:${config.restServer.port}`;
  });

  hooks.after(function() {
    RestServer.close();
  });

  // AC1 (belongsTo half) — the honest, fixture-free trigger.
  todo('[DEFECT] AC1 — a hidden owner id is absent from a record document linkage', async function(assert) {
    assert.ok(false, 'not implemented');
  });

  // AC1 (hasMany half). The shipped fixture has no hidden child under a
  // PERMITTED parent — every hidden animal is owned by `restricted`, who is
  // hidden himself — so this needs a hidden child the fixture does not have.
  todo('[DEFECT] AC1b — a hidden child id is absent from a permitted parent hasMany linkage', async function(assert) {
    assert.ok(false, 'not implemented');
  });

  // AC2 — bulk/attributed disclosure on the zero-parameter collection surface.
  todo('[DEFECT] AC2 — GET /animals names no owner that GET /owners/{id} 404s', async function(assert) {
    assert.ok(false, 'not implemented');
  });

  // AC3 — the over-denial tripwire, stated positively.
  todo('[GUARD] AC3 — permitted linkage is still emitted on every surface', async function(assert) {
    assert.ok(false, 'not implemented');
  });

  // AC4 — `getAccess()` -> undefined is ambiguous by design and must DENY.
  todo('[DEFECT] AC4 — a model with no resolvable access predicate never appears in linkage', async function(assert) {
    assert.ok(false, 'not implemented');
  });

  // AC6 — the drop shape is byte-identical to a genuinely empty relationship.
  todo('[GUARD] AC6 — a filtered relationship is indistinguishable from an empty one', async function(assert) {
    assert.ok(false, 'not implemented');
  });

  // AC7 (measurement half) — one resolution per type, one verdict per (type,id).
  todo('[GUARD] AC7 — the verdict is cached per (type, id) and getAccess once per type', async function(assert) {
    assert.ok(false, 'not implemented');
  });

  // The two related-resource route sites.
  todo('[DEFECT] AC1c — linkage inside a related-resource route document is filtered', async function(assert) {
    assert.ok(false, 'not implemented');
  });
});
