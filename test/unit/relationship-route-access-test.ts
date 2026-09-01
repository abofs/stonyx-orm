// @ts-nocheck
//
// Source-level pins for abofs/stonyx-orm#232 and #240.
//
// WHY THESE ARE HERE AND NOT IN THE FILES THEY ARE ABOUT
//
//   - #240 AC8 asserts that three edits an engineer might reach for while
//     chasing a red were NOT made. An assertion that something is absent from a
//     file cannot live in that file, and an assertion that a pin still exists
//     cannot live beside the pin -- deleting both would be a silent pass.
//   - #232's inversion repairs each moved to a permitted subject and kept the
//     denied one in the same test. Nothing inside those tests can tell the
//     difference between "repaired as a pair" and "narrowed to the half that
//     passes", so the negative halves are asserted from here.
//   - #232's disclosure ledger asserts that a documented limitation still
//     exists in two shipped-and-unshipped documents. Same reason.
//
// EVERY ASSERTION BELOW IS A [GUARD]. None failed against pre-fix `dev` --
// there was nothing to fail, because the things they pin did not exist yet.
// Each one therefore names the mutation that kills it, and each named mutation
// was constructed and observed before this file was accepted.
//
import QUnit from 'qunit';
import GlobalAccess from '../sample/access/global-access.js';

const { module, test } = QUnit;

const ACCESS_SIGNATURE = '  access(request, { model, operation, recordId }) {';

async function readRepoFile(relativePath) {
  const { readFile } = await import('node:fs/promises');

  return readFile(new URL(relativePath, import.meta.url), 'utf8');
}

// STRIP COMMENTS BEFORE SEARCHING FOR CODE. Every pin in this file asserts
// something about CODE, and every file it reads carries long comment blocks
// that quote the very strings being searched for -- so an unstripped search is
// satisfied by a commented-out needle, and commenting out is a cheaper tamper
// than deleting. This is the `//` counterpart of the ledger's `stripComments`.
function withoutLineComments(source) {
  return source
    .split('\n')
    .filter(line => !line.trim().startsWith('//'))
    .join('\n');
}

// The same extraction test/unit/access-sample-migration-test.ts performs.
function accessCodeLines(source, label) {
  const start = source.indexOf(ACCESS_SIGNATURE);
  if (start === -1) throw new Error(`${label} does not contain ${ACCESS_SIGNATURE.trim()}`);
  const end = source.indexOf('\n  }', start);
  if (end === -1) throw new Error(`${label}'s access() method is not closed`);

  return withoutLineComments(source.slice(start, end))
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
    .join('\n');
}

function fencedSample(source, label) {
  const start = source.indexOf('export default class GlobalAccess');
  if (start === -1) throw new Error(`${label} does not carry the GlobalAccess sample`);

  return source.slice(start, source.indexOf('\n```', start));
}

module('[Unit] relationship route access -- source pins (#232, #240)', function() {
  test('[GUARD] #240 AC8/1 -- the sixth model was kept OUT of test/sample/db-schema.ts', async function(assert) {
    // MEASURED COST OF GETTING THIS WRONG: adding `tags = hasMany('tag')` to
    // the schema is 6 reds across two files -- three in
    // test/integration/db-directory-test.ts and three in orm-test.ts, one of
    // them the exact-key schema pin in `file stores expected schema
    // structure`. Out of the schema it is 0. Cited by TEST NAME rather than by
    // line, and the reason is that the number was wrong twice: it read `:41`,
    // the test header was `:42` at the merge base, and this pull request's own
    // 12-line `before`-hook insertion moved it to `:53` at the head that ships.
    //
    // KILLING MUTATION: add `tags = hasMany('tag');` to test/sample/db-schema.ts.
    // Both assertions red (and so do the six above).
    const source = await readRepoFile('../sample/db-schema.ts');
    const declared = [...source.matchAll(/^\s*(\w+)\s*=\s*hasMany\(/gm)].map(match => match[1]);

    assert.deepEqual(declared, ['owners', 'animals', 'traits', 'categories', 'phoneNumbers'],
      'the schema declares exactly the five persisted collections');
    assert.notOk(/\btag\b/.test(source),
      'and does not mention `tag` at all -- an unclaimed model is deliberately not persisted');
  });

  test('[GUARD] #240 AC8/2 -- phone-number is still CLAIMED, and nothing was unclaimed to build fixture 2', function(assert) {
    // UNCLAIMING `phone-number` is the other cheap-looking way to construct "a
    // model claimed by no access class", and it DELETES ROUTE COVERAGE: the
    // /phone-numbers routes stop being mounted. Fixture 2 adds a sixth model
    // instead, so the five claimed models are untouched.
    //
    // KILLING MUTATION: remove 'phone-number' from GlobalAccess.models.
    assert.deepEqual(new GlobalAccess().models.slice().sort(),
      ['animal', 'category', 'owner', 'phone-number', 'trait'],
      'the five claimed models are exactly the five that were always claimed');
    assert.notOk(new GlobalAccess().models.includes('tag'),
      'and `tag` is NOT among them -- that is the whole of fixture 2');
  });

  test('[GUARD] #240 AC8/3 -- no `trait` deny rule was added to any of the three sample copies', async function(assert) {
    // `/traits` is this suite's designated UNFILTERED collection. It is
    // load-bearing for TWO stories: #190's GATE-0 scoping guard ("an unfiltered
    // collection still answers 409") and #234's AC7 cache guard, which counts
    // getAccess calls per type. A per-record filter on `trait` was measured at
    // 6 reds. It is the obvious-looking vehicle for a hidden-child fixture and
    // it is the wrong one.
    //
    // KILLING MUTATION: add `if (model === 'trait') return record => record.id !== 3;`
    // to any of the three copies. That copy's assertion reds -- and so do the
    // six named above.
    const copies = [
      ['the shipped fixture', await readRepoFile('../sample/access/global-access.ts')],
      ['the README sample', fencedSample(await readRepoFile('../../README.md'), 'README.md')],
      ['the docs/usage-patterns.md sample', fencedSample(await readRepoFile('../../docs/usage-patterns.md'), 'docs/usage-patterns.md')],
    ];

    for (const [label, source] of copies) {
      const code = accessCodeLines(source, label);

      assert.notOk(code.includes("model === 'trait'"), `${label}'s access() body carries no trait rule`);
      // AND THE FIXTURE THAT WAS ACTUALLY CHOSEN IS PRESENT, in all three, so
      // this is not satisfiable by a sample with no hidden-child fixture at all.
      assert.ok(code.includes('record.id !== 18'),
        `${label} carries the #240 hidden-child vehicle -- animal 18, whose owner is permitted`);
    }
  });

  test('[GUARD] #232 -- the four repaired inversions kept their NEGATIVE half', async function(assert) {
    // Each of the four tests #232 inverted moved to a permitted subject and
    // asserted the denied one in the SAME test. From inside those tests a
    // deletion of the negative half is indistinguishable from a test that was
    // always about the permitted case -- it just goes green. So it is pinned
    // from here.
    //
    // KILLING MUTATIONS, BOTH CONSTRUCTED AND OBSERVED:
    //   delete any one of the four negative halves from
    //     test/integration/orm-test.ts  -> that repair's assertion reds while
    //     the integration suite stays fully green (measured 1014 / 1)
    //   COMMENT any one of them out     -> also red, and this is the tamper the
    //     first two versions of this pin missed. Read raw, the file still
    //     CONTAINS the needle inside a `//` line, so all four negative halves
    //     could be commented out at once and this stayed green at 1015 / 0.
    //     Commenting out is cheaper than deleting and is exactly what an
    //     engineer chasing a red reaches for. The ledger assertion below has
    //     always stripped `<!-- -->` for the same reason; this one now strips
    //     `//` through the same helper `accessCodeLines` uses.
    const source = withoutLineComments(await readRepoFile('../integration/orm-test.ts'));

    // KEYED ON EACH REPAIR'S OWN ASSERTION MESSAGE, ONE NEEDLE PER REPAIR.
    //
    // THE FIRST VERSION OF THIS PIN DID NOT WORK AND THE MUTATION IS WHY IT WAS
    // REPLACED. It counted occurrences of the URL `/animals/1/owner` and
    // required at least two. There are THREE in the file -- the two repairs and
    // an unrelated `links` comparison in #234 AC6 -- so deleting one repair's
    // negative half left two and the pin stayed green. Measured: 1015 / 0 with
    // the tamper applied. A count threshold over a needle that other code also
    // matches is a threshold over the wrong population.
    const negatives = [
      ['is withheld here too (was: 200 with full attributes)', 'GET /animals/:id/owner'],
      ['is withheld on the linkage route too (was: 200 with', 'GET /animals/:id/relationships/owner'],
      ['with no document for the denied related resource', 'GET related resource response includes links.self'],
      ['with no linkage object for the denied target', 'GET relationship linkage response includes links.self and links.related'],
    ];

    for (const [needle, testName] of negatives) {
      assert.ok(source.includes(needle), `${testName} keeps its denied-subject assertion`);
    }

    // And the permitted subjects really did move, so this is not satisfiable by
    // a repair that left the original assertion in place and appended to it.
    assert.ok(source.includes("assert.equal(data.id, 'gina', 'returns correct owner');"),
      'the related-resource test asserts on the PERMITTED owner');
    assert.notOk(source.includes("assert.equal(data.id, 'angela', 'returns correct owner');"),
      'and no longer pins the hidden one as correct behaviour -- inverted, not duplicated');
  });

  test('[GUARD] #232 -- the disclosure ledger: the per-record limit is stated in both documents', async function(assert) {
    // WHAT THIS PINS, AND WHAT IT DELIBERATELY DOES NOT.
    //
    // It pins the CLAIM, not the English. The only fixed string is a short
    // bolded LABEL that names the limit; everything else about the paragraph is
    // free to be rewritten. This repo has already had a phrasing ban forbid a
    // true statement (a tree-wide ban on `remains open` blocked an honest
    // disclosure of a newly found residual), so there is no `notOk` on any
    // wording here -- only a positive requirement that the claim is present and
    // has substance.
    //
    // TAMPERS TESTED, both constructed and observed rather than reasoned about:
    //   delete the paragraph          -> the label assertions red
    //   wrap it in an HTML comment    -> also red, because HTML comments are
    //                                    STRIPPED before the search; a
    //                                    commented-out disclosure is not a
    //                                    disclosure, and comment-out is the
    //                                    cheaper tamper than deletion
    //   keep the label, gut the body  -> the `recordId` window assertion reds
    //
    // NOT TESTED, and said so rather than implied: this cannot detect a
    // disclosure that is present, uncommented and WRONG.
    const LABEL = '**Per-record denies for a related resource are not expressible.**';

    // STRIPPED TO A FIXED POINT, NOT IN ONE PASS, AND THE SINGLE PASS WAS
    // BYPASSABLE RATHER THAN MERELY UNTIDY.
    //
    // This read `source.replace(/<!--[\s\S]*?-->/g, '')` -- one pass. CodeQL
    // flags that shape as `js/incomplete-multi-character-sanitization` because
    // deleting an inner match can splice the surrounding text into a NEW
    // opener, and here that is a live hole in this very ledger. Measured, with
    // LABEL as the needle:
    //
    //     '<!<!-- -->-- ' + LABEL + ' ... -->'
    //
    //   one pass  -> '<!-- ' + LABEL + ' ... -->'   indexOf(LABEL) FINDS it
    //   fixed pt  -> ''                             indexOf(LABEL) is -1
    //
    // The tampered document is a genuine HTML comment start to finish, so
    // GitHub renders nothing and a consumer sees no disclosure. MEASURED OVER
    // THE LIVE SUITE, with that wrap applied to README.md's copy of the
    // disclosure: single-pass helper -> 1031 / 0, this test GREEN; fixed-point
    // helper -> 1030 / 1, this test RED. That is exactly the tamper the block
    // above claims to catch ("wrap it in an HTML comment -> also red"), so the
    // claim was false for one spelling of the wrap and is true now.
    //
    // BEHAVIOUR-NEUTRAL ON THE REAL INPUTS, measured rather than assumed:
    // single-pass output === fixed-point output on both documents at this
    // head, byte for byte (111346 and 25098 characters, unchanged from raw --
    // neither file carries an HTML comment today, which is why only the tamper
    // path distinguishes the two forms).
    const stripComments = source => {
      let previous;

      do {
        previous = source;
        source = source.replace(/<!--[\s\S]*?-->/g, '');
      } while (source !== previous);

      return source;
    };

    const documents = [
      ['README.md', stripComments(await readRepoFile('../../README.md'))],
      ['docs/usage-patterns.md', stripComments(await readRepoFile('../../docs/usage-patterns.md'))],
    ];

    for (const [label, source] of documents) {
      const at = source.indexOf(LABEL);

      assert.ok(at !== -1, `${label} states the limit, outside any HTML comment`);
      if (at === -1) continue;

      // THE SUBSTANCE, in a window rather than as a phrase. Any honest
      // statement of this limit has to name the mechanism, because the
      // mechanism IS the limit: the context's `recordId` is `null` for a
      // cross-model ask. A window keeps the rest of the paragraph rewritable.
      const window = source.slice(at, at + 1400);

      assert.ok(window.includes('recordId'),
        `${label} names the mechanism -- \`recordId\` -- rather than only asserting the conclusion`);
      assert.ok(/\bnull\b/.test(window),
        `${label} says what it is set to`);
      assert.ok(/different model/i.test(window),
        `${label} says whose record the request names instead`);
    }

    // AND THE README COPY IS THE ONE A CONSUMER ACTUALLY RECEIVES.
    // `docs/usage-patterns.md` says of itself that it does not ship, so a
    // disclosure that lived only there would be invisible to every consumer.
    //
    // KILLING MUTATION: remove 'README.md' from package.json's `files`.
    const packageJson = JSON.parse(await readRepoFile('../../package.json'));
    assert.ok(packageJson.files.includes('README.md'),
      'and README.md is in the published `files` list, so the shipped copy is the one pinned above');
  });
});
