// @ts-nocheck
//
// abofs/stonyx-orm#234 — the two halves of the change that are NOT
// request-shaped:
//
//   1. The DEFAULT. `Record.toJSON` is also the `JSON.stringify` hook, so an
//      implicit caller gets `toJSON('data')` — a STRING in the options slot —
//      and has no syntactic place to pass a verdict (abofs/stonyx-orm#230).
//      The no-argument document must therefore be byte-identical to what
//      shipped before this change.
//
//   2. ONE verdict interpreter. `auth()` and the linkage path must read a
//      consumer `access()` return through the SAME function, or the two answer
//      differently about the same value and the linkage path becomes a second,
//      unreviewed authorization vocabulary.
//
import QUnit from 'qunit';
import { setupIntegrationTests } from 'stonyx/test-helpers';

const { module, todo } = QUnit;

module('[Unit] #234 linkage verdict', function(hooks) {
  setupIntegrationTests(hooks);

  // AC5
  todo('[GUARD] AC5 — a zero-argument toJSON() produces the pre-change document', function(assert) {
    assert.ok(false, 'not implemented');
  });

  // AC5 — the implicit caller, exercised through the language hook itself.
  todo('[GUARD] AC5b — JSON.stringify({ data: record }) is unchanged', function(assert) {
    assert.ok(false, 'not implemented');
  });

  // AC9 — interpreter parity across the six documented return shapes.
  todo('[GUARD] AC9 — auth() and the linkage path share one verdict interpreter', function(assert) {
    assert.ok(false, 'not implemented');
  });

  // AC8 — the consumer-facing record of what is and is not filtered.
  todo('[GUARD] AC8 — README Known limitations records the linkage and format() scope', async function(assert) {
    assert.ok(false, 'not implemented');
  });
});
