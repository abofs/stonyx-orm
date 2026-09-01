// @ts-nocheck
//
// abofs/stonyx-orm#222 — migrate the access sample and its five duplicated
// copies to the `{ model, operation }` contract.
//
// Specification: the refinement comment on #213, §"213b", plus the #222 issue
// body.
//
// ---------------------------------------------------------------------------
// WHY A NEW FILE RATHER THAN ONLY EDITING THE PINNED ONES
//
// Four of this story's assertions are *about* assertions that live in other
// files (the arity pin in test/integration/orm-test.ts, assertion 46's
// extractor and the one-argument harness at :73 in
// test/unit/access-filter-enforcement-test.ts, and the now-vacuous variant-5
// annotation). An assertion that a pin still exists cannot live in the same
// file as the pin: deleting both would be a silent pass. These are cross-file
// static assertions and they live here.
//
// The two live-router assertions — the arity pin's own router checks and the
// `GET /owners/archived` 403 — stay in test/integration/orm-test.ts, because a
// fabricated request is exactly the harness fail-open variant 5 survived four
// review rounds inside.
//
// A static test over source text is weak evidence on its own, which is why each
// one below names the mutation that kills it. Review is what missed variant 5
// four times.
// ---------------------------------------------------------------------------
import QUnit from 'qunit';
import GlobalAccess from '../sample/access/global-access.js';

const { module, test } = QUnit;

// The exact literal assertion 46 anchors its extractor on. Written out once
// here so that a change to the signature reds this file as well as that one.
// #236/#237: `recordId` joined the destructured context, so the literal moved
// with it. Kept in lockstep with the copy in access-filter-enforcement-test.ts
// by AC3/3 below, which compares this value against that file's source.
const ACCESS_SIGNATURE = '  access(request, { model, operation, recordId }) {';

async function readRepoFile(relativePath) {
  const { readFile } = await import('node:fs/promises');

  return readFile(new URL(relativePath, import.meta.url), 'utf8');
}

// The same extraction assertion 46 performs, reproduced here so this file can
// assert things about the sample BODY without depending on that assertion
// having run.
function extractAccessBody(source, label) {
  const start = source.indexOf(ACCESS_SIGNATURE);
  if (start === -1) throw new Error(`${label} does not contain ${ACCESS_SIGNATURE.trim()}`);
  const end = source.indexOf('\n  }', start);
  if (end === -1) throw new Error(`${label}'s access() method is not closed`);

  return source.slice(start, end);
}

module('[Unit] access sample migrated to the { model, operation } contract (#222)', function() {
  test('AC1/1 — the shipped fixture declares two parameters, with no default', function(assert) {
    // The whole contract, measured rather than read. `Function.length` counts
    // parameters up to the first default or rest element, so this single number
    // rejects all three shapes that would satisfy a reviewer skimming the
    // signature:
    //
    //   access(request)                                 -> 1
    //   access(request, ctx = {})                       -> 1   (migrated, still warns)
    //   access(request, { model, operation } = {})      -> 1   (migrated, still warns)
    //   access(request, { model, operation })           -> 2   <- required
    //
    // KILLING MUTATION: add `= {}` to the second parameter to keep a
    // one-argument caller working. That is exactly the shortcut #221's
    // boot-time warning would then fire on for the SHIPPED sample, which is the
    // argument for having fixed the one-argument harness instead.
    const globalAccess = new GlobalAccess();

    assert.strictEqual(globalAccess.access.length, 2,
      'new GlobalAccess().access.length === 2 — two parameters, and neither defaulted');
    assert.strictEqual(typeof globalAccess.access, 'function', 'and it really is the predicate, not a property');
  });

  test('AC3/2 — companion: the integration arity pin still exists, and now reads 2', async function(assert) {
    // The tripwire #202 wired at test/integration/orm-test.ts:2063 was
    // `assert.equal(Orm.instance.getAccess('animal').length, 1, ...)`. It is
    // required to invert, and inverting it is not distinguishable from deleting
    // it by any assertion inside that file.
    //
    // So the pin's existence is asserted from HERE. This is the "so deleting it
    // is not a pass" half.
    //
    // KILLING MUTATION: delete the pin from orm-test.ts. The suite would
    // otherwise stay green — nothing else measures the arity of the entry in
    // the LIVE BOOT REGISTRY, as opposed to the arity of the imported class,
    // which AC1/1 above covers.
    const source = await readRepoFile('../integration/orm-test.ts');

    assert.ok(source.includes("assert.equal(Orm.instance.getAccess('animal').length, 2,"),
      'the integration arity pin is present and inverted to 2');
    assert.notOk(source.includes("assert.equal(Orm.instance.getAccess('animal').length, 1,"),
      'and the arity-1 form it replaced is gone — inverted, not duplicated');

    // The pin reads the boot registry, not an import. If a future edit swapped
    // it for the imported class it would stop covering what it claims to.
    assert.ok(source.includes("Orm.instance.getAccess('animal').length"),
      'and it measures Orm.instance.getAccess, not an imported GlobalAccess');
  });

  test('AC3/3 — assertion 46 is re-anchored on the two-argument literal, and not loosened to a regex', async function(assert) {
    // TRIPWIRE 2. Assertion 46's extractor anchored on the literal
    // `'  access(request) {'`, guarded by `assert.ok(start !== -1, ...)`. The
    // migration reds it on EXTRACTION, not on comparison — `start === -1` — so
    // #213's claim that assertion 46 stays "unchanged" was not achievable.
    //
    // The correct repair is to move the anchor. The tempting one is to widen it
    // to a regex matching both signatures, and it is rejected — but NOT for the
    // reason an earlier revision of this comment gave.
    //
    // WHAT THAT REVISION CLAIMED, AND WHY IT WAS WRONG. It said a both-forms
    // anchor "stays green through a HALF-migration, in which the fixture is
    // migrated and the README copy is not". Measured: loosening the extractor
    // AND reverting the README block to the unmigrated copy gives 955 / 3, with
    // assertion 46 among the reds. `extract()` slices FROM `start`, which
    // includes the signature line, so two divergent copies red on the deepEqual
    // whichever anchor is used. The same false claim is in commit 62c8e80's
    // message and in the original #227 PR body; both are superseded.
    //
    // THE REASONS THAT HOLD are written out in full at the assertion itself
    // (test/unit/access-filter-enforcement-test.ts, assertion 46): a precise
    // single-line diagnostic on `start === -1`, and the literal doubling as a
    // shape pin that `access(request, ctx = {})` and `access(...args)` cannot
    // satisfy. This file asserts the mechanism; it does not restate the reason.
    //
    // KILLING MUTATION: replace `indexOf(ACCESS_SIGNATURE)` with a
    // `/access\(request(,.*)?\)\s*\{/` search.
    const source = await readRepoFile('./access-filter-enforcement-test.ts');

    assert.ok(source.includes(`const ACCESS_SIGNATURE = '${ACCESS_SIGNATURE}';`),
      'assertion 46 anchors on the exact two-argument literal');
    assert.notOk(source.includes("source.indexOf('  access(request) {')"),
      'and no longer on the single-argument literal');

    // Still an exact-literal search, not a pattern.
    assert.ok(source.includes('const start = source.indexOf(ACCESS_SIGNATURE);'),
      'the extractor is still an exact indexOf, not a regex matching both forms');
    // AND NO PATTERN OVER THE SIGNATURE WAS INTRODUCED ANYWHERE IN THAT FILE.
    //
    // This replaces an assertion that could not fire. It read
    // `/access\\\(request\(\?:|new RegExp\(.*access\(request/`, whose first
    // alternative requires the seven characters `access\(request(?:` — so the
    // killing mutation named above, which has no `(?:`, passed it, as did a
    // string-form `new RegExp` and a prefix `indexOf` loosening. Measured: all
    // three green. `pr-lifecycle.md`'s confirm-this-could-fail rule applies to
    // negative assertions too, and this file's whole premise is that a static
    // assertion must name the mutation that kills it.
    //
    // The escape sequence `access\(request` cannot occur in ordinary source —
    // it only appears inside a regular expression (or an escaped string built to
    // become one) matching the signature. The named mutation contains it
    // verbatim, so introducing that mutation reds this line, independently of
    // :129 above, which reds on the removal of the `indexOf` call instead.
    assert.notOk(/access\\\(request/.test(source),
      'and no regular expression over the access() signature was introduced anywhere in that file');

    // And the hard guard survives. Without it a start of -1 slices from the end
    // of the file and the comparison becomes two empty arrays — deepEqual green,
    // asserting nothing.
    assert.ok(source.includes('assert.ok(start !== -1,'),
      'and `assert.ok(start !== -1)` still reports a failed extraction, so it is named rather than silently compared as an empty match');
  });

  test('AC1/5 — the sample body reads NOTHING off argument one, and expresses the /archived deny against the decoded recordId', async function(assert) {
    // THE TRAP. #213's original AC1 required the migrated sample to contain no
    // reference to `baseUrl`, `originalUrl` OR `request.path`. README
    // "What the context does not tell you: which surface" — text #202 itself
    // shipped — records that six owner surfaces produce one identical context,
    // so the `/archived` deny cannot be expressed from the context alone. That
    // AC would have REQUIRED a silent deny-to-allow conversion.
    //
    // Both halves are asserted, in both copies:
    //   - no mount matching  (the migration actually happened)
    //   - `request.path` present (the deny was not migrated away)
    //
    // KILLING MUTATIONS: (a) leave `const mount = request.baseUrl` in place —
    // the first half reds; (b) delete the `/archived` branch and read nothing
    // off argument one — the second half reds, and so does the live-router 403
    // in test/integration/orm-test.ts.
    // THREE COPIES, NOT TWO. `docs/usage-patterns.md` carries a complete third
    // copy of this sample. Assertion 46 pins exactly one pair (README ↔
    // fixture), so before #227's fix round the line-for-line mechanism reached
    // one of the three full copies while the PR title said "and its five
    // duplicated copies" — the same shape as the failure this whole story
    // records, where variant 5 survived four rounds because it lived in the copy
    // nothing mutated.
    //
    // KILLING MUTATION: migrate two copies and leave the third on the old
    // signature, or edit the guard in one copy only. `extractAccessBody` throws
    // on a missing signature, and the three-way comparison below reds on a
    // divergent body.
    const fixture = await readRepoFile('../sample/access/global-access.ts');
    const readme = await readRepoFile('../../README.md');
    const usagePatterns = await readRepoFile('../../docs/usage-patterns.md');

    const fencedSample = (source, label) => {
      const blockStart = source.indexOf('export default class GlobalAccess');
      assert.ok(blockStart !== -1, `precondition: ${label} carries the GlobalAccess sample`);

      return source.slice(blockStart, source.indexOf('\n```', blockStart));
    };

    const copies = [
      ['the shipped fixture', fixture],
      ['the README sample', fencedSample(readme, 'the README')],
      ['the docs/usage-patterns.md sample', fencedSample(usagePatterns, 'docs/usage-patterns.md')],
    ];

    // COMMENTS STRIPPED, deliberately. All three copies carry long comment
    // blocks that NAME `baseUrl` and `originalUrl` as history — the third copy
    // reproduces the whole five-variant table inside `access()` — so a
    // `body.includes('baseUrl')` over the raw slice would measure the prose, not
    // the code. What these assert is that nothing is READ, which is a claim
    // about code lines. The rationale comments are pinned separately, below.
    const codeLines = ([label, source]) => extractAccessBody(source, label)
      .split('\n')
      .map(line => line.trim())
      .filter(line => line && !line.startsWith('//'));

    for (const copy of copies) {
      const [label] = copy;
      const code = codeLines(copy).join('\n');

      assert.notOk(code.includes('baseUrl'), `${label}'s access() body does not read request.baseUrl`);
      assert.notOk(code.includes('originalUrl'), `${label}'s access() body does not read request.originalUrl`);
      // RE-SPECIFIED BY abofs/stonyx-orm#237, NOT INVERTED. This line pinned
      // `request.path` as "the sanctioned read" — the ONE read of argument one
      // #222 had to keep, because the context named which model and which verb
      // but not which record. #236 put the record in the context, so the read
      // is retired rather than dropped and the rule it enforced is enforced
      // against a better input. What was never correct in either direction was
      // pinning the READ; what is correct is pinning the RULE.
      //
      // KILLING MUTATION: restore `const path = request.path.toLowerCase();`
      // and compare it against '/archived' — the first two red here, and the
      // live-router 403s in test/integration/orm-test.ts red with them.
      assert.notOk(code.includes('request.path'), `${label}'s access() body no longer reads request.path — the raw pathname disagreed with the decoded dispatch, which is how /owners/%61rchived walked past the deny`);
      assert.notOk(/toLowerCase/.test(code), `${label}'s access() body does not case-fold anything — a record id is a value, and folding it false-denied a distinct record at ARCHIVED while admitting %41RCHIVED`);
      assert.notOk(/decodeURI/.test(code), `${label}'s access() body does not decode anything either — express decodes a route parameter exactly once, and a second decode denies the legitimate id %61rchived`);
      assert.ok(code.includes("recordId === 'archived'"), `${label}'s access() body still carries the /archived deny, now against the DECODED record id`);
      assert.ok(/if \(model === 'owner'\)/.test(code), `${label} branches on the context's model, not on a mount string`);
      assert.ok(/if \(model === 'animal'\)/.test(code), `${label} branches on model for animals too`);

      // THE GUARD MOVED WITH THE READ. #222 guarded BOTH arguments because the
      // predicate read both. It now reads only argument two, so the guard on
      // `request.path` would be theatre — and the input that can still be
      // missing is `recordId`, which `auth()` always sets and a hand-assembled
      // context does not. `undefined` is the ONLY spelling of absent here:
      // `null` is a legitimate collection route and must NOT deny, which is why
      // the pin below is on the strict-equality form and not on `if (!recordId)`.
      //
      // KILLING MUTATION: delete the recordId guard, or rewrite it as
      // `if (!recordId) return false;` — the first reds assertion 47's
      // no-recordId pin, the second reds its `recordId: null` pin.
      assert.ok(code.includes("if (typeof model !== 'string' || model === '') return false;"),
        `${label} fails closed on an unidentifiable model (argument two)`);
      assert.ok(code.includes('if (recordId === undefined) return false;'),
        `${label} fails closed on a context that carries no recordId — it did not come from auth(), which always sets the key`);
      assert.notOk(/if \(!recordId\)/.test(code),
        `${label} does not deny on a FALSY recordId — \`null\` is the collection route and denying it would be a new false deny`);
      assert.notOk(/\?\? ''/.test(code),
        `${label} does not reach the record rule through \`?? ''\`, which this sample's own header condemns`);
    }

    // The three bodies are ONE matcher, code line for code line. Assertion 46
    // (test/unit/access-filter-enforcement-test.ts) pins README ↔ fixture at the
    // enforcement tier; this extends that to the third copy, which nothing
    // pinned.
    const [fixtureLines, readmeLines, usageLines] = copies.map(codeLines);

    assert.deepEqual(readmeLines, fixtureLines, 'the README sample and the shipped fixture are the same matcher, line for line');
    assert.deepEqual(usageLines, fixtureLines, 'and so is the docs/usage-patterns.md copy (was: pinned by nothing)');

    // THE RATIONALE IS PINNED TOO, because assertion 46's extractor strips `//`
    // lines and therefore compares no comments at all. The sentence below is the
    // one thing stopping a future contributor from "finishing the migration" by
    // deleting the rule outright — and it could be removed from the SHIPPED copy
    // with the suite staying green. It survives #237 unchanged, and that is the
    // point: what changed is WHERE the rule reads its input, not whether
    // dropping it is a silent deny-to-allow.
    for (const [label, source] of copies) {
      assert.ok(source.includes('turns a deny into an ALLOW, silently'),
        `${label} still carries the sentence that says dropping this rule is a silent deny-to-allow`);
    }

    // RE-SPECIFIED BY abofs/stonyx-orm#237 — THE FACT INVERTED, SO THE PIN DID.
    //
    // This pinned the banner `THIS DENY CANNOT BE EXPRESSED FROM THE CONTEXT
    // ALONE`, which was true while the context carried only `model` and
    // `operation`: six owner surfaces produced one identical context, so a
    // SUB-PATH rule had to read argument one. #236 added `recordId` and that
    // stopped being true. Leaving the old banner in the shipped copies would
    // have taught the next consumer to re-derive a fact the framework now hands
    // over — which is the exact failure this whole issue family is made of.
    //
    // NOT DELETED, INVERTED. The replacement banner has to say BOTH halves: it
    // is expressible now, AND it still must not be dropped. A banner that said
    // only the first half would read as permission to delete the rule.
    //
    // KILLING MUTATION: restore the old banner, or drop the "must not be
    // dropped" half of the new one.
    for (const [label, source] of copies.slice(0, 2)) {
      assert.ok(source.includes('EXPRESSIBLE FROM THE CONTEXT ALONE'),
        `${label} — the copy a consumer installs — says the deny is now expressible from the context alone`);
      assert.notOk(source.includes('CANNOT BE EXPRESSED FROM THE CONTEXT ALONE'),
        `${label} no longer carries the pre-#236 banner, which would send a consumer back to parsing the request target`);
      assert.ok(/still must not be dropped/i.test(source),
        `${label} keeps the other half: expressible is not the same as optional`);
    }

    // AND THE NARROWED VARIANT CLAIM IS PINNED. abofs/stonyx-orm#228 is a
    // spelling of VARIANT 3 — a hand-written matcher normalising differently
    // from the router — that the migrated sample does not handle, so "all five
    // variants are unconstructible" is FALSE wherever it is said of the migrated
    // predicate. After the first #227 fix round four sites still said it:
    // README.md twice, src/orm-request.ts, and the fixture's own header, fifteen
    // lines above a paragraph saying the opposite. Three of those four SHIP.
    // Nothing in the tree asserted the narrowing, so it could drift back with
    // the suite green — which is what this loop closes.
    //
    // The PAST-tense form ("that closed all five variants", said of the
    // WITHDRAWN `request.baseUrl` revision) is true and is deliberately not
    // matched: the negative anchor is `all five variants are`, which only ever
    // occurs in the present-tense claim about the migrated predicate.
    //
    // KILLING MUTATION: restore any of the four sites to "all five variants are
    // unconstructible" or to "variants 1, 2, 3, 4 and 5".
    const ormRequest = await readRepoFile('../../src/orm-request.ts');

    const narrowedClaims = [
      ['README.md — the `access()` sample banner', readme,
        'so variants 1, 2, 4 and 5 are **unconstructible** against'],
      ['README.md — "Identifying the collection"', readme,
        'so variants 1, 2, 4 and 5 are unconstructible against it rather than'],
      ['src/orm-request.ts — the DO NOT RECONSTRUCT banner', ormRequest,
        'IS the structural fact, so variants 1, 2, 4 and 5 are'],
      ['the shipped fixture header', fixture,
        'structural fact, so variants 1, 2, 4 and 5 are unconstructible against'],
    ];

    for (const [label, source, narrowed] of narrowedClaims) {
      assert.ok(source.includes(narrowed),
        `${label} narrows the unconstructible claim to variants 1, 2, 4 and 5`);
    }

    for (const [label, source] of [
      ['README.md', readme],
      ['src/orm-request.ts', ormRequest],
      ['the shipped fixture', fixture],
    ]) {
      assert.notOk(source.includes('all five variants are'),
        `${label} does not claim all five variants are unconstructible against the migrated predicate — variant 3 is live, as #228`);
      assert.notOk(source.includes('1, 2, 3, 4 and 5'),
        `${label} does not carry the un-narrowed enumeration either`);
      assert.ok(/variant 3 survives/i.test(source),
        `${label} says which one survives, in as many words`);
    }

    // The header keeps the five variants as HISTORY, so `baseUrl` appearing in
    // the FILE is expected and is not what the body assertions above measure.
    // This confirms they are measuring the body and not the file.
    assert.ok(fixture.includes('baseUrl'),
      'the fixture header still records the baseUrl revision as history — so the body assertions above really are scoped to the body');
  });

  test('AC3/6 — the unit harness supplies a real { model, operation }', async function(assert) {
    // TRIPWIRE 3. `test/unit/access-filter-enforcement-test.ts:73` was
    // `const access = request => globalAccess.access(request);` — a ONE-argument
    // harness driving 36 call sites in that file.
    //
    // Against a migrated predicate that destructures its second argument, that
    // throws on `undefined`; `auth()` treats a throw as a denial (assertion 36),
    // so the suite would not crash. It would silently DENY EVERYTHING and red
    // dozens of assertions with a misleading symptom.
    //
    // KILLING MUTATION: restore the one-argument arrow. The pass condition for
    // this file's sibling is that the whole access-filter suite is green with a
    // real context flowing through, which is measured by that suite running.
    const source = await readRepoFile('./access-filter-enforcement-test.ts');

    assert.notOk(source.includes('const access = request => globalAccess.access(request);'),
      ':73 is no longer the one-argument harness');
    assert.ok(source.includes('const access = (request, context) => globalAccess.access(request, context ?? accessContextFor(request));'),
      'and passes a context through: a real OrmRequest context when there is one, a mount-derived one otherwise');
    assert.ok(source.includes('function accessContextFor(request) {'),
      'and the fallback context is a named helper, so what it derives is reviewable');

    // The context it supplies is a REAL one — the same two keys, the same four
    // verbs — not an empty object that would satisfy the destructure and
    // nothing else.
    assert.ok(source.includes("const OPERATION_BY_METHOD = { GET: 'read', POST: 'create', PATCH: 'update', DELETE: 'delete' };"),
      'and the operation half is the framework vocabulary, not a placeholder');
    assert.ok(source.includes('MODEL_BY_MOUNT'), 'and the model half maps a mount to a model name the store is keyed by');
  });

  test('AC3/7 — the now-vacuous variant-5 raw-socket test is annotated as such', async function(assert) {
    // The migrated predicate reads neither `originalUrl` nor `baseUrl`, so
    // test/integration/orm-test.ts:1521-1578 would pass against a predicate with
    // no matching logic whatsoever. It is required to keep passing — it is a
    // real end-to-end raw-socket dispatch and worth keeping wired — but leaving
    // it reading as live coverage of fail-open variant 5 would misinform the
    // next reviewer, and this tree has already been burned four times by exactly
    // that.
    //
    // KILLING MUTATION: delete the annotation and leave the test green. Nothing
    // else in the suite would notice.
    const source = await readRepoFile('../integration/orm-test.ts');

    const title = source.indexOf("test('[DEFECT] variant 5 —");
    assert.ok(title !== -1, 'precondition: the variant-5 raw-socket test is still present');

    const body = source.slice(title, source.indexOf('\n    });', title));

    assert.ok(/NOW-VACUOUS/.test(source.slice(title, source.indexOf('\n', title))),
      'its title says the coverage is now vacuous, so a reader scanning the TAP output sees it');
    assert.ok(body.includes('NO LONGER LIVE COVERAGE'),
      'and its header says so in full');
    assert.ok(body.includes('unconstructible'),
      'and gives the reason: the variant is unconstructible against a predicate that reads the context');
    assert.ok(body.includes('/owners/archived'),
      'and points at the assertion that IS live coverage of the surviving read of argument one');

    // And the thing it points at exists.
    assert.ok(source.includes("test('[DEFECT] #222 — the /archived sub-path deny survives"),
      'which is present — the pointer is not dangling');
  });
});
