// @ts-nocheck
//
// SCAFFOLD — abofs/stonyx-orm#203. Test stubs only; assertions land in the
// following commits. Structure first so every AC has a home before any
// production line moves.
//
// ---------------------------------------------------------------------------
// WHY THIS FILE EXISTS AT ALL
//
// Measured by the refinement and re-measured here: the shipped suite scores
// 951 pass / 0 fail on `dev`, and a naive `Math.max` fix to
// src/manage-record.ts:217-219 ALSO scores 951 pass / 0 fail. There is no
// assertion anywhere in the repo on `assignRecordId`'s id selection, so a bad
// fix ships green — and the naive fix additionally regresses a no-id create on
// a string-id model from 'bob1' to 'NaN' without turning anything red.
//
// The deliverable of #203 is therefore the COVERAGE, not the fix. Each test
// below names the production mutation that kills it.
// ---------------------------------------------------------------------------
//
// ASSERTION LABELS, borrowed from test/unit/access-filter-enforcement-test.ts
// so the two files read the same way:
//
//   [DEFECT] — observed FAILING against unfixed dev. Evidence of #203.
//   [GUARD]  — passes on dev today; fails under a specific WRONG fix. Proves
//              the fix did not overshoot or recreate a neighbouring defect.
//              Proves NOTHING about #203 and is labelled so no reader mistakes
//              it for evidence.
//
import QUnit from 'qunit';

const { module, test } = QUnit;

module('[Unit] assignRecordId — server-assigned id selection (#203)', function() {
  test('[DEFECT] AC1 — a server-assigned id is the max + 1 and the create grows the store', function(assert) {
    assert.ok(true, 'SCAFFOLD — route sequence + programmatic descending tail + defined route status');
  });

  test('[DEFECT] AC2 — a NaN / non-numeric store key cannot poison the selection', function(assert) {
    assert.ok(true, 'SCAFFOLD — [9400-band, NaN] store, no-id create must not land on NaN');
  });

  test('[GUARD] AC3 — a no-id create on a string-id model still gets a usable id', function(assert) {
    assert.ok(true, 'SCAFFOLD — owner [gina, bob], assigned id must not be "NaN"');
  });

  test('[GUARD] AC4 — the occupancy guard is evaluated on the LANDING key', function(assert) {
    assert.ok(true, 'SCAFFOLD — owner "1" must not be overwritten by a no-id create');
  });

  test('AC5 — negative controls: the existing contracts survive', function(assert) {
    assert.ok(true, 'SCAFFOLD — ascending store grows; client-supplied duplicate is last-entry-wins; SQL pending negatives');
  });

  test('[DEFECT] AC6 — an explicit id: 0 is honoured and not reassigned', function(assert) {
    assert.ok(true, 'SCAFFOLD — id 0 must land under store key 0');
  });
});
