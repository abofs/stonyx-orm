// @ts-nocheck
/**
 * Tamper tests for the anti-recurrence extractor — abofs/stonyx-orm#265.
 *
 * The extractor in test/helpers/readme-sample-helper.ts is the sole input to
 * three separate guards. Quoted from the code, not from memory:
 *
 *  - "no reachable access() sample authorizes on a request URL"
 *    (test/integration/readme-sample-test.ts)
 *  - "every reachable access() sample declares the one-argument contract"
 *    (same file)
 *  - the per-sample file generation in test/integration/readme-access/setup.ts,
 *    which decides which bytes the behavioural harness boots.
 *
 * The first two titles say REACHABLE, not "packed", and the difference is not
 * wording: the population those two run over is the tarball's markdown UNION
 * every tracked .md, which is how docs/usage-patterns.md got covered.
 *
 * There is no "exactly one sample" tripwire any more. extractReadmeAccessSamples
 * returns every sample and throws only on zero — the case pinned by the last
 * test in this file, 'a README with no access() sample throws instead of passing
 * vacuously'. The count pin that replaced it lives in readme-sample-test.ts as
 * PROBED_README_MODELS, not here.
 *
 * A sample the extractor cannot see is a sample all three guards silently
 * approve.
 *
 * The tamper this file pins is the ADDITIVE one. Relabelling the existing
 * sample's fence fails closed (the extractor throws "found 0"), so the obvious
 * tamper was already caught and the guard looked trustworthy. Adding a second,
 * fail-open sample under a fence tag the extractor did not recognise shipped it
 * in the tarball with every assertion green — README.md's dominant tag is
 * ```javascript (19 opening fences) against ```js (12).
 *
 * Fence figures here are counted BLOCK-wise: 72 fence lines in README.md are 36
 * openers plus 36 closers, and a closing fence carries no info string by
 * CommonMark. A line-wise count reports one "unlabelled" fence per block and is
 * wrong by exactly the number of blocks.
 */
import QUnit from 'qunit';
import { findAccessSamples, extractReadmeAccessSamples } from '../helpers/readme-sample-helper.js';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const { module, test } = QUnit;

/** The shape of the defect #265 closes: authorizes on URL text, four-argument form. */
const FAIL_OPEN_SAMPLE = [
  'export default class EvilAccess {',
  "  models = ['owner'];",
  '  access(request, model, operation, record) {',
  "    if (request.url.endsWith('/owner/angela')) return false;",
  "    return ['read', 'create', 'update', 'delete'];",
  '  }',
  '}',
].join('\n');

/** A well-formed sample, so every fixture has something legitimate to find too. */
const GOOD_SAMPLE = [
  'export default class OwnerAccess {',
  "  models = ['owner'];",
  '  access(request) {',
  '    const { id } = request.params;',
  "    if (id === 'angela') return false;",
  "    return ['read'];",
  '  }',
  '}',
].join('\n');

function fenced(tag, code) {
  return '```' + tag + '\n' + code + '\n```\n';
}

/** Indents every non-blank line, the way a fence inside a list item is written. */
function indent(width, text) {
  const pad = ' '.repeat(width);

  return text.split('\n').map(line => (line === '' ? line : pad + line)).join('\n');
}

module('[Docs] access() sample extraction (#265)', function() {
  // Every tag a contributor could plausibly type on a JS/TS sample in a
  // TypeScript-first framework whose own scaffolder emits .ts.
  const TAGS = ['js', 'javascript', 'jsx', 'ts', 'typescript', 'tsx'];

  for (const tag of TAGS) {
    test(`an access() sample in a \`\`\`${tag} fence is visible to the guard`, function(assert) {
      const markdown = `# Doc\n\n${fenced(tag, GOOD_SAMPLE)}`;
      const found = findAccessSamples(markdown);

      assert.equal(found.length, 1, `\`\`\`${tag} fence yielded ${found.length} sample(s)`);
      assert.ok(found[0].includes('access(request)'), 'the sample body is returned intact');
    });

    test(`an ADDITIVE fail-open sample in a \`\`\`${tag} fence is not invisible`, function(assert) {
      // The good sample is always in a ```js fence — the one tag the pre-fix
      // extractor recognised — so this fixture reproduces the exact tamper:
      // the guard still finds the legitimate sample and reports itself healthy.
      const markdown = `# Doc\n\n${fenced('js', GOOD_SAMPLE)}\n${fenced(tag, FAIL_OPEN_SAMPLE)}`;
      const found = findAccessSamples(markdown);

      assert.equal(found.length, 2, `expected both samples, found ${found.length}`);
      assert.ok(
        found.some(code => code.includes('request.url')),
        'the fail-open URL predicate is among the samples the guard will iterate'
      );
      assert.ok(
        found.some(code => /access\s*\([^)]*,/.test(code)),
        "the four-argument form is among the samples the guard will iterate — #202's signature must not be documentable behind a fence tag"
      );
    });
  }

  // CommonMark permits a fence opener to carry up to three spaces of
  // indentation, and GitHub renders it as a code block — measured against
  // GitHub's own renderer (POST /markdown, mode: gfm), a 3-space-indented
  // ```js fence comes back as <div class="highlight highlight-source-js">.
  // A fence inside a numbered list step is indented by CONVENTION, so this
  // bypass is reachable by ordinary authoring rather than only by intent,
  // which makes it worse than a deliberate one: nothing signals it happened.
  // The repo already contains two of them — test/spike/RESULTS-166.md:83 and
  // :90, ```typescript blocks written as continuation lines of a numbered
  // list — which is why a column-0 anchor was measurably, not theoretically,
  // short of the documents the guard scans.
  //
  // The widths past 3 are NOT theoretical either, and the reason they are here
  // is that ` {0,3}` — the first correction, which cited CommonMark's
  // three-space allowance — was wrong about what that allowance measures. It is
  // relative to the CONTAINING BLOCK, not to the document. Inside a list item
  // the content column shifts right, so 4, 5 and 6 spaces are all still a fence
  // there. Measured against POST /markdown, a ```js fence written as a step of
  // a numbered list returns highlight-source-js at 3, 4 and 6 spaces and at one
  // leading TAB. A fail-open four-argument sample was demonstrated shipping in
  // the npm tarball at 4 spaces with the static guard, this extractor and the
  // behavioural harness all green at exit 0 — the third instance of that
  // signature on this PR. Hence: no cap at all, and these widths pin it.
  for (const width of [1, 2, 3, 4, 5, 6, 7, 8, 12, 20]) {
    test(`an ADDITIVE fail-open sample behind a ${width}-space-indented fence is not invisible`, function(assert) {
      const markdown = [
        '# Doc',
        '',
        fenced('js', GOOD_SAMPLE),
        '',
        indent(width, '```js\n' + FAIL_OPEN_SAMPLE + '\n```'),
        '',
      ].join('\n');

      const found = findAccessSamples(markdown);

      assert.equal(found.length, 2, `${width}-space indent: expected both samples, found ${found.length}`);
      assert.ok(
        found.some(code => code.includes('request.url')),
        'the indented fail-open URL predicate is among the samples the guard will iterate'
      );
      assert.ok(
        found.some(code => /access\s*\([^)]*,/.test(code)),
        'the four-argument form behind an indented fence is caught too'
      );
    });
  }

  test('a fence inside a numbered list step is scanned, and its indent is stripped', function(assert) {
    // The most ordinary way an indented fence occurs in real documentation.
    const markdown = [
      '# Doc',
      '',
      '1. Install it.',
      '',
      '2. Create the access class:',
      '',
      indent(3, '```js\n' + FAIL_OPEN_SAMPLE + '\n```'),
      '',
      '3. Boot.',
      '',
    ].join('\n');

    const found = findAccessSamples(markdown);

    assert.equal(found.length, 1, `the list-item sample is found — got ${found.length}`);
    assert.ok(found[0].includes('request.url'), 'and it is the fail-open one, so the guard will fail on it');

    // The harness writes these bytes to disk and boots them. The opener's
    // indent is markdown structure, not source, so it must not survive into
    // the generated class — CommonMark strips it and so does the scanner.
    assert.equal(found[0], FAIL_OPEN_SAMPLE, 'the captured code is the sample verbatim, with the fence indent removed');
  });

  test('a TAB-indented fence inside a list step is scanned, and its indent is stripped', function(assert) {
    // A tab is not a space run, so ` *` — the correction that closed columns
    // 4-6 — did not close this. It is the same axis and the same signature:
    // measured against GitHub's POST /markdown (mode: gfm), a ```js fence
    // indented by ONE TAB inside a numbered list step comes back as
    // <div class="highlight highlight-source-js">, while two tabs do not and a
    // tab at top level does not. So a single tab is the reachable spelling, and
    // it was invisible until FENCE_LINE's indent capture became [ \t]*.
    const body = FAIL_OPEN_SAMPLE.split('\n').map(line => '\t' + line).join('\n');
    const markdown = [
      '# Doc',
      '',
      '1. Create the access class:',
      '',
      '\t```js',
      body,
      '\t```',
      '',
      '2. Boot.',
      '',
    ].join('\n');

    const found = findAccessSamples(markdown);

    assert.equal(found.length, 1, `the tab-indented sample is found — got ${found.length}`);
    assert.equal(found[0], FAIL_OPEN_SAMPLE, 'the captured code is the sample verbatim, with the tab indent removed');
  });

  test('no indentation column hides a sample — the whole axis, not the columns that were reported', function(assert) {
    // The defect has moved column-wise three times (0 -> {0,3} -> any). Pinning
    // only the widths that were reported would invite a fourth. This asserts
    // the property the fix actually claims: there is NO indentation width at
    // which a fail-open sample in a list step becomes invisible, and the
    // captured bytes are the sample verbatim at every one of them, because the
    // harness boots exactly these bytes.
    const invisible = [];
    const notVerbatim = [];

    for (let width = 0; width <= 40; width += 1) {
      const markdown = [
        '# Doc',
        '',
        '1. Create the access class:',
        '',
        indent(width, '```js\n' + FAIL_OPEN_SAMPLE + '\n```'),
        '',
      ].join('\n');

      const found = findAccessSamples(markdown);

      if (found.length !== 1) invisible.push(width);
      else if (found[0] !== FAIL_OPEN_SAMPLE) notVerbatim.push(width);
    }

    assert.deepEqual(invisible, [], `every indentation width 0-40 yields the sample — invisible at [${invisible}]`);
    assert.deepEqual(notVerbatim, [], `every width strips its own indent exactly — not verbatim at [${notVerbatim}]`);
  });

  test('an indented NON-sample fence does not mis-pair the fences after it', function(assert) {
    // The mis-pairing half. An unrecognised opener makes the block's CLOSING
    // fence read as an opener, after which a later sample's opening fence is
    // read as a closer and the sample is never seen. Same defect class as the
    // spaced info string below, one axis over.
    const markdown = [
      '# Doc',
      '',
      // Opener indented, closer at column 0 — legal CommonMark, and the
      // shape that reproduces the mis-pairing: a column-0 anchor skips the
      // opener, then reads the CLOSER as an opener.
      '   ```bash',
      '   pnpm add @stonyx/orm',
      '```',
      '',
      'Prose between.',
      '',
      fenced('js', FAIL_OPEN_SAMPLE),
    ].join('\n');

    const found = findAccessSamples(markdown);

    assert.equal(found.length, 1, `the column-0 sample after an indented fence is still found — got ${found.length}`);
    assert.notOk(found.some(code => code.includes('Prose between.')), 'prose between blocks is not captured as code');
  });

  test('an info string with a space does not hide the sample, or mis-pair the fences', function(assert) {
    // ```js title="global-access.js" is a normal docs-tooling spelling. A
    // scanner that only accepts a single-word info string does not recognise
    // the opener, and then reads the CLOSING fence as an opener — so the sample
    // vanishes AND the prose after it is captured as if it were code.
    const markdown = [
      '# Doc',
      '',
      '```js title="global-access.js"',
      FAIL_OPEN_SAMPLE,
      '```',
      '',
      'Prose after.',
      '',
      fenced('bash', 'pnpm test'),
    ].join('\n');

    const found = findAccessSamples(markdown);

    assert.equal(found.length, 1, `the sample behind a spaced info string is found — got ${found.length}`);
    assert.ok(found[0].includes('request.url'), 'and it is the fail-open one, so the guard will fail on it');
    assert.notOk(found.some(code => code.includes('Prose after.')), 'prose between blocks is not captured as code');
  });

  test('a bare (unlabelled) fence carrying an access() sample is visible', function(assert) {
    // Not justified by a count in README.md: measured block-wise it has ZERO
    // unlabelled openers (36 openers: javascript 19, js 12, bash 5). An earlier
    // version of this comment claimed 35, which was the closing fences of the
    // 36 labelled blocks counted as openers — a line-wise census of `^```` `.
    //
    // The justification is that a bare fence is legal CommonMark, renders as a
    // code block on GitHub, and cannot be covered by any list of tags. Two of
    // them do exist in the scanned set, in docs/project-structure.md.
    const markdown = '# Doc\n\n```\n' + GOOD_SAMPLE + '\n```\n';

    assert.equal(findAccessSamples(markdown).length, 1, 'bare fence yielded a sample');
  });

  test('non-sample fences are still ignored', function(assert) {
    // Control: widening the fence tag must not widen WHAT counts as a sample.
    const markdown = [
      '# Doc',
      '',
      fenced('bash', 'pnpm add @stonyx/orm'),
      fenced('javascript', "import { store } from '@stonyx/orm';\nawait store.find('owner');"),
      fenced('json', '{ "models": ["owner"] }'),
    ].join('\n');

    assert.deepEqual(findAccessSamples(markdown), [], 'nothing that is not an access class is returned');
  });

  test('every sample is returned, so the harness boots every sample', async function(assert) {
    // This replaces a "throw unless there is exactly 1" tripwire. The intent was
    // right — an unmeasured second sample is the defect — but forbidding a
    // second sample is not the same as covering one, and the throw was silent
    // in the additive case anyway because the count stayed at 1.
    const dir = await mkdtemp(join(tmpdir(), 'orm-265-'));
    const path = join(dir, 'README.md');

    try {
      await writeFile(path, `# Doc\n\n${fenced('js', GOOD_SAMPLE)}\n${fenced('javascript', FAIL_OPEN_SAMPLE)}`, 'utf8');

      const samples = await extractReadmeAccessSamples(path);

      assert.equal(samples.length, 2, `both samples are returned — got ${samples.length}`);
      assert.deepEqual(samples.map(sample => sample.index), [0, 1], 'each carries a stable index, so setup.ts can name its generated file');
      assert.ok(
        samples.some(sample => sample.code.includes('request.url')),
        'the additive fail-open sample is one of them — it will be booted and measured, not silently shipped'
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('a README with no access() sample throws instead of passing vacuously', async function(assert) {
    // Non-vacuity control for every guard downstream: zero samples satisfies
    // "no packed sample authorizes on a URL" and "every packed sample declares
    // one argument" trivially.
    const dir = await mkdtemp(join(tmpdir(), 'orm-265-'));
    const path = join(dir, 'README.md');

    try {
      await writeFile(path, '# Doc\n\n' + fenced('js', "await store.find('owner', 'angela');"), 'utf8');

      let error;
      try {
        await extractReadmeAccessSamples(path);
      } catch (e) {
        error = e;
      }

      assert.ok(error, 'a README with no access() sample throws');
      assert.ok(/found 0/.test(error?.message ?? ''), `the throw names the count — got: ${error?.message}`);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
