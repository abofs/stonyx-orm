// @ts-nocheck
import QUnit from 'qunit';
import { existsSync, readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const { module, test } = QUnit;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../..');

// Regression test for stonyx-orm#118.
//
// 0.3.1 shipped `config/environment.ts` because PR #110 renamed the consumer
// environment config from .js to .ts. Stonyx's module loader
// (stonyx/src/util/import-config.ts) does a dynamic import of the file from
// node_modules at runtime. Node refuses to type-strip inside node_modules, so
// a TS file in a published package crashes consumer apps at parse time. The
// repo must therefore always carry `config/environment.js` and never
// `config/environment.ts`, and `package.json#files` must include the `config`
// directory so the file makes it into the published tarball.
module('[Unit] Publish Surface', function() {
  test('config/environment.js exists and .ts does not', function(assert) {
    assert.ok(
      existsSync(path.join(repoRoot, 'config/environment.js')),
      'config/environment.js exists (required for consumer bootstrap)'
    );
    assert.notOk(
      existsSync(path.join(repoRoot, 'config/environment.ts')),
      'config/environment.ts does NOT exist (Node cannot type-strip inside node_modules)'
    );
  });

  test('package.json#files publishes the config directory', function(assert) {
    const pkg = JSON.parse(readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));
    const files = Array.isArray(pkg.files) ? pkg.files : [];
    assert.ok(
      files.includes('config'),
      'package.json#files includes "config" (ensures config/environment.js ships)'
    );
  });
});
