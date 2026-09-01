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
const ACCESS_SIGNATURE = '  access(request, { model, operation }) {';

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
    // to a regex matching both signatures, and that is a REGRESSION: a
    // both-forms anchor stays green through a HALF-migration, in which the
    // fixture is migrated and the README copy is not — two divergent copies,
    // which is the exact condition assertion 46 exists to catch, and the
    // condition under which variant 5 was found in the shipped copy while the
    // tested copy was being mutated eight ways.
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
    assert.notOk(/access\\\(request\(\?:|new RegExp\(.*access\(request/.test(source),
      'and no both-forms pattern was introduced');

    // And the hard guard survives. Without it a start of -1 slices from the end
    // of the file and the comparison becomes two empty arrays — deepEqual green,
    // asserting nothing.
    assert.ok(source.includes('assert.ok(start !== -1,'),
      'and `assert.ok(start !== -1)` is still a hard guard, so a failed extraction cannot pass as an empty match');
  });

  test('AC1/5 — the sample body drops baseUrl and originalUrl, and KEEPS request.path', async function(assert) {
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
    const fixture = await readRepoFile('../sample/access/global-access.ts');
    const readme = await readRepoFile('../../README.md');

    const blockStart = readme.indexOf('export default class GlobalAccess');
    assert.ok(blockStart !== -1, 'precondition: the README carries the GlobalAccess sample');
    const readmeBlock = readme.slice(blockStart, readme.indexOf('\n```', blockStart));

    for (const [label, source] of [['the shipped fixture', fixture], ['the README sample', readmeBlock]]) {
      const body = extractAccessBody(source, label);

      assert.notOk(body.includes('baseUrl'), `${label}'s access() body does not read request.baseUrl`);
      assert.notOk(body.includes('originalUrl'), `${label}'s access() body does not read request.originalUrl`);
      assert.ok(body.includes('request.path'), `${label}'s access() body DOES still read request.path — the sanctioned read`);
      assert.ok(body.includes("'/archived'"), `${label}'s access() body still carries the /archived deny`);
      assert.ok(/if \(model === 'owner'\)/.test(body), `${label} branches on the context's model, not on a mount string`);
      assert.ok(/if \(model === 'animal'\)/.test(body), `${label} branches on model for animals too`);
    }

    // The header keeps the five variants as HISTORY, so `baseUrl` appearing in
    // the FILE is expected and is not what the two assertions above measure.
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
    assert.ok(source.includes('const access = (request, context) => globalAccess.access(request, context ?? contextFor(request));'),
      'and passes a context through: a real OrmRequest context when there is one, a mount-derived one otherwise');
    assert.ok(source.includes('function contextFor(request) {'),
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
