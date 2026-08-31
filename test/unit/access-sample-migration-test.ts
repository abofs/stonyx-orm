// @ts-nocheck
//
// abofs/stonyx-orm#222 — migrate the access sample and its five duplicated
// copies to the `{ model, operation }` contract.
//
// SCAFFOLD ONLY. Every test below is a stub; the implementation lands in the
// commits that follow. Specification: the refinement comment on #213
// (https://github.com/abofs/stonyx-orm/issues/213#issuecomment-5485842043),
// §"213b", and the #222 issue body.
//
// ---------------------------------------------------------------------------
// WHY A NEW FILE RATHER THAN ONLY EDITING THE PINNED ONES
//
// Three of #222's seven assertions are *about* assertions that live in other
// files (the arity pin in test/integration/orm-test.ts, assertion 46's
// extractor and the one-argument harness at :73 in
// test/unit/access-filter-enforcement-test.ts). An assertion that a pin still
// exists cannot live in the same file as the pin: deleting both would be a
// silent pass. These are cross-file static assertions and they live here.
//
// The two live-router assertions (2's router checks, 4's `/owners/archived`
// 403) stay in test/integration/orm-test.ts, because a fabricated request is
// exactly the harness variant 5 survived four review rounds inside.
// ---------------------------------------------------------------------------
import QUnit from 'qunit';

const { module, test } = QUnit;

module('[Unit] access sample migrated to the { model, operation } contract (#222)', function() {
  test('AC1/1 — the shipped fixture declares two parameters (no default)', function(assert) {
    assert.ok(false, 'TODO(#222): new GlobalAccess().access.length === 2');
  });

  test('AC3/2 — companion: the integration arity pin still exists, and is now inverted to 2', function(assert) {
    assert.ok(false, 'TODO(#222): orm-test.ts pins getAccess(\'animal\').length === 2, and this asserts that pin is present');
  });

  test('AC3/3 — assertion 46 is re-anchored on the two-argument literal, not loosened', function(assert) {
    assert.ok(false, 'TODO(#222): extractor anchors the exact literal and still hard-guards start !== -1');
  });

  test('AC1/5 — the sample body drops baseUrl/originalUrl and KEEPS request.path', function(assert) {
    assert.ok(false, 'TODO(#222): the /archived deny survives; a context-only migration reds here');
  });

  test('AC3/6 — the unit harness at :73 supplies a real { model, operation }', function(assert) {
    assert.ok(false, 'TODO(#222): :73 is no longer `request => globalAccess.access(request)`');
  });

  test('AC3/7 — the variant-5 raw-socket integration test is annotated as now-vacuous', function(assert) {
    assert.ok(false, 'TODO(#222): orm-test.ts:1521-1578 must not read as live coverage of a pattern the sample no longer uses');
  });
});
