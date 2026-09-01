// @ts-nocheck
//
// Static and source-level coverage for abofs/stonyx-orm#232 and #240.
//
// SCAFFOLD. Every assertion is `todo` until the fixtures and the fix land.
// `todo`, and never `assert.ok(true)`: a scaffold commit that reports green is
// indistinguishable from a finished one.
//
// WHY THESE ARE HERE AND NOT IN THE INTEGRATION FILE
//
//   - #240 AC8 asserts that three edits an engineer might reach for while
//     chasing a red were NOT made. An assertion that something is absent from a
//     file cannot live in that file.
//   - #232's disclosure ledger asserts that a documented limitation still
//     exists in README.md and docs/usage-patterns.md. Same reason.
//
import QUnit from 'qunit';

const { module } = QUnit;

module('[Unit] relationship route access -- source pins (#232, #240)', function() {
  QUnit.todo('#240 AC8/1 -- the sixth model was kept OUT of test/sample/db-schema.ts', function(assert) {
    assert.ok(false, 'scaffold: db-schema.ts declares exactly the five persisted collections');
  });

  QUnit.todo('#240 AC8/2 -- phone-number is still CLAIMED by GlobalAccess', function(assert) {
    assert.ok(false, 'scaffold: unclaiming it deletes route coverage');
  });

  QUnit.todo('#240 AC8/3 -- no `trait` deny rule was added to any of the three sample copies', function(assert) {
    assert.ok(false, 'scaffold: /traits is the suite designated unfiltered collection');
  });

  QUnit.todo('#232 AC10 -- the disclosure ledger: the per-record residual is stated in both shipped documents', function(assert) {
    assert.ok(false, 'scaffold: scoped to the CLAIM, not to a phrasing');
  });
});
