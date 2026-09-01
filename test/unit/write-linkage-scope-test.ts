// @ts-nocheck
//
// abofs/stonyx-orm#235 — the assertions that are ABOUT other files.
//
// Three of this story's acceptance criteria are claims about text that lives
// somewhere else: two sibling stories' pins inside test/integration/orm-test.ts,
// and the documentation this change obliges across README.md,
// docs/usage-patterns.md and docs/project-structure.md.
//
// WHY THEY ARE NOT IN THE FILES THEY ARE ABOUT. An assertion that a pin still
// exists cannot live in the same file as the pin: deleting both in one edit
// would be a silent pass. Same reasoning as
// test/unit/access-sample-migration-test.ts, which this file follows.
//
// ---------------------------------------------------------------------------
// WHAT A STATIC TEXT ASSERTION IS AND IS NOT WORTH
// ---------------------------------------------------------------------------
// A static test over source text is weak evidence on its own. The BEHAVIOUR is
// asserted over the live express router in the `Write & Included Linkage Access
// (#235)` module in test/integration/orm-test.ts; these assertions exist only
// so that the behavioural ones cannot be satisfied by DELETING the thing they
// are measured against. Each one below therefore names the tamper it was
// tested against, and the tamper tested is the CHEAP one — commenting out, not
// deleting — because that is the edit a real person performs.
//
// ---------------------------------------------------------------------------
// AND WHAT THE NEGATIVE ASSERTIONS DELIBERATELY DO NOT COVER
// ---------------------------------------------------------------------------
// Two assertions below are absence checks on a specific FALSE CLAIM, scoped to
// the clause that carried it. They are NOT bans on a family of phrasings: a
// reworded restatement of the same false claim would pass them. That limit is
// stated here rather than left for a reader to discover, because a phrase ban
// wide enough to catch every rewording is also wide enough to forbid an honest
// new disclosure — which has happened in this repo before.
//
import QUnit from 'qunit';
import { readFile } from 'node:fs/promises';

const { module, test } = QUnit;

const readRepoFile = relativePath => readFile(new URL(relativePath, import.meta.url), 'utf8');

/**
 * Strip `//` line comments so a commented-out assertion does not count as
 * present.
 *
 * THIS IS THE POINT OF THE HELPER, NOT A TIDY-UP. An anti-tampering guard is
 * written against the tamper its author imagined, and the tamper a real person
 * performs is the cheapest one. `// assert.ok(owner, ...)` satisfies a raw
 * `includes()` check completely while removing the assertion, so a guard that
 * reads raw source pins deletion and nothing else.
 *
 * It is line-oriented and therefore does not strip a `/* … *\/` block comment
 * wrapped around a whole test. That residual is real; the behavioural
 * assertions in orm-test.ts are what catch it, because a block-commented pin
 * stops running and its own module reports one fewer test.
 */
const withoutLineComments = source => source
  .split('\n')
  .filter(line => !/^\s*\/\//.test(line))
  .join('\n');

module('[Unit] #235 write & included linkage — cross-file scope', function() {
  test('[GUARD] #235 X1c — #233’s `included` membership pin is still present in orm-test.ts', async function(assert) {
    // The behavioural half is `[GUARD] #235 X1`, which asserts over the live
    // router that a hidden owner is STILL a member of `included`. That
    // assertion is #233's reproduction held green, and #235 must not close
    // #233 incidentally — so it also must not be DELETED by #235, which would
    // leave #233 with nothing to turn red in Sprint 87.
    //
    // SCOPED TO THE NESTED-INCLUDE TEST'S BODY, NOT TO THE WHOLE FILE, AND
    // THAT CORRECTION CAME OUT OF ATTACKING THIS GUARD RATHER THAN READING IT.
    // The first draft searched the whole file for
    // `included.find(r => r.type === 'owner' && r.id === 'angela')`. That
    // literal occurs TWICE — the `get call with include parameter sideloads
    // relationships` test at :582 carries an identical line — so deleting the
    // one this guard is about would have left the guard green. A file-wide
    // `includes()` on a line that is not unique pins nothing.
    //
    // TAMPER TESTED: commenting the line out (`withoutLineComments` removes it
    // before the search), and deleting it while the identical line in the
    // other test remains (the slice below excludes that one).
    const source = withoutLineComments(await readRepoFile('../integration/orm-test.ts'));

    const testStart = source.indexOf("test('get call with nested include parameter sideloads deep relationships'");
    assert.ok(testStart > -1, 'precondition: the nested-include test is findable by name');
    const body = source.slice(testStart, source.indexOf("\n    test(", testStart + 10));
    assert.ok(body.length > 0 && body.length < 4000, 'precondition: the slice is one test body, not the rest of the file');

    // PRECONDITION MADE KILLABLE. This read:
    //
    //     assert.notOk(body.includes("test('get call with include parameter
    //       sideloads relationships'"), 'precondition: and it does NOT contain
    //       the OTHER test ...');
    //
    // which cannot fail. The slice above terminates at the next `\n    test(`,
    // so no second test opener can be inside it by construction -- and the
    // twin sits at :573, BEFORE the slice even begins. It was decoration on an
    // assertion that can fail, and decoration reads as coverage.
    //
    // What it was trying to certify is real and IS checkable: the reason this
    // guard is sliced at all is that the membership literal is NOT UNIQUE in
    // the file, so a file-wide `includes()` would pin neither copy. Asserting
    // the two counts states that reason and fails when it stops holding --
    // widen the slice back to the whole file and the second assertion reads 2.
    const membershipLine = "const owner = included.find(r => r.type === 'owner' && r.id === 'angela');";
    assert.strictEqual(source.split(membershipLine).length - 1, 2,
      'precondition: the membership literal occurs TWICE in the file — which is why a file-wide includes() would pin neither');
    assert.strictEqual(body.split(membershipLine).length - 1, 1,
      'and the slice isolates exactly ONE of them, so deleting THIS test’s copy reds this guard');

    assert.ok(body.includes(membershipLine),
      "the nested-include test still SELECTS the hidden owner out of `included`");
    assert.ok(body.includes("assert.ok(owner, 'owner is included');"),
      'and still asserts she is a member — that is #233’s reproduction, and #235 leaves it standing');
  });

  test('[GUARD] #235 R1c — the nested-include leak-pinning selector is re-specified, not deleted', async function(assert) {
    // `included.filter(r => r.type === 'animal' && r.relationships.owner?.data?.id === 'angela')`
    // was THE LEAK WRITTEN AS A REQUIREMENT: it asserted that eight permitted
    // animals each publish the id of an owner the caller gets a 404 for. #235
    // nulls that linkage, so the old selector matches nothing and the
    // assertion goes red for the right reason.
    //
    // It had to be RE-SPECIFIED rather than deleted — the test's actual
    // subject, that the nested `owner.pets` hop traversed, is still worth
    // asserting. This pins both halves of that: the leak selector is gone AND
    // the sideload assertion survives.
    //
    // TAMPER TESTED: deleting the assertion outright instead of re-specifying
    // it (the second assertion below fails), and commenting the re-specified
    // selector out while leaving the old one (the first fails).
    const source = withoutLineComments(await readRepoFile('../integration/orm-test.ts'));

    assert.notOk(source.includes("r.relationships.owner?.data?.id === 'angela'"),
      'no assertion selects sideloaded records BY the hidden owner’s id any more');

    assert.ok(source.includes("const angelaPets = included.filter(r => r.type === 'animal');"),
      'the re-specified selector is present — the sideload is still asserted');
    assert.ok(source.includes("assert.ok(angelaPets.length > 1, 'owner pets are included via nested relationship');"),
      'and the assertion it feeds still exists, so this was a re-specification and not a deletion');

    // AND IT MUST NOT BE RE-SPECIFIED INTO SOMETHING THAT PASSES ON AN EMPTY
    // `included`. The store-derived membership check is what rules that out.
    assert.ok(source.includes("assert.ok(expectedPets.length > 1, 'precondition: angela really does own more than one animal');"),
      'the re-specification carries a precondition, so it cannot pass against an empty included array');
  });

  test('[GUARD] #235 X2c — the relationships-linkage route carries its #232 scope note', async function(assert) {
    // `orm-request.ts` builds this route's `{type, id}` objects by hand and
    // never calls `toJSON`, so it cannot see a `linkage` option. It is red
    // today and it is #232's. The two neighbouring sites (`buildResponse`'s
    // `included` and the related-resource branch) both carry a scope comment;
    // this one did not, which is how an implementer of #235 ends up wiring it
    // and spending #232's evidence.
    //
    // READ RAW, NOT COMMENT-STRIPPED, AND THAT IS NOT AN OVERSIGHT. The thing
    // being pinned here IS a comment, so `withoutLineComments` would delete
    // the subject of the assertion. The comment-out tamper does not apply to a
    // comment; the tamper that does is deletion, and that is what these three
    // assert. The CODE half below is read stripped, because there the
    // comment-out tamper is live.
    const raw = await readRepoFile('../../src/orm-request.ts');

    assert.ok(/abofs\/stonyx-orm#232 OWNS THIS\s+\/\/ ROUTE/.test(raw),
      'the relationships-linkage route names its owning issue at the code site');
    assert.ok(/the `linkage` option cannot\s+\/\/ reach it/.test(raw),
      'and says WHY — it never calls toJSON, so the option has nowhere to arrive');

    // AND NAMES THE SIBLING PR AS IN FLIGHT. #232 lands this sprint as PR
    // #247, and `src/orm-request.ts` AUTO-MERGES CLEAN between the two
    // branches -- verified with `git merge-tree`. The note's earlier wording
    // ("cannot see a filter no matter who passes one") would therefore have
    // landed forty-one lines above #247's own `createLinkageFilter` call,
    // silently, with no conflict for anyone to resolve. A scope note that
    // outlives its scope is worse than none, so the note now dates itself
    // against the PR that ends it and this assertion keeps it doing so.
    assert.ok(/PR #247 is IN FLIGHT/.test(raw),
      'and names the sibling PR that changes this route, so the note cannot silently outlive its own scope');

    // The behavioural pin is `[GUARD] #235 X2`. This one only stops the note
    // from being deleted while that test is quietly rewritten.
    assert.ok(raw.includes('`[GUARD] #235 X2`'),
      'and points at the test that pins the ownership boundary behaviourally');

    // THE CODE ITSELF, so this test is not purely an assertion about prose.
    //
    // MESSAGE CORRECTED IN #235's FIX ROUND, AND THE CORRECTION IS THE POINT.
    // It read "the branch is still the unfiltered hand-built one -- #235 did
    // not wire it", which names a property this assertion does not check.
    // MEASURED: adding an access check ABOVE this line -- which is exactly
    // what PR #247 does (`if (!isLinkable(relatedData)) return 404;`) -- wires
    // the branch while leaving the pinned line byte-identical, so this
    // assertion stayed GREEN at 1009/2 (baseline 1011/0) while
    // `[GUARD] #235 X2` went red. The message was reporting a guarantee the
    // assertion never offered.
    //
    // FIXED BY CORRECTING THE MESSAGE, NOT THE ASSERTION, and deliberately.
    // The assertion pins the hand-built CONSTRUCTION, which is the reason the
    // `linkage` option cannot reach this route and therefore the reason the
    // route is not #235's -- that claim is true, load-bearing, and survives
    // #247 (which keeps this line verbatim and adds a guard above it).
    // Widening it to "nobody wired a filter here" would instead pin the
    // route's implementation against its owner, which is the same out-of-scope
    // mistake `[GUARD] #235 X2` was just re-specified to stop making. Whether
    // a filter is wired is X2's question, and X2 is where it is asked.
    const code = withoutLineComments(raw);

    assert.ok(code.includes('data = { type: relatedData.__model.__name, id: relatedData.id };'),
      'and the belongsTo linkage is still built BY HAND rather than through toJSON — which is WHY the `linkage` option cannot reach this route');
  });

  test('[GUARD] #235 D1 — README no longer claims the write handlers need a signature change', async function(assert) {
    // The claim was measurably false: `HandlerFn = (request, state)` has always
    // delivered the request as argument one, and both handlers simply
    // discarded the binding. It mattered because it made a six-line change
    // look like a refactor, which is how it stayed deferred.
    //
    // SCOPED TO THE CLAUSE, NOT TO A FAMILY OF PHRASINGS. A reworded
    // restatement would pass this. See the file header.
    const readme = await readRepoFile('../../README.md');

    assert.notOk(readme.includes('so wiring\n    them needs a signature change rather than an argument'),
      'the false "needs a signature change" clause is gone from the README');
    assert.notOk(/needs a signature change rather than an argument/.test(readme),
      'and is gone however it happens to be line-wrapped');

    // Replaced rather than merely deleted: the accurate statement is present.
    assert.ok(/`POST \/:models` and\s+`PATCH \/:models\/:id` \*\*response documents\*\*/.test(readme),
      'and the write surfaces are named among the ones that ARE filtered');
  });

  test('[GUARD] #235 D1b — the two design docs describe the post-#235 state', async function(assert) {
    // docs/project-structure.md states its own purpose: it is where the next
    // reader checks whether the chain is still blocked. It said `included` and
    // the POST/PATCH documents "still publish unfiltered linkage", which #235
    // makes false — the same failure mode #234 AC8b exists to prevent, one
    // story later. docs/usage-patterns.md carried the same claim about
    // `buildResponse`.
    //
    // TAMPER TESTED: reverting either file to its pre-#235 sentence.
    const structure = await readRepoFile('../../docs/project-structure.md');

    assert.notOk(structure.includes('`included`, the `POST`/`PATCH` response\n>    documents and `GET /:id/relationships/{rel}` still publish unfiltered'),
      'project-structure.md no longer lists `included` and the write documents as unfiltered');
    assert.ok(/#235\]\(https:\/\/github\.com\/abofs\/stonyx-orm\/issues\/235\) extended the filter/.test(structure),
      'it records that #235 extended the filter to them');
    assert.ok(/`GET \/:id\/relationships\/\{rel\}` \*\*still publishes unfiltered linkage\*\*/.test(structure),
      'and that the ONE route still open is still open — the correction did not overshoot into a clean bill of health');

    const usage = await readRepoFile('../../docs/usage-patterns.md');

    assert.notOk(usage.includes('`buildResponse` calls `toJSON({ baseUrl })` with no `linkage` verdict'),
      'usage-patterns.md no longer describes buildResponse as passing no verdict');
    assert.ok(/its\s+\*\*linkage is filtered\*\* \(abofs\/stonyx-orm#235\)/.test(usage),
      'it records that an included record’s linkage IS filtered');
    assert.ok(/still unfiltered\*\* \(abofs\/stonyx-orm#233\)/.test(usage),
      'and that MEMBERSHIP is a separate question that is still open — #235 must not read as closing #233');
  });
});
