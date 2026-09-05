// @ts-nocheck
/**
 * Every access() sample the fence scanner can see, in every document that
 * reaches a consumer — abofs/stonyx-orm#265.
 *
 * SCOPE, STATED HONESTLY, BECAUSE THE FIRST CLAUSE USED TO READ "every access()
 * sample that reaches a consumer" AND THAT IS NOT WHAT THIS MEASURES. The
 * population below is an APPROXIMATION of the code blocks a consumer copies. It
 * is whatever test/helpers/readme-sample-helper.ts enumerates, and that helper
 * matches FENCE_LINE against one line at a time with no block context — it is
 * not a CommonMark parser. Two holes are measured and open at this commit:
 *
 *  - A blockquote-prefixed fence (`> ```js`) renders as highlighted JS on
 *    GitHub — measured against POST /markdown — and is invisible here. A
 *    fail-open sample written that way passes every assertion in this file.
 *  - A bare fence indented four or more spaces is read as a CLOSER, which flips
 *    fence pairing for the rest of the document. Reproduced at this head: a
 *    ```markdown block whose body shows a 4-space-indented bare fence, followed
 *    by a four-argument `request.url` sample in an UNLABELLED fence — 1 sample
 *    seen at 1c0dade, 0 seen at 5ebc40a, and with that sample appended to
 *    README.md this file is 8 pass / 0 fail at exit 0 while README.md ships it.
 *    A LABELLED (```js) sample after the same flip is still seen at both heads,
 *    so the exposure is confined to unlabelled fences.
 *
 * Both are latent — zero such constructs exist in the 18 tracked markdown files
 * today — and both belong to abofs/stonyx-orm#279, whose terminus is reconciling
 * this enumeration against a real CommonMark parser rather than widening the
 * regex a fifth time. Until #279 lands, read every green result here as "no
 * fail-open sample in the spellings this scanner reaches", not as "none".
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
import { pluralize } from '@stonyx/utils/string';

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
 *
 * ONE-DIRECTIONAL, AND NOW IT IS NOT. As first written this was a hardcoded
 * literal and nothing verified the harness still probed it, so it caught
 * "sample added without a probe" and was blind to "probe removed while the
 * sample stays" — the direction that quietly re-opens #265's numeric-id half.
 * Measured: emptying the ALIASES loop in the probe source deletes all eleven
 * numeric-id probes, and `test:readme` goes 33 -> 22 while this guard stays 7/7,
 * both green at exit 0. Coverage drops by a third in silence. That is #262's
 * class one step over: not a silent skip, a silent deletion.
 *
 * The close is below, and it reaches less far than "the request targets it
 * actually sends". The probe source is read as TEXT, and the set is derived from
 * the request-target LITERALS in that text. Against a mutation that removes the
 * literals — emptying the ALIASES array — the manifest, the README and the
 * harness must agree three ways rather than two, and this file reds. Against a
 * mutation that detaches the probes while leaving the literals standing, it does
 * not. See probedTargetCounts below for that measurement, and #279 for the
 * follow-up.
 */
const PROBED_README_MODELS = ['animal', 'owner'];

/** The harness whose probes this file pins. Read as text; it runs in another process. */
const PROBE_SOURCE = 'test/integration/readme-access/readme-sample.ts';

/**
 * How many request targets the harness sends per model.
 *
 * Set equality alone does not close the deletion direction: emptying the
 * ALIASES loop removes eleven probes while `/animals/8`, `/animals/007` and the
 * rest survive elsewhere in the file, so the derived SET is still
 * [animal, owner] and nothing notices. The count is what notices.
 *
 * These are occurrence counts of `/<plural>` request targets in PROBE_SOURCE
 * with comments stripped, so prose that merely mentions a route does not
 * inflate them. They are a floor on coverage, not a description of it — a
 * deliberate edit is the point. If you delete a probe on purpose, change the
 * number in the same commit and the diff will say what you gave up.
 */
// Raised from { animal: 20, owner: 11 } in the #270 fix round. The pin had not
// been moved when this PR added three probes (`GET /owners/ANGELA`,
// `DELETE /owners/ANGELA`, `GET /animals/0X7`), so the floor carried three
// probes of slack and every one of them could be deleted with the guard green.
// Measured with this file's own extractor over PROBE_SOURCE at that head:
// actual { animal: 21, owner: 13 } against a pin of { animal: 20, owner: 11 }.
const PROBED_TARGET_COUNTS = { animal: 21, owner: 13 };

/**
 * Request-target LITERALS present in PROBE_SOURCE, per model.
 *
 * This counts SOURCE TEXT. It does not count requests the harness sends, and the
 * two come apart. Comments are stripped first: `// GET /animals/7 used to 200`
 * is documentation, not a probe, and counting it would let a real probe be
 * deleted and replaced by a sentence about it.
 *
 * WHAT IT DOES NOT SEE. A literal that no longer reaches the network still
 * counts. Measured at this head: replacing the alias loop's iterable with `[]`
 * while keeping the array alive above it (`const RETIRED = ALIASES;`) deletes
 * all eleven numeric-id probes — `test:readme` goes 33 -> 22 — and this file
 * stays 8 pass / 0 fail at exit 0. The control says the check is not vacuous:
 * emptying the ALIASES array itself, which takes the literals with it, reds it
 * at 7 pass / 1 fail, rc=1, on `the harness still probes what the pin says it
 * probes`. So the floor closes deletion-by-removal and leaves
 * deletion-by-detachment open. Not fixed here — the cheap close is to stop
 * measuring a proxy (assert the readme suite's own test count, or have the
 * harness write its probe list out and read that); tracked on #279.
 *
 * WHICH pluralize THIS IS. `@stonyx/utils/string`'s, which is NOT the function
 * that builds the routes. Routes come from `getPluralName()`
 * (src/plural-registry.ts), which prefers a model's static `pluralName` and
 * otherwise calls src/utils.ts's dasherize-aware wrapper. Measured divergence on
 * `access-link`: the base function returns `access-link` unchanged, while
 * src/utils.ts's wrapper and `getPluralName` both return `access-links`; with
 * `pluralName = 'magic-links'` registered, `getPluralName` returns
 * `magic-links` and the base function still returns `access-link`. Both models
 * pinned here — `animal`, `owner` — are single-segment with no override, so the
 * two agree today and these counts are correct. A dasherized or overridden model
 * added to PROBED_README_MODELS would match no route segment and be counted
 * zero. test/unit/model-plural-name-test.ts:3 imports the route-building pair;
 * this file does not, and that is a latent gap rather than a current miscount.
 */
function probedTargetCounts(source, models) {
  const code = source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map(line => line.replace(/(^|\s)\/\/.*$/, ''))
    .join('\n');

  const routeToModel = new Map(models.map(model => [`/${pluralize(model)}`, model]));
  const counts = {};
  const TARGET = /(?:['"`]|\$\{origin\})(\/[a-z][a-z0-9-]*)(?:\/[^'"`\s]*)?/g;

  let match;

  while ((match = TARGET.exec(code))) {
    const model = routeToModel.get(match[1]);

    if (model) counts[model] = (counts[model] ?? 0) + 1;
  }

  return counts;
}

/** Properties that carry the client's raw URL text. None is safe to authorize on. */
const URL_PROPERTIES = /\b(?:request|req)\.(?:url|originalUrl|baseUrl|path)\b/;

/**
 * An id-coercion expression — abofs/stonyx-orm#270.
 *
 * A documented `access()` sample must contain NO id arithmetic. Before #270 the
 * samples hand-copied `isNaN(id) ? id : parseInt(id)` out of the framework's
 * module-private `getId()`, and were correct only for as long as they happened
 * to match it character for character. Nothing held them together: changing the
 * README's arithmetic reddened a test, while changing the framework's left 961
 * assertions green with a protected record disclosed and destroyed.
 *
 * The remedy is that there is nothing to copy — `access()` is handed
 * `request.recordId`, already normalised — so the rule is that the arithmetic
 * must not reappear, in either direction.
 *
 * Paired with MENTIONS_ID so that arithmetic on something OTHER than an id
 * (a page size, an age filter) is not swept up. Both must match on one line.
 */
const ID_COERCION = /\b(?:parseInt|parseFloat|Number|isNaN)\s*\(/;
const MENTIONS_ID = /\bid\b|Id\b/i;

/**
 * Every remaining id-coercion site in the repo, with the reason it is still
 * there. AC-5 of #270: one implementation, and any site not on this list is a
 * new hand-copy.
 *
 * KEYED BY `path:line`, NOT BY PATH. The earlier form keyed by path, which gave
 * every allowlisted FILE whole-file amnesty — and the worst-placed of those
 * files is `src/orm-request.ts`, which owns `getId()` and `auth()` and is the
 * file #270 was filed against.
 *
 * Measured on the path-keyed form, at head, twice by two reviewers and again
 * here before this change: a brand-new hand-rolled normaliser added inside
 * `src/orm-request.ts` —
 *
 *   function reviewerAddedBadNormaliser(rawId?: string): string | number {
 *     if (!rawId) return '';
 *     if (isNaN(rawId as unknown as number)) return rawId;
 *
 *     return parseInt(rawId);
 *   }
 *
 * — left this test at 11 pass / 0 fail, rc=0, with AC-5 reading `ok`. The same
 * code in a non-allowlisted file reds by name. The docblock claimed "any site
 * not on this list is a new hand-copy"; that was only ever true of an unknown
 * FILE. Line keys make the claim and the measurement the same statement.
 *
 * COST, STATED SO IT IS NOT DISCOVERED: inserting or deleting lines above one
 * of these sites moves it, and this guard then reds on the `stale` assertion
 * with the new coordinates in the message. That is the same deliberate-edit
 * property PROBED_TARGET_COUNTS carries — the fix is to paste the coordinates
 * the failure prints, in the commit that moved them, so the diff records it.
 *
 * The three persistence-path entries are NOT approved duplicates — they are the
 * same divergence one layer over, and they already differ from the normaliser
 * by omitting its `if (!id) return ''` guard. They were split out of #270
 * deliberately: they sit on the persistence path rather than the authorization
 * path, and two of them cannot be verified without a live MySQL/Postgres, so
 * folding them into a priority-critical security fix would have put unverifiable
 * adapter edits inside it. Tracked as #282; delete the entry when #282 lands.
 *
 * NOT AN EXHAUSTIVE ENUMERATION OF ID MATCHING. `ID_COERCION` matches coercion
 * FUNCTION CALLS. `src/view-resolver.ts:208` (`r.id === id || r.id == id`) is
 * the same permissive dual-match family, sits on the request resolution path
 * via `src/store.ts`, and is structurally invisible here because it coerces
 * with `==`. Recorded on #282, not fixed here.
 */
const KNOWN_COERCION_SITES = {
  // The one implementation. Everything else delegates to it.
  'src/normalize-record-id.ts:85': 'the canonical normaliser (#270) — the isNaN guard',
  'src/normalize-record-id.ts:87': 'the canonical normaliser (#270) — the parseInt, deliberately without a radix',

  // Split out of #270 — the create-response and SQL-persist paths. Each of
  // these normalises a RESPONSE id (`response?.data?.id`), not a URL id.
  'src/orm-request.ts:524': 'create-response path duplicate — split out of #270, tracked as #282',
  'src/postgres/postgres-db.ts:523': 'persist path duplicate — split out of #270, tracked as #282',
  'src/mysql/mysql-db.ts:450': 'persist path duplicate — split out of #270, tracked as #282',

  // Not a copy of the normaliser, and — the load-bearing half — NOT ON ANY
  // REQUEST PATH: `src/cli.ts` is its only importer in `src/`, so no route, no
  // access() and nothing downstream of getId() reaches it. It also matches a
  // row by EITHER spelling (`r.id === id || r.id === Number(id)`) rather than
  // resolving one canonical key, so it produces no key to disagree about.
  'src/standalone-db.ts:113': 'standalone JSON db `get` dual-match — no request path, not a resolution normaliser',
  'src/standalone-db.ts:159': 'standalone JSON db `delete` dual-match — no request path, not a resolution normaliser',
};

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

      // Newlines inside a block comment are PRESERVED. Dropping them shortens
      // the stripped text and every line index computed from it is then a
      // fiction: measured at the head of this PR, the canonical normaliser's
      // two coercion lines — in a file whose header comment is longer than its
      // code — were reported as `:6` and `:8`, some sixty lines early. Nothing
      // depended on the number until AC-5's allowlist became line-keyed, at
      // which point a wrong number is a guard that cannot be satisfied.
      // Pinned by the 'the reported line number is the REAL source line'
      // control below.
      while (index < code.length && !(code[index] === '*' && code[index + 1] === '/')) {
        if (code[index] === '\n') out += '\n';
        index += 1;
      }

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

/**
 * The tracked access() samples that are SOURCE rather than markdown.
 *
 * From git's index for the same reason the markdown population is: a directory
 * walk sees files git does not, and misses the question being asked.
 */
async function sourceAccessSampleFiles() {
  const { stdout } = await execFileAsync('git', ['ls-files', '-z', '--', 'test/sample/access'], {
    cwd: process.cwd(),
    maxBuffer: 32 * 1024 * 1024,
  });

  return stdout.split('\0').filter(Boolean).filter(file => /\.(?:ts|js|mjs|cjs)$/.test(file));
}

module('[Docs] reachable access() samples (#265)', function(hooks) {
  let packed;
  let tracked;
  let samples;
  let probeSource;

  hooks.before(async function() {
    packed = await packedFiles();
    tracked = await trackedMarkdown();
    probeSource = await readFile(PROBE_SOURCE, 'utf8');

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

  test('the harness still probes what the pin says it probes', function(assert) {
    // The other direction. The assertion above pins README's samples to a
    // manifest; this pins the manifest to the harness's SOURCE TEXT, so the two
    // cannot drift apart in either direction. Without it the manifest is a
    // restatement, and a restatement cannot notice the thing it restates being
    // deleted. Text, not traffic — see probedTargetCounts for what that misses.
    const counts = probedTargetCounts(probeSource, PROBED_README_MODELS);

    assert.deepEqual(
      Object.keys(counts).sort(),
      [...PROBED_README_MODELS].sort(),
      `${PROBE_SOURCE} carries request-target literals for [${Object.keys(counts).sort()}]; ` +
      `PROBED_README_MODELS names [${[...PROBED_README_MODELS].sort()}]. ` +
      'A model in the pin with no probe left is a sample that boots and is never measured.'
    );

    // Set equality is not enough on its own — deleting the eleven numeric-id
    // aliases leaves other /animals/ targets standing, so the set is unchanged
    // and only the count moves. This is the assertion that fails when the alias
    // LITERALS are deleted rather than renamed. It does not fire when the
    // literals stay and the loop that sends them is detached; that gap is
    // measured in probedTargetCounts's docblock and tracked on #279.
    for (const model of PROBED_README_MODELS) {
      const expected = PROBED_TARGET_COUNTS[model];

      assert.ok(
        typeof expected === 'number',
        `PROBED_TARGET_COUNTS has no entry for '${model}' — add one rather than letting the model go uncounted`
      );

      assert.ok(
        (counts[model] ?? 0) >= expected,
        `${PROBE_SOURCE} carries ${counts[model] ?? 0} '${pluralize(model)}' request-target literal(s); the pin requires at least ${expected}. ` +
        'Probe literals were deleted. If that was deliberate, lower PROBED_TARGET_COUNTS in the same commit so the diff says what coverage was given up.'
      );
    }
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

  test('AC-4 (#270) — no reachable access() sample contains id arithmetic', function(assert) {
    for (const { path, code, population } of samples) {
      const offending = stripComments(code)
        .split('\n')
        .filter(line => ID_COERCION.test(line) && MENTIONS_ID.test(line));

      assert.deepEqual(
        offending,
        [],
        `${path} (${population}): sample must not normalise an id itself — access() is handed request.recordId, already resolved (#270)`
      );
    }
  });

  test('AC-4 (#270) — control: the id-arithmetic rule fires on a real hand-copy and not on prose about one', function(assert) {
    // Same two-sided shape the URL rule carries. Without the first half the
    // guard would ban the sentence explaining the fix; without the second it
    // could be silently satisfied by a sample that still coerces.
    const withCaution = [
      "export default class OwnerAccess {",
      "  models = ['owner'];",
      "  access(request) {",
      "    // Do NOT write isNaN(id) ? id : parseInt(id) here — the ORM already did it.",
      "    const { recordId } = request;",
      "    return recordId === 'angela' ? false : ['read'];",
      "  }",
      "}",
    ].join('\n');

    assert.deepEqual(
      stripComments(withCaution).split('\n').filter(line => ID_COERCION.test(line) && MENTIONS_ID.test(line)),
      [],
      'a commented caution naming parseInt does not trip the guard'
    );

    const coercing = withCaution.replace(
      "const { recordId } = request;",
      "const recordId = isNaN(request.params.id) ? request.params.id : parseInt(request.params.id);"
    );

    assert.equal(
      stripComments(coercing).split('\n').filter(line => ID_COERCION.test(line) && MENTIONS_ID.test(line)).length,
      1,
      'an actual hand-copied normalisation IS caught'
    );

    // And the shape that would slip past a parseInt-only rule.
    const numberForm = withCaution.replace(
      "const { recordId } = request;",
      "const recordId = Number(request.params.id);"
    );

    assert.equal(
      stripComments(numberForm).split('\n').filter(line => ID_COERCION.test(line) && MENTIONS_ID.test(line)).length,
      1,
      'a Number()-spelled normalisation is caught too'
    );

    // Non-vacuity in the other direction: arithmetic that is NOT about an id
    // must not be swept up, or the rule becomes a ban on arithmetic.
    const unrelated = withCaution.replace(
      "const { recordId } = request;",
      "const pageSize = parseInt(request.query.limit);"
    );

    assert.deepEqual(
      stripComments(unrelated).split('\n').filter(line => ID_COERCION.test(line) && MENTIONS_ID.test(line)),
      [],
      'coercion of something that is not an id does not trip the guard'
    );
  });

  test('AC-5 (#270) — one normaliser: no id-coercion expression outside the known sites', async function(assert) {
    // Run as an assertion rather than by hand, because a grep somebody
    // remembers to run is not a guard. Enumerated from git's index for the same
    // reason the packed set comes from npm's: a directory walk sees files git
    // does not, and misses the question being asked.
    const { stdout } = await execFileAsync('git', ['ls-files', '-z', '--', 'src', 'README.md', 'docs', 'test/sample'], {
      cwd: process.cwd(),
      maxBuffer: 32 * 1024 * 1024,
    });

    const files = stdout.split('\0').filter(Boolean);

    // Non-vacuity: an empty or failed enumeration satisfies every assertion below.
    assert.ok(files.length > 10, `git enumerated ${files.length} file(s) in the scanned set`);
    assert.ok(files.includes('src/normalize-record-id.ts'), 'the canonical normaliser is in the scanned set');
    assert.ok(files.includes('README.md'), 'README.md is in the scanned set');
    assert.ok(files.includes('test/sample/access/global-access.ts'), 'the reference access sample is in the scanned set');

    const found = [];

    for (const path of files) {
      const contents = await readFile(path, 'utf8');
      const lines = stripComments(contents).split('\n');

      lines.forEach((line, index) => {
        if (ID_COERCION.test(line) && MENTIONS_ID.test(line)) found.push({ path, line: index + 1, text: line.trim() });
      });
    }

    // Control: the scanner must be able to SEE the one site we know exists,
    // or a zero result means nothing.
    assert.ok(
      found.some(hit => hit.path === 'src/normalize-record-id.ts'),
      `the scanner found the canonical normaliser itself — ${found.length} site(s) total`
    );

    // `path:line`, not `path`. Keyed by path, a second normaliser added
    // ANYWHERE inside an allowlisted file is invisible — measured green for a
    // brand-new hand-copy inside src/orm-request.ts, the file #270 was filed
    // against. See KNOWN_COERCION_SITES.
    const unexpected = found
      .filter(hit => !(`${hit.path}:${hit.line}` in KNOWN_COERCION_SITES))
      .map(hit => `${hit.path}:${hit.line}  ${hit.text}`);

    assert.deepEqual(
      unexpected,
      [],
      'every id-coercion expression is either the canonical normaliser or a site explicitly split out of #270 (see #282) — a new one here is a new hand-copy. ' +
      'If a listed site simply MOVED, update its line in KNOWN_COERCION_SITES in the same commit that moved it.'
    );

    // And the list does not rot: an entry whose site no longer coerces — or no
    // longer sits on that line — should be corrected in the same commit that
    // moved or fixed it.
    const foundKeys = new Set(found.map(hit => `${hit.path}:${hit.line}`));
    const stale = Object.keys(KNOWN_COERCION_SITES).filter(key => !foundKeys.has(key));

    assert.deepEqual(
      stale,
      [],
      'no stale entries in KNOWN_COERCION_SITES — delete an entry when its site is fixed, or re-point it when the line moves. ' +
      `Sites actually found: [${[...foundKeys].sort().join(', ')}]`
    );

    // CONTROL for the line keys themselves. A line-keyed allowlist is only
    // meaningful if the number is a real source line, and until this commit it
    // was not: stripComments discarded the newlines inside block comments, so
    // src/normalize-record-id.ts:71 was reported as :6. Read each allowlisted
    // coordinate out of the RAW file — no stripping — and require that the line
    // it names actually carries an id coercion.
    for (const key of Object.keys(KNOWN_COERCION_SITES)) {
      const separator = key.lastIndexOf(':');
      const filePath = key.slice(0, separator);
      const lineNumber = Number(key.slice(separator + 1));
      const rawLine = (await readFile(filePath, 'utf8')).split('\n')[lineNumber - 1];

      assert.ok(
        rawLine !== undefined && ID_COERCION.test(rawLine) && MENTIONS_ID.test(rawLine),
        `${key} names a REAL source line that coerces an id — raw line reads: ${JSON.stringify(rawLine)}`
      );
    }
  });

  test('every reachable access() sample declares the one-argument contract', async function(assert) {
    // The population is markdown samples PLUS the tracked source samples under
    // test/sample/access. Markdown alone was measured to be too narrow:
    // changing `access(request)` to `access(request, context)` in
    // test/sample/access/global-access.ts — the sample a contributor reads and
    // the file `test:reference` actually boots — left the main glob 916/0
    // green, while the same edit in README.md redded this test. A contract
    // guard that cannot see the reference implementation of the contract is
    // not covering it.
    //
    // #202 will make this signature additive by design; when it does, this is
    // the assertion whose deliberate edit records the change.
    const sourceSamples = [];

    for (const path of await sourceAccessSampleFiles()) {
      sourceSamples.push({ path, code: await readFile(path, 'utf8'), population: 'source' });
    }

    // Non-vacuity: an empty enumeration satisfies the loop below.
    assert.ok(sourceSamples.length > 0, `git enumerated ${sourceSamples.length} source access sample(s) under test/sample/access`);
    assert.ok(
      sourceSamples.some(sample => sample.path === 'test/sample/access/global-access.ts'),
      'the reference access sample is in the arity population'
    );
    assert.ok(samples.length > 0, `${samples.length} markdown access sample(s) in the arity population`);

    for (const { path, code } of [...samples, ...sourceSamples]) {
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
