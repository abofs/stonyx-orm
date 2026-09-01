// @ts-nocheck
//
// abofs/stonyx-orm#233 — `include=` traversal membership, the unit tier.
//
// SCAFFOLD COMMIT. Every `test.todo` below is a placeholder for one acceptance
// criterion of #233 and asserts nothing yet. QUnit reports a `todo` whose body
// fails as a TODO rather than a failure, and reports a todo that PASSES as a
// failure — so a stub cannot be left behind by accident once it is filled in.
//
// The behavioural half of this story runs over the live express router in the
// `Include Traversal Membership Access (#233)` module in
// test/integration/orm-test.ts. This file holds:
//
//   - the unit-tier criteria that need a stubbed registry rather than a server
//     (AC5, AC9), and
//   - the cross-file re-specifications this story owes its two siblings: #235's
//     `X1`, `X1c` and `R1c` all pin the PRE-#233 membership behaviour and are
//     falsified by this change by construction. They are re-specified in place,
//     never deleted.
//
import QUnit from 'qunit';

const { module, test } = QUnit;

module('[Unit] #233 include= traversal membership', function() {
  test.todo('AC5 — getAccess(type) === undefined denies the sideloaded resource', function(assert) {
    // TODO: stubbed registry; assert an unclaimed type never reaches `included`.
    assert.ok(false, 'TODO');
  });

  test.todo('AC9 — the membership decision consumes #234’s interpreter and does not re-implement it', function(assert) {
    // TODO: assert src/orm-request.ts resolves membership through
    // `createLinkageFilter` and that access-verdict.ts is byte-unchanged.
    assert.ok(false, 'TODO');
  });

  test.todo('AC11/X1c — #235’s static membership pin is re-specified, not deleted', function(assert) {
    // TODO: record the old assertion + its measurement, pin the boundary.
    assert.ok(false, 'TODO');
  });

  test.todo('AC11/R1c — #235’s nested-include selector pin is re-specified, not deleted', function(assert) {
    // TODO: the `angelaPets.length > 1` pin inverts under the subtree prune.
    assert.ok(false, 'TODO');
  });

  test.todo('AC11 — the four repaired inversions kept their NEGATIVE half', function(assert) {
    // TODO: companion-pair requirement — deleting a pin must not be a pass.
    assert.ok(false, 'TODO');
  });
});
