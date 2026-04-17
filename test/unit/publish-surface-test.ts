// @ts-nocheck
import QUnit from 'qunit';
import { execFile } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import { fileURLToPath } from 'url';

const exec = promisify(execFile);
const { module, test } = QUnit;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../..');

// Regression test for stonyx-orm#118.
//
// 0.3.1 shipped `config/environment.ts` because PR #110 renamed the consumer
// environment config from .js to .ts. Stonyx's module loader
// (stonyx/src/util/import-config.ts) does a dynamic import of the file from
// node_modules at runtime. Node refuses to type-strip inside node_modules, so
// even a TS file with zero type annotations fails to load, and consumer apps
// crash at parse time with the generic "must have a config/environment.{ts,js}"
// error out of stonyx/src/modules.ts:118.
//
// The published tarball must therefore always expose config/environment.js
// (not .ts) so Node can import it without type stripping.
module('[Unit] Publish Surface', function() {
  test('published tarball ships config/environment.js, not .ts', async function(assert) {
    const { stdout } = await exec('npm', ['pack', '--dry-run', '--json'], {
      cwd: repoRoot,
      maxBuffer: 10 * 1024 * 1024,
    });

    const packs = JSON.parse(stdout);
    assert.ok(Array.isArray(packs) && packs.length > 0, 'npm pack --dry-run returned a tarball manifest');

    const files = packs[0].files.map((f) => f.path);

    assert.ok(
      files.includes('config/environment.js'),
      'tarball includes config/environment.js (required for consumer bootstrap)'
    );
    assert.notOk(
      files.includes('config/environment.ts'),
      'tarball does NOT include config/environment.ts (Node cannot type-strip inside node_modules)'
    );
  });
});
