// @ts-nocheck
import QUnit from 'qunit';

const { module, test } = QUnit;

// Regression tests for stonyx-orm#280 (recurrence of #200).
//
// `@stonyx/rest-server` is declared an OPTIONAL peer dependency, but the ORM
// entry graph (src/index.ts -> src/main.ts -> src/setup-rest-server.ts ->
// src/orm-request.ts / src/meta-request.ts) imports it STATICALLY. Those two
// statements cannot both be true: `optional: true` tells the package manager it
// need not install the package, while the static import requires it
// unconditionally. The result is ERR_MODULE_NOT_FOUND on `import('@stonyx/orm')`
// after a plain default `pnpm install` -- an ORM-only consumer cannot boot.
module('[Unit] Lazy rest-server import (#280)', function() {
  test('TODO AC1: no module reachable from the dist entry graph statically imports @stonyx/rest-server', function(assert) {
    assert.ok(false, 'TODO: walk dist/index.js static import graph, assert @stonyx/rest-server is absent');
  });

  test('TODO AC1b: src/main.ts does not statically import setup-rest-server', function(assert) {
    assert.ok(false, 'TODO: assert src/main.ts imports setup-rest-server via await import() inside the restServer.enabled guard');
  });

  test('TODO AC2: setup-rest-server is still resolved and invoked when restServer.enabled === "true"', function(assert) {
    assert.ok(false, 'TODO: assert the conditional block awaits the dynamic import and calls the default export');
  });

  test('TODO AC3: the lazy import follows the existing driver lazy-import convention', function(assert) {
    assert.ok(false, 'TODO: assert the dynamic import destructures { default: ... } like the dynamodb driver import');
  });
});
