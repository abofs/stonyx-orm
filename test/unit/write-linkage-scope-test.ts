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
  test('[GUARD] #235 X1c — the nested-include test still asserts membership in BOTH directions', async function(assert) {
    // -----------------------------------------------------------------------
    // RE-SPECIFIED BY abofs/stonyx-orm#233, AND THE TEST NAME CHANGED WITH IT.
    // -----------------------------------------------------------------------
    // THE NAME USED TO BE `#233's included membership pin is still present in
    // orm-test.ts`. The name is changed rather than kept because the thing it
    // guards changed: there is no longer a pin asserting the hidden owner IS a
    // member, so a body still called "the membership pin is present" would be
    // checking something its name no longer describes. That is the failure
    // mode `[GUARD] #235 X2` was re-specified into once already.
    //
    // What it was, recorded rather than deleted, with the measurement that
    // justified it:
    //
    //     const membershipLine = "const owner = included.find(r => r.type ===
    //       'owner' && r.id === 'angela');";
    //     assert.strictEqual(source.split(membershipLine).length - 1, 2,
    //       'precondition: the membership literal occurs TWICE in the file');
    //     assert.strictEqual(body.split(membershipLine).length - 1, 1,
    //       'and the slice isolates exactly ONE of them');
    //     assert.ok(body.includes(membershipLine),
    //       "the nested-include test still SELECTS the hidden owner out of
    //        `included`");
    //     assert.ok(body.includes("assert.ok(owner, 'owner is included');"),
    //       "and still asserts she is a member -- that is #233's reproduction");
    //
    //   Measured at #235's merge: both literals present, the file-wide count
    //   exactly 2 (the nested-include test and the `get call with include
    //   parameter sideloads relationships` twin at :573).
    //
    // WHY IT HAD TO GO. Its job was "#233 must still have something to turn
    // red in Sprint 87" -- an anti-deletion guard on a REPRODUCTION. #233 has
    // now landed, so the reproduction is gone by design: `assert.ok(owner,
    // 'owner is included')` is precisely the assertion the fix falsifies, and
    // a guard demanding its presence is a guard demanding the bug.
    //
    // WHAT IT PINS INSTEAD, WHICH DOES NOT EXPIRE. The job generalises exactly
    // one step and then stops expiring: the nested-include test must assert
    // membership in BOTH DIRECTIONS, and neither half may be deleted. Before
    // #233 the two directions were "she is a member" and nothing; after #233
    // they are "the hidden owner is NOT a member" and "a PERMITTED owner
    // still IS". A repair that keeps only the negative is satisfied by a build
    // that never sideloads anything; a repair that keeps only the positive no
    // longer distinguishes the fix from `dev`. That is a property of the TEST,
    // not of any particular fixture id, so it survives the next fixture change
    // as well as this one.
    //
    // ONE NEEDLE PER CLAIM, KEYED ON THAT CLAIM'S OWN ASSERTION MESSAGE, AND
    // THAT IS A CORRECTION RATHER THAN A STYLE CHOICE. A guard in this family
    // was previously written as a COUNT of a string that three unrelated call
    // sites also matched, so deleting the thing it guarded left it green. Each
    // needle below is the message of exactly one assertion, so its count is
    // one-to-one with that assertion's existence.
    //
    // STILL SLICED TO ONE TEST BODY, AND THE PRECONDITION THAT JUSTIFIES THE
    // SLICE IS STILL LIVE. `precondition: angela really does own more than one
    // animal` occurs TWICE in the file -- here and in `[DEFECT] #233 AC4`,
    // which asserts the same store-derived fact for its own reason. A
    // file-wide `includes()` would therefore pin neither copy, exactly as the
    // original recorded. Widen the slice back to the whole file and the second
    // assertion below reads 2.
    //
    // TAMPER TESTED: commenting out either direction's assertion
    // (`withoutLineComments` removes it before the search), and deleting the
    // positive control while leaving the negative.
    const source = withoutLineComments(await readRepoFile('../integration/orm-test.ts'));

    const testStart = source.indexOf("test('get call with nested include parameter sideloads deep relationships'");
    assert.ok(testStart > -1, 'precondition: the nested-include test is findable by name');
    const body = source.slice(testStart, source.indexOf("\n    test(", testStart + 10));
    assert.ok(body.length > 0 && body.length < 4000, 'precondition: the slice is one test body, not the rest of the file');

    const sliceJustifier = 'precondition: angela really does own more than one animal';
    assert.strictEqual(source.split(sliceJustifier).length - 1, 2,
      'precondition: the store-derived precondition occurs TWICE in the file — which is why a file-wide includes() would pin neither');
    assert.strictEqual(body.split(sliceJustifier).length - 1, 1,
      'and the slice isolates exactly ONE of them, so deleting THIS test’s copy reds this guard');

    const negative = 'the hidden owner is NOT a member of `included` (was: her full document)';
    const positive = 'a PERMITTED owner is still a member of `included`';

    assert.strictEqual(body.split(negative).length - 1, 1,
      'the NEGATIVE direction is asserted exactly once — the hidden owner is not a member');
    assert.strictEqual(body.split(positive).length - 1, 1,
      'and the POSITIVE direction exactly once — a permitted owner still is, so this is not green against a build that never sideloads');
  });

  test('[GUARD] #235 R1c — the nested-include leak assertion is re-specified a second time, not deleted', async function(assert) {
    // -----------------------------------------------------------------------
    // RE-SPECIFIED BY abofs/stonyx-orm#233. THIS IS THE SECOND TIME THE SAME
    // ASSERTION HAS MOVED, AND BOTH MOVES ARE RECORDED HERE.
    // -----------------------------------------------------------------------
    // MOVE 1 (#235). `included.filter(r => r.type === 'animal' &&
    // r.relationships.owner?.data?.id === 'angela')` was THE LEAK WRITTEN AS A
    // REQUIREMENT: it asserted that eight permitted animals each publish the
    // id of an owner the caller gets a 404 for. #235 nulls that linkage, so
    // the selector matched nothing. It was re-specified, not deleted, to
    // `const angelaPets = included.filter(r => r.type === 'animal');` feeding
    // `assert.ok(angelaPets.length > 1, 'owner pets are included via nested
    // relationship');`, with `assert.ok(expectedPets.length > 1, ...)` as the
    // precondition that stopped it passing against an empty `included`.
    //
    // MOVE 2 (#233), and what it was immediately before this change:
    //
    //     assert.ok(source.includes("const angelaPets = included.filter(r =>
    //       r.type === 'animal');"),
    //       'the re-specified selector is present');
    //     assert.ok(source.includes("assert.ok(angelaPets.length > 1, 'owner
    //       pets are included via nested relationship');"),
    //       'and the assertion it feeds still exists');
    //     assert.ok(source.includes("assert.ok(expectedPets.length > 1,
    //       'precondition: angela really does own more than one animal');"),
    //       'the re-specification carries a precondition');
    //
    //   Measured on dev @ c106cf9: `GET /animals/1?include=owner,owner.pets`
    //   returned `included` = 9 resources, of which 8 were angela's animals
    //   `[1, 3, 7, 10, 11, 15, 17, 20]` -- which IS her `pets` array.
    //
    // WHY IT HAD TO MOVE AGAIN. `angelaPets.length > 1` is the SUBTREE, and
    // #233 prunes the subtree: those eight animals reached `included` only by
    // traversing THROUGH a parent the caller is 404 on, so asserting more than
    // one of them survives is asserting the leak. The variable is still called
    // `angelaPets` and the assertion on it is now `deepEqual(angelaPets, [])`.
    //
    // WHAT IT PINS INSTEAD, WHICH DOES NOT EXPIRE. The invariant across BOTH
    // moves is the same one, and it is the only part that never expired: this
    // test must still SELECT the records that would leak, must still assert
    // something about them that a leak would falsify, and must still carry a
    // precondition proving the selection is non-empty in the store -- so that
    // no re-specification, this one included, can pass by emptying `included`.
    // The direction of the assertion is the part that belongs to whichever
    // story last touched it; the three structural halves are not.
    //
    // ONE NEEDLE PER CLAIM, KEYED ON THAT CLAIM'S OWN ASSERTION MESSAGE --
    // see the note in `X1c` above for the guard in this family that was
    // written as a count over a string three unrelated call sites matched.
    //
    // TAMPER TESTED: deleting the prune assertion outright (needle 2 reds),
    // deleting the positive control while leaving the prune (needle 4 reds --
    // which is the mutation that would otherwise leave this green against a
    // build that never sideloads), and commenting the store-derived
    // precondition out (`withoutLineComments` removes it, needle 3 reds).
    const source = withoutLineComments(await readRepoFile('../integration/orm-test.ts'));

    const testStart = source.indexOf("test('get call with nested include parameter sideloads deep relationships'");
    assert.ok(testStart > -1, 'precondition: the nested-include test is findable by name');
    const body = source.slice(testStart, source.indexOf("\n    test(", testStart + 10));
    assert.ok(body.length > 0 && body.length < 4000, 'precondition: the slice is one test body, not the rest of the file');

    // 1. THE ORIGINAL LEAK SELECTOR IS STILL GONE. Unchanged from #235, and
    // deliberately file-wide rather than sliced: no assertion ANYWHERE may
    // select sideloaded records by the hidden owner's id.
    assert.notOk(source.includes("r.relationships.owner?.data?.id === 'angela'"),
      'no assertion selects sideloaded records BY the hidden owner’s id any more');

    // 2. THE SUBTREE IS STILL SELECTED AND STILL ASSERTED ABOUT.
    assert.strictEqual(body.split('and NONE of her pets reached `included` either').length - 1, 1,
      'the subtree assertion is present exactly once — the records that would leak are still selected and still asserted about');

    // 3. AND IT STILL CARRIES THE STORE-DERIVED PRECONDITION, so it cannot
    // pass against an empty `included` — the property that survived both moves.
    assert.strictEqual(body.split('precondition: angela really does own more than one animal').length - 1, 1,
      'and the store-derived precondition survived the second move, so an empty `included` is not a pass');

    // 4. AND THE POSITIVE CONTROL, which is what stops #3 being satisfied by a
    // build that sideloads nothing at all.
    assert.strictEqual(body.split('owner pets are still included via the nested relationship').length - 1, 1,
      'and the positive control is present exactly once — a permitted owner’s pets DO still reach `included` via the nested hop');
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
    // RE-SPECIFIED BY abofs/stonyx-orm#232 LANDING AS PR #247.
    //
    // What stood here:
    //
    //     assert.ok(/`GET \/:id\/relationships\/\{rel\}` \*\*still publishes
    //       unfiltered linkage\*\*/.test(structure),
    //       'and that the ONE route still open is still open — the correction
    //        did not overshoot into a clean bill of health');
    //
    // It required a doc to say that a SIBLING PR's route is still broken. That
    // is a claim on the sibling's territory, and it went red the moment #232
    // did its job -- code-review.md § "A clean auto-merge in a shared file is
    // not evidence of compatibility", rules 3 and 5.
    //
    // The guard's real subject is this file's own currency, and the thing that
    // must not overshoot into a clean bill of health is the MECHANISM's limit,
    // which #232 closing one route does not remove: the filter rides
    // `toJSON()`, so a surface that builds its payload by hand is not reached
    // by the `linkage` option and has to filter itself. That is WHY the route
    // needed a separate change with a separate owner, and it is still the
    // warning the next reader of this file needs -- the next hand-built
    // surface inherits it.
    //
    // TAMPER TESTED: deleting the sentence; and replacing the whole limit with
    // an unqualified "every surface is filtered", which reds both assertions.
    assert.ok(/it is not a\n>\s+`toJSON\(\)` call site at all/.test(structure),
      'and that the mechanism’s limit is still stated — a surface that does not call `toJSON()` is not reached by the option, whoever has since closed it');
    assert.ok(/\*\*off it as of\n>\s+\[#232\]\(https:\/\/github\.com\/abofs\/stonyx-orm\/issues\/232\)\*\*/.test(structure),
      'and the one such surface is attributed to the owner that closed it, adjacently, rather than reported here as still open');

    const usage = await readRepoFile('../../docs/usage-patterns.md');

    assert.notOk(usage.includes('`buildResponse` calls `toJSON({ baseUrl })` with no `linkage` verdict'),
      'usage-patterns.md no longer describes buildResponse as passing no verdict');
    assert.ok(/its\s+\*\*linkage is filtered\*\* \(abofs\/stonyx-orm#235\)/.test(usage),
      'it records that an included record’s linkage IS filtered');
    assert.ok(/still unfiltered\*\* \(abofs\/stonyx-orm#233\)/.test(usage),
      'and that MEMBERSHIP is a separate question that is still open — #235 must not read as closing #233');
  });
});
