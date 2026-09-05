// @ts-nocheck
/**
 * Tamper tests for the anti-recurrence extractor — abofs/stonyx-orm#265.
 *
 * The extractor in test/helpers/readme-sample-helper.ts is the sole input to
 * three separate guards: "no packed access() sample authorizes on a request
 * URL", "every packed access() sample declares the one-argument contract", and
 * the "exactly one sample" tripwire that decides which bytes the behavioural
 * harness boots. A sample the extractor cannot see is a sample all three guards
 * silently approve.
 *
 * The tamper this file pins is the ADDITIVE one. Relabelling the existing
 * sample's fence fails closed (the extractor throws "found 0"), so the obvious
 * tamper was already caught and the guard looked trustworthy. Adding a second,
 * fail-open sample under a fence tag the extractor did not recognise shipped it
 * in the tarball with every assertion green — README.md's dominant tag is
 * ```javascript (18 occurrences) against ```js (12).
 */
import QUnit from 'qunit';
import { findAccessSamples, extractReadmeAccessSample } from '../helpers/readme-sample-helper.js';
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

  test('a bare (unlabelled) fence carrying an access() sample is visible', function(assert) {
    // README.md has 35 unlabelled fences; a sample in one of them ships too.
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

  test('the "exactly one sample" tripwire fires on an additive javascript-fenced sample', async function(assert) {
    const dir = await mkdtemp(join(tmpdir(), 'orm-265-'));
    const path = join(dir, 'README.md');

    try {
      await writeFile(path, `# Doc\n\n${fenced('js', GOOD_SAMPLE)}\n${fenced('javascript', FAIL_OPEN_SAMPLE)}`, 'utf8');

      let error;
      try {
        await extractReadmeAccessSample(path);
      } catch (e) {
        error = e;
      }

      assert.ok(error, 'a second population throws instead of booting the good sample and reporting green');
      assert.ok(
        /found 2/.test(error?.message ?? ''),
        `the throw names the real count — got: ${error?.message}`
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
