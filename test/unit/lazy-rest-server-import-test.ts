// @ts-nocheck
import QUnit from 'qunit';
import { spawnSync } from 'child_process';
import { existsSync, readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const { module, test } = QUnit;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../..');

const SENTINEL_CODE = 'ERR_ABSENT_OPTIONAL_PEER';
const REGISTER = './test/helpers/register-absent-optional-peer.mjs';
const PROBE = './test/helpers/probe-module-link.mjs';

// Import `target` in a child process where '@stonyx/rest-server' is made to
// resolve as ABSENT — the state a plain default `pnpm install` leaves an
// ORM-only consumer in, because the package is an OPTIONAL peer.
//
// Node links a module's entire STATIC import graph before evaluating any of it,
// so `code === SENTINEL_CODE` means the specifier is statically reachable from
// `target`; anything else means linking completed and only evaluation failed.
function linkUnderAbsentPeer(target: string) {
  const result = spawnSync(
    process.execPath,
    ['--import', REGISTER, PROBE, pathToFileURL(path.join(repoRoot, target)).href],
    { cwd: repoRoot, encoding: 'utf8' }
  );

  const line = (result.stdout || '').trim().split('\n').filter(Boolean).pop();
  if (!line) throw new Error(`probe produced no output for ${target}: ${result.stderr}`);
  return JSON.parse(line);
}

// Regression tests for stonyx-orm#280 — a recurrence of #200.
//
// '@stonyx/rest-server' is declared an OPTIONAL peer, but src/main.ts imported
// setup-rest-server.js STATICALLY, and that module's graph
// (setup-rest-server -> orm-request / meta-request) reaches
// '@stonyx/rest-server'. `optional: true` says the package manager need not
// install it; a static import says the runtime requires it unconditionally.
// Both cannot be true, and the result was ERR_MODULE_NOT_FOUND on
// `import('@stonyx/orm')` after a plain default install — an ORM-only consumer
// could not boot.
//
// MUTATION THESE TESTS DIE UNDER: restore the static
// `import setupRestServer from './setup-rest-server.js';` at the top of
// src/main.ts (and drop the `await import()` in the restServer guard). Test 1
// then reports code === 'ERR_ABSENT_OPTIONAL_PEER', and tests 3/4/5 fail on the
// source shape.
module('[Unit] Lazy rest-server import (#280)', function() {
  test('AC1 — the published entry graph links with the optional peer absent', function(assert) {
    assert.ok(existsSync(path.join(repoRoot, 'dist/index.js')), 'dist/index.js is built');

    const probe = linkUnderAbsentPeer('dist/index.js');

    assert.notStrictEqual(
      probe.code,
      SENTINEL_CODE,
      `dist/index.js must not statically reach '@stonyx/rest-server' (got: ${probe.message})`
    );
    assert.strictEqual(
      probe.outcome,
      'threw',
      'the probe reaches module evaluation (stonyx/config throws its own uninitialised-framework precondition)'
    );
    assert.ok(
      /Stonyx has not been initialized yet/.test(probe.message),
      `linking completed; only evaluation failed, on the framework precondition (got: ${probe.message})`
    );
  });

  test('AC1 control — the probe DOES catch a static reach, so test 1 can fail', function(assert) {
    // Sanity-control the harness: setup-rest-server.js legitimately imports the
    // peer at module scope. If this ever stops reporting the sentinel, the
    // absent-peer hook has stopped working and test 1 is vacuous.
    const probe = linkUnderAbsentPeer('dist/setup-rest-server.js');

    assert.strictEqual(
      probe.code,
      SENTINEL_CODE,
      'dist/setup-rest-server.js statically reaches the optional peer, and the probe reports it'
    );
  });

  test('AC1 — src/main.ts has no static import of setup-rest-server', function(assert) {
    const source = readFileSync(path.join(repoRoot, 'src/main.ts'), 'utf8');

    assert.notOk(
      /^\s*import\s[^\n]*\bfrom\s+['"]\.\/setup-rest-server\.js['"]/m.test(source),
      'src/main.ts does not import ./setup-rest-server.js at module scope'
    );
    assert.notOk(
      /^\s*import\s[^\n]*\bfrom\s+['"]@stonyx\/rest-server['"]/m.test(source),
      "src/main.ts does not import '@stonyx/rest-server' at module scope"
    );
  });

  test('AC2 — the REST path is still wired, behind the restServer.enabled guard', function(assert) {
    const source = readFileSync(path.join(repoRoot, 'src/main.ts'), 'utf8');
    const guard = source.indexOf("if (restServer.enabled === 'true') {");
    assert.notStrictEqual(guard, -1, "the `restServer.enabled === 'true'` guard is present");

    const block = source.slice(guard, source.indexOf('\n    }', guard));

    assert.ok(
      /await import\(['"]\.\/setup-rest-server\.js['"]\)/.test(block),
      'setup-rest-server.js is imported dynamically INSIDE the guard'
    );
    assert.ok(
      /setupRestServer\(restServer\.route, paths\.access, restServer\.metaRoute\)/.test(block),
      'the imported setup function is still invoked with (route, accessPath, metaRoute)'
    );
    assert.ok(
      /promises\.push\(setupRestServer\(/.test(block),
      'its promise is still pushed onto the init promise list, so Orm.ready still awaits it'
    );
  });

  test('AC3 — the lazy import matches the sibling optional-driver convention', function(assert) {
    const source = readFileSync(path.join(repoRoot, 'src/main.ts'), 'utf8');

    // The SQL/DynamoDB drivers are optional peers too and are already lazily
    // imported a few lines above, in the same method, in this exact shape.
    assert.ok(
      /const \{ default: DynamoDBDB \} = await import\(['"]\.\/dynamodb\/dynamodb-db\.js['"]\)/.test(source),
      'the reference convention (dynamodb driver) is still present'
    );
    assert.ok(
      /const \{ default: setupRestServer \} = await import\(['"]\.\/setup-rest-server\.js['"]\)/.test(source),
      'the rest-server import uses the same `const { default: X } = await import(...)` form'
    );
  });
});
