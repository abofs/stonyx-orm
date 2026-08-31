// @ts-nocheck
//
// abofs/stonyx-orm#202 — the tier-independent half.
//
// ---------------------------------------------------------------------------
// WHY ONLY TWO ACs LIVE HERE
//
// The refinement pins the validation tier per AC and it is not the
// implementer's to choose (#202, "Refinement — revised (Sprint 83)", §7):
// anything that depends on request shape runs over the LIVE express router,
// because `makeRequest` in test/unit/access-filter-enforcement-test.ts:95-116
// FABRICATES `baseUrl` and `path` from a url string it also invents, and
// `dispatch` (:119-125) calls `auth()` directly with no router at all. Variant 5
// survived four review rounds inside that harness and was found only by
// raw-socket measurement.
//
// So AC1, AC2, AC3, AC5, AC7, AC8, AC9 and the integration half of AC4 are in
// test/integration/orm-test.ts, module 'Access Context and Registry (#202)'.
//
// What is left is what genuinely does not depend on the router:
//   AC4 (unit half) — the context object's own shape: `record` is absent.
//   AC6 (static)    — the two copies a consumer actually sees document the
//                     second argument.
// ---------------------------------------------------------------------------
//
// SCAFFOLD ONLY at this commit: every assertion is a QUnit.todo stub.
//
import QUnit from 'qunit';

const { module } = QUnit;

module('[Unit] access() context argument (#202)', function() {
  QUnit.todo('AC4 — the auth-time context carries no `record` key', function(assert) {
    // TODO: an earlier draft of the issue proposed { model, operation, record }
    // and it was refuted: @stonyx/rest-server src/request.ts:58-60 runs auth()
    // after route matching but BEFORE any handler, so nothing has been fetched.
    assert.ok(false, 'not implemented');
  });

  QUnit.todo('AC6 — src/orm-request.ts documents the second argument, its keys and the four-verb vocabulary', function(assert) {
    // TODO: NET-NEW text only. Explicitly NOT satisfied by the #201 warning
    // block or the five-variant table, both of which already exist.
    assert.ok(false, 'not implemented');
  });

  QUnit.todo('AC6 — README.md documents the second argument, its keys, and that `record` is absent and why', function(assert) {
    assert.ok(false, 'not implemented');
  });
});
