// @ts-nocheck
/**
 * SCAFFOLD — abofs/stonyx-orm#265
 *
 * Drives the access() sample that is *shipped in README.md* through the live
 * router and asserts it denies. See #265's refinement comment (2026-09-04).
 *
 * Filename note: this file deliberately does NOT end in `-test.ts`. The main
 * suite's glob is `test/**\/*-test.ts`; this harness needs its own
 * `orm.paths.access`, which is a boot-time global, so it must run as its own
 * chained QUnit process. Precedent: test/integration/mounted-route/links-mounted.ts
 */
import QUnit from 'qunit';

const { module, test } = QUnit;

module('[Acceptance] README access() sample — #265', function() {
  module('AC-2 — the README block is extracted and driven', function() {
    test('TODO: extraction finds exactly one GlobalAccess fenced block', function(assert) {
      assert.ok(true, 'TODO');
    });

    test('TODO: extracted block is byte-identical to test/sample/access/global-access.ts', function(assert) {
      assert.ok(true, 'TODO');
    });

    test('TODO: GET /owners/angela -> 403 over the live router', function(assert) {
      assert.ok(true, 'TODO');
    });

    test('TODO: DELETE /owners/angela -> 403 and the record survives', function(assert) {
      assert.ok(true, 'TODO');
    });

    test('TODO: GET /owners -> 200 with exactly 3 records and no angela', function(assert) {
      assert.ok(true, 'TODO');
    });
  });

  module('AC-3 — positive control: the known-bad fixture still serves', function() {
    test('TODO: GET /owners/angela -> 200 against readme-pre-265.ts', function(assert) {
      assert.ok(true, 'TODO');
    });

    test('TODO: DELETE /owners/angela -> 204 and the record is destroyed', function(assert) {
      assert.ok(true, 'TODO');
    });
  });
});
