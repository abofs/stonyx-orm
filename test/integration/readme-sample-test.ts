// @ts-nocheck
/**
 * Every access() sample that reaches a consumer — abofs/stonyx-orm#265.
 *
 * The behavioural measurement of the README sample lives in
 * test/integration/readme-access/, which boots a server on those exact bytes.
 * This file covers the two things that measurement cannot see:
 *
 *  1. The population. `test/sample/` is not in the tarball and `README.md` is,
 *    so the file set is enumerated from `npm pack --dry-run` rather than from a
 *    grep of the working tree — a sample added to a second packed document
 *    would otherwise ship unmeasured, which is exactly how this shipped.
 *
 *  2. The contract. `access()` takes one argument on this line; the four-argument
 *     form is abofs/stonyx-orm#202's and stays reverted. A sample documenting it
 *     would not run.
 */
import QUnit from 'qunit';
import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import { findAccessSamples } from '../helpers/readme-sample-helper.js';

const { module, test } = QUnit;

const execFileAsync = promisify(execFile);

/**
 * The models README's access() samples declare, and which
 * test/integration/readme-access probes byte-for-byte.
 *
 * This replaces the "throw unless there is exactly ONE sample" tripwire that
 * `extractReadmeAccessSamples` used to carry. That tripwire was removed for a
 * good reason — forbidding a second sample is not the same as covering one, and
 * it blocked the numeric-id sample that closes half of #265 — but it did
 * accidentally provide a property nothing replaced. Measured: appending a third
 * README sample that grants everything unconditionally for a model no probe
 * touches gives `test:readme` 33/33 and this guard 6/6, all green, with the
 * sample extracted and BOOTED (generated/readme-access-2.js).
 *
 * Both static checks below are satisfied by such a sample: it names no URL
 * property and it takes one argument. "Boot every sample" is only coverage for
 * models something asserts on.
 *
 * So this pins the SET, not the count. A new sample is allowed — it just has to
 * arrive with a probe, or with a deliberate edit to this line. Additive-safe,
 * and it does not reinstate the ban.
 */
const PROBED_README_MODELS = ['animal', 'owner'];

/** Properties that carry the client's raw URL text. None is safe to authorize on. */
const URL_PROPERTIES = /\b(?:request|req)\.(?:url|originalUrl|baseUrl|path)\b/;

/**
 * Strip comments before applying URL_PROPERTIES.
 *
 * The rule is about what a sample AUTHORIZES on, not about which words appear
 * near it. Applied to raw lines the guard forbade the single most useful thing
 * an author could write next to the sample — the inline caution "do NOT use
 * request.url here, it is mount-relative" — which is a true statement and the
 * whole point of the fix. A ban on phrasings eventually bans a true statement.
 *
 * Quote-aware so `'http://example.com'` is not truncated at the `//`, which
 * would let a real `request.url` later on the same line escape the check.
 */
function stripComments(code) {
  let out = '';
  let quote = null;
  let index = 0;

  while (index < code.length) {
    const char = code[index];
    const next = code[index + 1];

    if (quote) {
      if (char === '\\') { out += char + (next ?? ''); index += 2; continue; }
      if (char === quote) quote = null;
      out += char;
      index += 1;
      continue;
    }

    if (char === '"' || char === "'" || char === '`') { quote = char; out += char; index += 1; continue; }

    if (char === '/' && next === '/') {
      while (index < code.length && code[index] !== '\n') index += 1;
      continue;
    }

    if (char === '/' && next === '*') {
      index += 2;
      while (index < code.length && !(code[index] === '*' && code[index + 1] === '/')) index += 1;
      index += 2;
      continue;
    }

    out += char;
    index += 1;
  }

  return out;
}

/** Files npm would put in the tarball, straight from npm's own enumeration. */
async function packedFiles() {
  // --ignore-scripts: `npm pack` runs prepare/prepack/postpack, and this repo's
  // prepublishOnly is `npm test`, so the enumeration already runs inside the
  // publish path. There are no such scripts today; adding one should not make
  // this call recursive. The file list is unaffected by the flag.
  const { stdout } = await execFileAsync('npm', ['pack', '--dry-run', '--json', '--ignore-scripts'], {
    cwd: process.cwd(),
    maxBuffer: 32 * 1024 * 1024,
  });

  return JSON.parse(stdout)[0].files.map(file => file.path);
}

/**
 * Markdown tracked in the repo, from git's own index rather than a directory
 * walk — the same reason the packed set comes from npm's enumeration.
 *
 * This is the SECOND population. The packed set contains exactly two markdown
 * files (LICENSE.md and README.md), so a guard scoped to it structurally cannot
 * fail on docs/** — and docs/usage-patterns.md carried the identical fail-open
 * sample through the fix that repaired the README, because nothing read it.
 * docs/index.md is what routes a reader browsing GitHub to access control.
 */
async function trackedMarkdown() {
  const { stdout } = await execFileAsync('git', ['ls-files', '-z', '--', '*.md'], {
    cwd: process.cwd(),
    maxBuffer: 32 * 1024 * 1024,
  });

  return stdout.split('\0').filter(Boolean);
}

module('[Docs] reachable access() samples (#265)', function(hooks) {
  let packed;
  let tracked;
  let samples;

  hooks.before(async function() {
    packed = await packedFiles();
    tracked = await trackedMarkdown();

    // Collect every access() sample from every markdown document a reader can
    // reach — the tarball a consumer installs, and the repo they browse.
    const documents = new Map();

    for (const path of packed.filter(file => file.endsWith('.md'))) documents.set(path, 'packed');
    for (const path of tracked) documents.set(path, documents.has(path) ? 'packed' : 'repo');

    samples = [];

    for (const [path, population] of documents) {
      const markdown = await readFile(path, 'utf8');
      for (const code of findAccessSamples(markdown)) samples.push({ path, code, population });
    }
  });

  test('the packed file set is what it claims to be', function(assert) {
    // Guards the checks below against passing vacuously on an empty enumeration.
    assert.ok(packed.length > 0, `npm pack enumerated ${packed.length} files`);
    assert.ok(packed.includes('README.md'), 'README.md is packed — consumers read it');
    assert.notOk(
      packed.some(file => file.startsWith('test/')),
      'nothing under test/ is packed — test/sample/ cannot serve as consumer documentation'
    );
  });

  test('the repo markdown set is what it claims to be', function(assert) {
    // Non-vacuity for the docs/** half: without this, deleting docs/ or a
    // silently-failing `git ls-files` would make every check below pass.
    assert.ok(tracked.length > 0, `git enumerated ${tracked.length} tracked markdown file(s)`);
    assert.ok(tracked.includes('docs/usage-patterns.md'), 'docs/usage-patterns.md is in the scanned set — it carried the third copy of the defect');
    assert.ok(tracked.includes('docs/project-structure.md'), 'docs/project-structure.md is in the scanned set');
  });

  test('at least one access() sample is reachable, in each population', function(assert) {
    // The checks below are satisfied by an empty sample list; this is the
    // control that says there was something to check — in BOTH populations,
    // because a docs-only regression must not hide behind a healthy README.
    const byPopulation = { packed: 0, repo: 0 };
    for (const { population } of samples) byPopulation[population] += 1;

    assert.ok(byPopulation.packed > 0, `found ${byPopulation.packed} packed access() sample(s)`);
    assert.ok(byPopulation.repo > 0, `found ${byPopulation.repo} repo-only access() sample(s)`);
  });

  test('the README samples declare exactly the models the harness probes', function(assert) {
    const readmeSamples = samples.filter(sample => sample.path === 'README.md');

    // Non-vacuity: an empty list satisfies the deepEqual below only if the
    // manifest is empty too, but say it out loud rather than relying on that.
    assert.ok(readmeSamples.length > 0, `found ${readmeSamples.length} README access() sample(s)`);

    const declared = [];

    for (const { code } of readmeSamples) {
      const match = code.match(/\bmodels\s*=\s*\[([^\]]*)\]/);

      assert.ok(match, 'every README sample declares a models array');

      for (const entry of (match?.[1] ?? '').split(',')) {
        const name = entry.trim().replace(/^['"`]|['"`]$/g, '');

        if (name) declared.push(name);
      }
    }

    assert.deepEqual(
      [...declared].sort(),
      [...PROBED_README_MODELS].sort(),
      `README's samples declare [${[...declared].sort()}]; the harness probes [${[...PROBED_README_MODELS].sort()}]. ` +
      'A sample for an unprobed model is booted and never measured — add a probe in ' +
      'test/integration/readme-access/readme-sample.ts, then add the model to PROBED_README_MODELS.'
    );

    // Duplicate models are a distinct failure with the same symptom. Two samples
    // claiming one model throw in src/setup-rest-server.ts:34 — but line 39
    // catches it and downgrades it to log.error, so the second class is silently
    // dropped and every class registered before the throw stays mounted. Ordered
    // after the good one it is 33/33 green; ordered before it, 14 fail. The
    // static layer has to own this, because the behavioural layer is
    // order-dependent.
    assert.equal(
      new Set(declared).size,
      declared.length,
      `no two README samples declare the same model — got [${declared}]; a duplicate registration is swallowed into a log.error and the later sample never mounts`
    );
  });

  test('no reachable access() sample authorizes on a request URL', function(assert) {
    for (const { path, code, population } of samples) {
      const offending = stripComments(code).split('\n').filter(line => URL_PROPERTIES.test(line));

      assert.deepEqual(
        offending,
        [],
        `${path} (${population}): sample must not read a URL property — request.url is mount-relative and originalUrl is raw client text`
      );
    }
  });

  test('an honest inline caution about request.url is still allowed', function(assert) {
    // The rule bans authorizing on a URL, not mentioning one. Guards the
    // stripComments() carve-out above against being quietly removed.
    const withCaution = [
      "export default class OwnerAccess {",
      "  models = ['owner'];",
      "  access(request) {",
      "    // Do NOT use request.url here — it is mount-relative.",
      "    const { id } = request.params;",
      "    return id === 'angela' ? false : ['read'];",
      "  }",
      "}",
    ].join('\n');

    assert.deepEqual(
      stripComments(withCaution).split('\n').filter(line => URL_PROPERTIES.test(line)),
      [],
      'a commented caution naming request.url does not trip the guard'
    );

    // Control: the guard still fires on the real thing, on the same input shape.
    const authorizing = withCaution.replace(
      "const { id } = request.params;",
      "if (request.url.endsWith('/owners/angela')) return false;"
    );

    assert.equal(
      stripComments(authorizing).split('\n').filter(line => URL_PROPERTIES.test(line)).length,
      1,
      'an actual request.url predicate is still caught'
    );
  });

  test('every reachable access() sample declares the one-argument contract', function(assert) {
    for (const { path, code } of samples) {
      const signature = code.match(/\baccess\s*\(([^)]*)\)/);

      assert.ok(signature, `${path}: sample declares an access() method`);

      const parameters = signature[1].split(',').map(part => part.trim()).filter(Boolean);

      assert.deepEqual(
        parameters.length,
        1,
        `${path}: access() takes exactly one argument — got (${signature[1]})`
      );
    }
  });
});
