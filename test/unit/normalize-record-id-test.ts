// @ts-nocheck
/**
 * SCAFFOLD — abofs/stonyx-orm#270.
 *
 * TODO stubs only. Every test below is a placeholder for one acceptance
 * criterion from the sprint-92 refinement comment on #270. They are committed
 * first, before any implementation, so the diff that follows shows each
 * criterion being turned from a stub into a measurement.
 *
 * This file owns the STATIC and UNIT-tier criteria:
 *
 *   AC-1  a consumer can import { normalizeRecordId } from '@stonyx/orm',
 *         resolved through the package `exports` map, from outside the repo.
 *   AC-5  no id-coercion expression survives outside the one normaliser.
 *
 * plus the normaliser's own contract corpus, which is what pins the documented
 * semantics (#270 preserves them exactly; changing them must be a deliberate,
 * visible edit rather than a silent one).
 *
 * The BEHAVIOURAL criteria (AC-2, AC-3) live in
 * test/integration/record-id-resolution-test.ts and in the readme-access /
 * reference-access harnesses; AC-4 extends the existing static guard in
 * test/integration/readme-sample-test.ts. Placed that way deliberately so
 * abofs/stonyx-orm#271 (relocating readme-sample-test.ts) cannot orphan them.
 */
import QUnit from 'qunit';

const { module, test } = QUnit;

module('[Unit] normalizeRecordId (#270)', function() {
  module('AC-1 — the normaliser is reachable from an installed package', function() {
    test('TODO: `import { normalizeRecordId } from "@stonyx/orm"` resolves through the exports map from outside the repo', function(assert) {
      assert.ok(true, 'TODO — scaffold');
    });

    test('TODO: the packed tarball carries the built entry point that declares it', function(assert) {
      assert.ok(true, 'TODO — scaffold');
    });
  });

  module('the normaliser contract — today\'s semantics, pinned exactly', function() {
    test('TODO: every spelling in the alias corpus normalises to its documented value', function(assert) {
      assert.ok(true, 'TODO — scaffold');
    });

    test('TODO: string ids are returned untouched, including case', function(assert) {
      assert.ok(true, 'TODO — scaffold');
    });

    test('TODO: parseInt is called with no radix, so 0x7 is 7 and not 0', function(assert) {
      assert.ok(true, 'TODO — scaffold');
    });

    test('TODO: an empty or absent id normalises to the empty string', function(assert) {
      assert.ok(true, 'TODO — scaffold');
    });
  });

  module('AC-5 — one implementation, no hand-copies', function() {
    test('TODO: no id-coercion expression exists outside the normaliser in src/, README.md, docs/ or test/sample/', function(assert) {
      assert.ok(true, 'TODO — scaffold');
    });

    test('TODO: control — the AC-5 scanner actually fires on a real hand-copy', function(assert) {
      assert.ok(true, 'TODO — scaffold');
    });
  });
});
