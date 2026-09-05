// @ts-nocheck
/**
 * SCAFFOLD — abofs/stonyx-orm#270.
 *
 * TODO stubs only. This file owns the BEHAVIOURAL criteria that must run over
 * the live router, because the defect is about the value the framework
 * ACTUALLY resolves the record with:
 *
 *   AC-2  for every spelling in the alias corpus, the id the ORM resolved the
 *         record with deep-equals normalizeRecordId(rawSpelling). Observed from
 *         the resolution path itself (a spy on store.find / store.get /
 *         store.remove during a live request) — never by calling the normaliser
 *         twice and comparing f(x) to f(x), which is the vacuous version the
 *         refinement explicitly rejects.
 *
 *   AC-3  request.recordId is what the predicate sees, and it equals
 *         normalizeRecordId(request.params.id). Asserted as an outcome, bound
 *         to the record's POST-STATE rather than to a status code: #274 means
 *         DELETE on a non-existent record already returns 204, so status alone
 *         cannot discriminate.
 *
 * The unit tier is explicitly insufficient here — test/unit/access-filter-
 * enforcement-test.ts:95-125 fabricates baseUrl/path and calls auth() directly,
 * which cannot see the resolution path at all.
 */
import QUnit from 'qunit';

const { module, test } = QUnit;

module('[Integration] record id resolution (#270)', function() {
  module('AC-2 — the resolved id equals the exported normaliser, observed from the resolution path', function() {
    test('TODO: control — the spy actually observes a resolution key on an ordinary request', function(assert) {
      assert.ok(true, 'TODO — scaffold');
    });

    test('TODO: every numeric alias resolves with exactly normalizeRecordId(rawSpelling)', function(assert) {
      assert.ok(true, 'TODO — scaffold');
    });

    test('TODO: every string-id spelling resolves with exactly normalizeRecordId(rawSpelling)', function(assert) {
      assert.ok(true, 'TODO — scaffold');
    });

    test('TODO: the DELETE path resolves with the same value as the GET path', function(assert) {
      assert.ok(true, 'TODO — scaffold');
    });
  });

  module('AC-3 — access() is handed the normalised id on the request', function() {
    test('TODO: request.recordId === normalizeRecordId(request.params.id) at access() time', function(assert) {
      assert.ok(true, 'TODO — scaffold');
    });

    test('TODO: request.params is NOT mutated — params.id is still the raw client text', function(assert) {
      assert.ok(true, 'TODO — scaffold');
    });

    test('TODO: access() still receives exactly one argument (#202 stays out of scope)', function(assert) {
      assert.ok(true, 'TODO — scaffold');
    });
  });
});
