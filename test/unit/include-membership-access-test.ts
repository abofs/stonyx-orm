// @ts-nocheck
//
// abofs/stonyx-orm#233 — `include=` traversal membership, the unit tier.
//
// The behavioural half of this story runs over the live express router in the
// `Include Traversal Membership Access (#233)` module in
// test/integration/orm-test.ts, which is where every request-shape-dependent
// criterion belongs. This file holds only what a live server cannot answer:
//
//   - the criteria that need a stubbed registry rather than a server (AC5) or
//     a scoped read of the source (AC9), and
//   - the cross-file obligations this story owes its siblings (AC11). #235's
//     `X1`, `X1c` and `R1c` all pinned the PRE-#233 membership behaviour and
//     are falsified by this change BY CONSTRUCTION. They are re-specified in
//     place, never deleted, and these assertions are what stop a future edit
//     satisfying #233 by deleting them instead.
//
// WHY THE AC11 ASSERTIONS ARE HERE AND NOT IN THE FILES THEY ARE ABOUT. An
// assertion that a pin still exists cannot live in the same file as the pin:
// deleting both in one edit would be a silent pass. Same reasoning as
// test/unit/write-linkage-scope-test.ts, which this file follows.
//
// AND WHAT A STATIC TEXT ASSERTION IS WORTH. Weak evidence on its own. These
// exist only so the behavioural assertions cannot be satisfied by DELETING the
// thing they are measured against, and each names the tamper it was tested
// against — the CHEAP one, commenting out, because that is the edit a real
// person performs.
//
import QUnit from 'qunit';
import { readFile } from 'node:fs/promises';
import Orm from '@stonyx/orm';
import { setupIntegrationTests } from 'stonyx/test-helpers';
import { createLinkageFilter } from '../../src/access-verdict.js';

const { module, test } = QUnit;

const readRepoFile = relativePath => readFile(new URL(relativePath, import.meta.url), 'utf8');

/**
 * Strip `//` line comments, so a commented-out assertion does not count as
 * present. Identical in construction and in purpose to
 * test/unit/write-linkage-scope-test.ts's copy — deliberately a local copy,
 * because hoisting it would edit a module this story does not own.
 */
const withoutLineComments = source => source
  .split('\n')
  .filter(line => !/^\s*\/\//.test(line))
  .join('\n');

/**
 * Slice one test body out of orm-test.ts by the test's NAME, terminating at
 * the next test opener. Every AC11 assertion is scoped this way rather than
 * run file-wide, and that is a correction rather than a precaution: two of the
 * needles below occur TWICE in the comment-stripped file, because the #233
 * module asserts the same store-derived facts for its own reasons. A pin that
 * is a COUNT over a population wider than its own claim is satisfied by the
 * other member of that population — measured in this repo, where a guard
 * counted a URL three unrelated call sites also matched and survived the
 * deletion of the thing it guarded.
 */
const testBody = (source, name) => {
  const start = source.indexOf(`test('${name}'`);
  if (start === -1) return '';

  // THE TERMINATOR IS A REGEX, NOT A FIXED INDENT, AND THAT IS A BUG FIX.
  // A literal `'\n    test('` assumes every test sits at one nesting depth.
  // `included resources have links.self` is one module deeper, so the literal
  // never matched, the slice ran to the end of the file, and the length
  // precondition below caught it — which is the only reason this was not a
  // 4000-character window quietly satisfying every needle at once.
  const rest = source.slice(start + 10);
  const match = /\n\s*test\(/.exec(rest);

  return match ? source.slice(start, start + 10 + match.index) : source.slice(start);
};

// A request object is required by `auth()` only for its `.method` and by the
// shipped fixture for its `.path`. Same constant, and the same reasoning, as
// test/unit/linkage-verdict-test.ts's: these assertions are about verdict
// RESOLUTION, which is pure, not about request identification, which is
// asserted over the live router.
const READ_REQUEST = { method: 'GET', path: '/', params: {}, query: {} };

module('[Unit] #233 include= traversal membership', function(hooks) {
  setupIntegrationTests(hooks);

  test('AC5 — getAccess(type) === undefined denies the sideloaded resource', function(assert) {
    // THE FILTER ASSERTED HERE IS THE SAME OBJECT THE TRAVERSAL IS GIVEN.
    // `buildResponse` passes its `linkage` filter straight into
    // `collectIncludedRecords`, which threads it into `traverseIncludePath`,
    // so a type this function denies is a type that never enters `included`.
    // The end-to-end proof over the live router is `[DEFECT] #233 AC3`, which
    // drives the real unclaimed model (`tag`) through `?include=`; this
    // assertion exists because that one cannot distinguish "denied" from
    // "never mounted, so never reached".
    //
    // A STUBBED REGISTRY, AND THE STUB IS THE POINT. `zz-233-unclaimed` is a
    // type no access class declares, which is exactly the state
    // `Orm.instance.getAccess` reports as `undefined`.
    //
    // KILLING MUTATION: change `resolveVerdict`'s
    // `if (typeof predicate !== 'function') return DENIED;` to return GRANTED.
    // The first assertion reds and `[DEFECT] #233 AC3` reds with it.
    const registry = Orm.instance.accessFunctions;
    const UNCLAIMED = 'zz-233-unclaimed';
    const CLAIMED = 'zz-233-claimed';

    assert.strictEqual(Orm.instance.getAccess(UNCLAIMED), undefined,
      'precondition: no access class claims this type');

    registry[CLAIMED] = () => true;

    try {
      assert.strictEqual(createLinkageFilter(READ_REQUEST)(UNCLAIMED, { id: 1 }), false,
        'a type no access class claims is DENIED — `undefined` is not "unrestricted"');

      // NOT VACUOUS: the same filter, the same request, the same record shape,
      // GRANTS for a type that IS claimed. Without this the assertion above is
      // satisfied by a filter that denies everything, which is the over-denial
      // direction `[GUARD] #233 AC7` exists to catch on the live router.
      assert.strictEqual(createLinkageFilter(READ_REQUEST)(CLAIMED, { id: 1 }), true,
        'while a CLAIMED type still grants — the denial is about the missing class, not about the filter');
    } finally {
      delete registry[CLAIMED];
    }

    // THE LIMIT THIS AC DOES NOT CLOSE, AND MUST NOT CLAIM TO.
    // `setup-rest-server.ts` catches an access-class load FAILURE, warns, and
    // publishes whatever PARTIAL map it had. So `undefined` means "no access
    // class claims this model" OR "a class exists and failed to load", and
    // nothing on this path can tell them apart. Denying is the right answer to
    // both, which is why this AC is satisfiable at all — but a consumer whose
    // access class fails to load sees their relationships silently emptied
    // rather than a boot failure, and that is inherited, not closed here.
    // The unconditional publication itself being untested is recorded in
    // test/sample/models/tag.ts and owned by abofs/stonyx-orm#225/#248.
    assert.ok(true, 'recorded above: `undefined` conflates "unclaimed" with "failed to load" — see the comment, this line asserts nothing');
  });

  test('AC9 — the membership decision consumes #234’s interpreter and does not re-implement it', async function(assert) {
    // "DOES NOT RE-IMPLEMENT" IS AN ABSENCE CLAIM, AND AN ABSENCE CLAIM IS
    // WORTHLESS UNLESS THE VOCABULARY IT DENIES IS SHOWN TO EXIST SOMEWHERE.
    // Each needle below is asserted PRESENT in src/access-verdict.ts, the file
    // that legitimately owns verdict classification, before it is asserted
    // ABSENT from the traversal. Otherwise this is a list of strings that
    // appear nowhere and cannot fail.
    //
    // THE BEHAVIOURAL PROOF IS ELSEWHERE AND IS THE STRONGER ONE.
    // `[GUARD] #233 AC9` in the integration module feeds all six `access()`
    // return shapes through the live router and compares the MEMBERSHIP answer
    // against `interpretAccess`'s own classification of the same value. That is
    // what shows one interpreter; this test shows the traversal has no place
    // to hide a second one.
    //
    // KILLING MUTATION: replace `linkage(type, relatedRecord)` in
    // `traverseIncludePath` with an inline
    // `Orm.instance.getAccess(type) === true` test. The positive needle reds
    // and the `getAccess` negative needle reds with it.
    const source = withoutLineComments(await readRepoFile('../../src/orm-request.ts'));
    const verdictSource = withoutLineComments(await readRepoFile('../../src/access-verdict.js')
      .catch(() => readRepoFile('../../src/access-verdict.ts')));

    const start = source.indexOf('function traverseIncludePath(');
    assert.ok(start > -1, 'precondition: the traversal function is findable by name');
    const body = source.slice(start, source.indexOf('\nfunction ', start + 10));
    assert.ok(body.length > 0 && body.length < 3000,
      'precondition: the slice is one function body, not the rest of the file');

    // THE POSITIVE: membership is decided by CALLING the injected filter.
    assert.strictEqual(body.split('linkage(type, relatedRecord)').length - 1, 1,
      'the membership decision is made by CALLING the injected filter, exactly once');
    assert.ok(/\) continue;/.test(body),
      'and a denial is a `continue`, which skips the `included` push AND the `nextRecords` push — that is the prune');

    // THE NEGATIVES: no second reading of a consumer `access()` return lives
    // in the traversal.
    for (const term of ['getAccess', 'accessFunctions', 'interpretAccess', 'createLinkageFilter', '.granted']) {
      assert.ok(verdictSource.includes(term),
        `precondition: \`${term}\` really is part of the verdict vocabulary — so its absence below is a fact and not a typo`);
      assert.notOk(body.includes(term),
        `and the traversal does not use \`${term}\` — it consumes a decided filter, it does not resolve or classify one`);
    }
  });

  test('AC11/X1c — #235’s static membership pin is re-specified, not deleted', async function(assert) {
    // #235's `X1c` pinned the PRE-#233 reproduction ("the hidden owner is
    // STILL a member"), which this story falsifies by construction. The
    // cheapest way to make #233 green was to DELETE it. It was re-specified
    // instead, and this is the assertion that says so from outside the file.
    //
    // TWO READS OF THE SAME FILE, DELIBERATELY, BECAUSE THE TWO CLAIMS NEED
    // OPPOSITE TREATMENTS. The record of the old assertion IS a comment, so it
    // is read RAW; the guard still having live assertions is a claim about
    // code, so it is read COMMENT-STRIPPED — commenting the whole test out
    // must not satisfy it.
    //
    // TAMPER TESTED: deleting the `X1c` test outright (the stripped read reds),
    // and re-specifying it without recording what it replaced (the raw read
    // reds).
    const raw = await readRepoFile('./write-linkage-scope-test.ts');
    const live = withoutLineComments(raw);

    assert.ok(live.includes("test('[GUARD] #235 X1c"),
      'the guard still exists as a live test — it was not deleted to make #233 green');
    assert.ok(/RE-SPECIFIED BY abofs\/stonyx-orm#233/.test(raw),
      'and it records that #233 is what re-specified it');
    assert.ok(raw.includes("assert.ok(owner, 'owner is included');"),
      'and the assertion it REPLACED is recorded verbatim, so a reader can see what was traded away rather than only what is there now');
    assert.ok(/TAMPER TESTED/.test(raw),
      'and the replacement names the tamper it was tested against');

    // AND THE REPLACEMENT IS NOT THE OLD CLAIM WEARING THE OLD NAME. #233
    // makes the hidden owner a NON-member, so a guard still demanding she IS
    // one is a guard demanding the bug.
    assert.notOk(live.includes("assert.ok(owner, 'owner is included');"),
      'the replaced assertion is recorded in a COMMENT and is not still live — recording is not reinstating');
  });

  test('AC11/R1c — #235’s nested-include selector pin is re-specified, not deleted', async function(assert) {
    // #235's `R1c` re-specified the original leak selector once already. #233
    // falsifies the RE-SPECIFICATION: `angelaPets.length > 1` asserted that a
    // hidden owner's pets reach `included`, which is the subtree this story
    // prunes. So the same assertion has now moved twice, and both moves have
    // to be legible from outside the file.
    //
    // TAMPER TESTED: deleting the `R1c` test (the stripped read reds), and
    // re-specifying it while recording only the FIRST move (the second raw
    // assertion reds).
    const raw = await readRepoFile('./write-linkage-scope-test.ts');
    const live = withoutLineComments(raw);

    assert.ok(live.includes("test('[GUARD] #235 R1c"),
      'the guard still exists as a live test');
    assert.ok(raw.includes("r.relationships.owner?.data?.id === 'angela'"),
      'MOVE 1 (#235) is still recorded — the original leak selector, in a comment');
    assert.ok(raw.includes("assert.ok(angelaPets.length > 1, 'owner pets are included via nested"),
      'and MOVE 2 (#233) records what #235 had re-specified it TO, so neither move is lost');

    // AND #235's INTERMEDIATE FORM IS RECORDED, NOT REINSTATED.
    //
    // ONLY THE INTERMEDIATE FORM IS CHECKED THIS WAY, AND THE REASON IS WORTH
    // STATING BECAUSE THE FIRST DRAFT OF THIS TEST GOT IT WRONG. It also
    // asserted `notOk(live.includes("r.relationships.owner?.data?.id ===
    // 'angela'"))` — which CANNOT hold and reds immediately, because that
    // string is `R1c`'s own live search needle: `R1c` asserts the selector's
    // absence from orm-test.ts by searching for it, so the literal must appear
    // in `R1c`'s executable code. Asserting a guard does not contain the
    // string it searches for is asserting the guard does not work. The claim
    // that string was reaching for is `R1c`'s to make, about orm-test.ts, and
    // it makes it.
    assert.notOk(live.includes("assert.ok(angelaPets.length > 1, 'owner pets are included via nested"),
      '#235’s intermediate form is recorded in a comment, not still live — #233 falsifies it');
  });

  test('AC11 — the four repaired inversions kept their NEGATIVE half', async function(assert) {
    // THE COMPANION-PAIR REQUIREMENT, ASSERTED FROM OUTSIDE THE FILE. Each of
    // the four tests #233 inverted was repaired as a PAIR — a negative on the
    // hidden subject plus a positive on a permitted one — precisely so that
    // deleting a pin is not a pass. The naive repair is to retarget the whole
    // test at a permitted subject, which DELETES the reproduction: a test named
    // "sideloads relationships" that only ever looks at a permitted subject no
    // longer distinguishes #233's fix from a build that never sideloads.
    //
    // ONE NEEDLE PER CLAIM, KEYED ON THAT CLAIM'S OWN ASSERTION MESSAGE, AND
    // SLICED TO THE TEST THAT MAKES IT. Both are corrections rather than
    // precautions — see the `testBody` helper above for the measured reason.
    //
    // TAMPER TESTED: deleting any one of the four negative halves reds exactly
    // one assertion below, keyed on that test's own message.
    const source = withoutLineComments(await readRepoFile('../integration/orm-test.ts'));

    const inversions = [
      ['get call with include parameter sideloads relationships',
        'the hidden owner is not a member of `included` — #233'],
      ['invalid relationship in include parameter is ignored',
        'the hidden-owner subject is still a 200, not an error'],
      ['get call with nested include parameter sideloads deep relationships',
        'and NONE of her pets reached `included` either'],
      ['included resources have links.self',
        'the withheld subject is still a 200']
    ];

    for (const [name, needle] of inversions) {
      const body = testBody(source, name);

      assert.ok(body.length > 0 && body.length < 4000,
        `precondition: \`${name}\` is findable and the slice is one test body`);
      assert.strictEqual(body.split(needle).length - 1, 1,
        `\`${name}\` still asserts the NEGATIVE half on the hidden subject, exactly once`);
    }
  });
});
