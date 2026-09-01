// @ts-nocheck
//
// abofs/stonyx-orm#236 / #237 — `recordId` on the access context, and the close
// of the percent-encoding authorization bypass.
//
// Specification: the refinement comment on #228,
// https://github.com/abofs/stonyx-orm/issues/228#issuecomment-5489133390
//
// ---------------------------------------------------------------------------
// WHY A NEW FILE
//
// #237 AC10 is an assertion ABOUT other files' assertions: that the #222
// tripwires planted in test/integration/orm-test.ts were INVERTED rather than
// deleted, and that the assertion count in the four files the fix touches did
// not go DOWN. An assertion that a pin still exists cannot live in the same
// file as the pin — deleting both would be a silent pass. Same reasoning as
// test/unit/access-sample-migration-test.ts, which does this for #222.
// ---------------------------------------------------------------------------
import QUnit from 'qunit';

const { module, todo } = QUnit;

module('[Unit] recordId on the access context (#236/#237)', function() {
  todo('AC1 (#236) — AccessContext declares `recordId`, the DECODED route-parameter id', function(assert) {
    assert.ok(false, 'SCAFFOLD — not implemented');
  });

  todo('AC10 (#237) — the #222 tripwires were INVERTED, not deleted', function(assert) {
    assert.ok(false, 'SCAFFOLD — not implemented');
  });
});
