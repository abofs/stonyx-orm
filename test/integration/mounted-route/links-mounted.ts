// @ts-nocheck
/**
 * JSON API links at a non-default REST mount — abofs/stonyx-orm#254
 *
 * SCAFFOLD. Every test below is a TODO stub; they are filled in by the
 * commits that follow.
 *
 * Filename note: this file deliberately does NOT end in `-test.ts`. The main
 * suite's glob is `test/**\/*-test.ts`; if this file matched it, the module
 * would boot inside the default-route process (route '/'), seed records into
 * the shared store and break `orm-test.ts`. It is instead run by its own
 * QUnit process via the `test:mounted` script, chained inside `pnpm test`.
 *
 * The mount route is a boot-time global (Stonyx is a singleton), so each row
 * of the AC3 route matrix is a separate process, driven by ORM_TEST_ROUTE.
 */
import QUnit from 'qunit';

const { module, test } = QUnit;

module('[Integration] Mounted-route JSON API links', function() {
  module('AC1 — every advertised link is followable at a non-default mount', function() {
    test('TODO: all 10 link values from the 6 emission sites return 200 and identify the claimed resource', function(assert) {
      assert.ok(false, 'TODO');
    });
  });

  module('AC2 — the link equals the URL that produced the response', function() {
    test('TODO: links.self === {origin}{mount}{path} for collection, resource, related and linkage routes', function(assert) {
      assert.ok(false, 'TODO');
    });
  });

  module('AC3 — the prefix tracks configuration, not a constant', function() {
    test('TODO: harness mount for ORM_TEST_ROUTE is validated by a 200 before it is used as an expectation', function(assert) {
      assert.ok(false, 'TODO');
    });
  });

  module('AC4 — default-route output is byte-identical', function() {
    test('TODO: replay test/sample/links-golden.json at route "/" and assert byte equality', function(assert) {
      assert.ok(false, 'TODO');
    });
  });

  module('AC5 — link builder and mount registrar cannot drift', function() {
    test('TODO: route "/api/" — discover the real mount, then assert the AC1 fixed point against it', function(assert) {
      assert.ok(false, 'TODO');
    });
  });

  // AC6 is documentation (README.md, docs/project-structure.md) and is verified
  // by reviewer diff, not by a test. It is named here so the AC inventory is
  // complete in one place, and deliberately not dressed up as an execution AC.
});
