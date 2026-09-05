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

// Every runtime module a consumer can reach through the published `exports`
// map, DERIVED FROM package.json rather than listed here.
//
// A hand-written list is what let this defect through twice: the first version
// of this test pinned `dist/index.js` alone, and a static peer import added to
// src/exports/db.ts left the whole suite green while `@stonyx/orm/db` threw
// ERR_MODULE_NOT_FOUND out of the tarball. Driving the enumeration off the
// manifest means a subpath added later is covered without anyone remembering to
// come back here.
//
// The `types` condition is skipped: .d.ts files are erased before runtime and
// are never linked by Node. Everything else in the condition tree is a real
// runtime target and is probed.
function collectExportTargets() {
  const pkg = JSON.parse(readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));
  const targets: { subpath: string; condition: string; target: string }[] = [];

  function walk(node: unknown, subpath: string, condition: string) {
    if (typeof node === 'string') {
      targets.push({ subpath, condition, target: node });
      return;
    }
    if (!node || typeof node !== 'object') return;

    for (const [key, value] of Object.entries(node)) {
      if (key === 'types') continue;
      walk(value, subpath, condition ? `${condition}.${key}` : key);
    }
  }

  for (const [subpath, node] of Object.entries(pkg.exports ?? {})) walk(node, subpath, '');

  return { subpaths: Object.keys(pkg.exports ?? {}), targets };
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
// MUTATIONS THESE TESTS DIE UNDER:
//  1. restore the static `import setupRestServer from './setup-rest-server.js';`
//     at the top of src/main.ts (and drop the `await import()` in the guard) —
//     test 1 reports the sentinel for the '.' subpath, and tests 4/5/6 fail on
//     the source shape;
//  2. add `import '@stonyx/rest-server';` to the top of ANY module reachable
//     from ANY published subpath — e.g. src/exports/db.ts or src/hooks.ts —
//     test 1 reports the sentinel for that subpath. Measured; see PR #283.
module('[Unit] Lazy rest-server import (#280)', function() {
  test('AC1 — every published `exports` subpath links with the optional peer absent', function(assert) {
    const { targets } = collectExportTargets();

    for (const { subpath, condition, target } of targets) {
      const where = `${subpath} (${condition}) -> ${target}`;

      assert.ok(existsSync(path.join(repoRoot, target)), `${where} is built`);

      const probe = linkUnderAbsentPeer(target);

      assert.notStrictEqual(
        probe.code,
        SENTINEL_CODE,
        `${where} must not statically reach '@stonyx/rest-server' (got: ${probe.message})`
      );
    }
  });

  test('AC1 — the subpath enumeration is complete and non-vacuous', function(assert) {
    const { subpaths, targets } = collectExportTargets();

    // If `exports` is ever restructured into a shape this walker does not
    // understand, the loop above goes silently empty and stops guarding
    // anything. Fail here instead.
    assert.ok(subpaths.length > 0, `package.json declares ${subpaths.length} export subpaths`);

    for (const subpath of subpaths) {
      assert.ok(
        targets.some(t => t.subpath === subpath),
        `subpath ${subpath} produced at least one probed runtime target`
      );
    }

    assert.ok(
      targets.every(t => t.target.startsWith('./dist/')),
      'every probed target resolves into ./dist (i.e. these are the packed files)'
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

  test('AC1 — the `bin` entry point links with the optional peer absent', function(assert) {
    // `bin` is published too, and it is NOT in `exports`, so the loop above
    // cannot reach it. It is probed separately rather than through the probe
    // module because importing it RUNS the CLI (it prints help and exits), so
    // its stdout is not the probe's JSON. Linking still happens before any of
    // that, so a static reach dies with the sentinel on stderr.
    const pkg = JSON.parse(readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));
    const bin = pkg.bin?.['stonyx-orm'];
    assert.ok(typeof bin === 'string' && bin.length > 0, `package.json declares bin ${bin}`);

    const run = (entry: string) =>
      `${spawnSync(process.execPath, ['--import', REGISTER, entry], { cwd: repoRoot, encoding: 'utf8' }).stderr}`;

    // Control for THIS invocation path — it does not go through the probe
    // module, so it needs its own proof that the resolve hook is installed and
    // that the assertion below could fail.
    assert.ok(
      run('./dist/setup-rest-server.js').includes(SENTINEL_CODE),
      'control: the same invocation DOES report the sentinel for a module that statically reaches the peer'
    );

    const stderr = run(bin);
    const hit = stderr.split('\n').find(line => line.includes(SENTINEL_CODE)) ?? '';

    assert.notOk(
      stderr.includes(SENTINEL_CODE),
      `${bin} must not statically reach '@stonyx/rest-server' (${hit.trim()})`
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

  test('AC3 — setup-rest-server.js is the only dist module whose laziness is load-bearing', function(assert) {
    // The invariant is NOT "every optional dependency is imported in this exact
    // shape" — the SQL/DynamoDB drivers are lazily imported here too, but that
    // is not what isolates THEIR peers: `src/*/db.ts` carries no peer specifier
    // at all, and the isolation lives one layer down in `src/*/connection.ts`.
    // setup-rest-server.js is different: it names the peer through its own
    // static graph, so the `await import()` in Orm.init() is the only thing
    // keeping '@stonyx/rest-server' off the entry graph.
    const source = readFileSync(path.join(repoRoot, 'src/main.ts'), 'utf8');

    assert.ok(
      /const \{ default: setupRestServer \} = await import\(['"]\.\/setup-rest-server\.js['"]\)/.test(source),
      'setup-rest-server.js is reached through `const { default: X } = await import(...)`'
    );

    const probe = linkUnderAbsentPeer('dist/setup-rest-server.js');
    assert.strictEqual(
      probe.code,
      SENTINEL_CODE,
      'and it does name the optional peer statically — which is why that import must stay lazy'
    );
  });
});
