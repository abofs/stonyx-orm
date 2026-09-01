// @ts-nocheck
//
// abofs/stonyx-orm#236 / #237 — `recordId` on the access context, and the close
// of the percent-encoding authorization bypass.
//
// Specification: the refinement comment on #228,
// https://github.com/abofs/stonyx-orm/issues/228#issuecomment-5489133390
//
// ---------------------------------------------------------------------------
// WHY A NEW FILE
//
// #237 AC10 is an assertion ABOUT other files' assertions: that the #222
// tripwires planted in test/integration/orm-test.ts were INVERTED rather than
// deleted, and that the assertion count in the four files the fix touches did
// not go DOWN. An assertion that a pin still exists cannot live in the same
// file as the pin — deleting both would be a silent pass. Same reasoning as
// test/unit/access-sample-migration-test.ts, which does this for #222.
// ---------------------------------------------------------------------------
import QUnit from 'qunit';

const { module, test } = QUnit;

async function readRepoFile(relativePath) {
  const { readFile } = await import('node:fs/promises');

  return readFile(new URL(relativePath, import.meta.url), 'utf8');
}

module('[Unit] recordId on the access context (#236/#237)', function() {
  test('AC1 (#236) — AccessContext DECLARES `recordId`, and the shipped docblock names the three normalisations that are now forbidden', async function(assert) {
    // A STATIC ASSERTION OVER SHIPPED TEXT, AND IT IS NOT DECORATION.
    // `package.json#files` ships `src`, so `src/types/orm-types.ts` is a file an
    // installing consumer reads and a TypeScript consumer compiles against. The
    // behaviour is pinned elsewhere (unit: test/unit/access-context-test.ts;
    // live router: test/integration/orm-test.ts); what is pinned HERE is that
    // the contract a consumer is handed says the same thing the code does.
    //
    // This exists because the failure mode of this whole issue family is a
    // consumer following documented guidance and failing OPEN. Five fail-open
    // variants of one three-line example, then a `.toLowerCase()` measured
    // wrong in BOTH directions, then a `decodeURIComponent(request.path)`
    // measured wrong the other way. The next consumer reads this docblock.
    //
    // KILLING MUTATION: add `recordId` to `auth()` and leave the interface
    // undocumented (or documented as "the id"), and every assertion below reds
    // while the behaviour stays green.
    const source = await readRepoFile('../../src/types/orm-types.ts');

    const start = source.indexOf('export interface AccessContext {');
    assert.ok(start !== -1, 'precondition: src/types/orm-types.ts declares the AccessContext interface');

    // SLICED TO THE `recordId` DOCBLOCK ITSELF — everything between the end of
    // the `operation` declaration and the `recordId` declaration. Asserting the
    // needles against the whole file would let #202's existing prose about
    // `request.path` and `getId` satisfy them, which is the vacuous-grep shape.
    const declaration = '\n  recordId: string | number | null;';
    const keyLine = source.indexOf(declaration, start);

    assert.ok(keyLine !== -1,
      'AccessContext declares `recordId: string | number | null` — `null` is a VALUE the framework produces, so it is in the type, and `undefined` is NOT');

    const contract = source.slice(source.indexOf('operation: AccessOperation | undefined;', start), keyLine);
    const iface = source.slice(start, source.indexOf('\n}', start));

    assert.ok(contract.includes('/**') && contract.includes('*/'),
      'and it is documented: a docblock sits between it and the key above it, not a bare declaration');
    assert.notOk(/recordId\?:/.test(iface),
      'and the key is not OPTIONAL — a context without it did not come from auth(), which is the only reason its absence is safe to refuse on');

    // The three prohibitions, each one a scheme that was built and measured
    // wrong. Named in the docblock, because a consumer who re-normalises this
    // value undoes the fix.
    for (const [needle, why] of [
      ['decoded', 'says the value is already decoded'],
      ['Do NOT decode it', 'forbids decoding it again — express decodes exactly once, and a loop denies the legitimate id `%61rchived`'],
      ['Do NOT case-fold it', 'forbids case-folding — measured a false DENY on /owners/ARCHIVED and a false ALLOW on /owners/%41RCHIVED, one line, both directions'],
      ['request.path', 'names request.path as the thing NOT to derive it from — decode-then-split over-denied /owners/archived%2fx'],
      ['getId(request.params)', 'says it is the same coercion the store lookup uses, so predicate and dispatch cannot disagree'],
      ['abofs/stonyx-orm#209', 'and that it inherits #209 along with that coercion, rather than leaving a reader to discover it'],
    ]) {
      assert.ok(contract.includes(needle), `the shipped AccessContext contract ${why}`);
    }

    // CONFIRM THE SLICE COULD FAIL: the same needles are absent from the
    // interface's own header docblock, so the assertions above really are
    // reading the `recordId` contract and not #202's surrounding prose.
    const header = source.slice(source.lastIndexOf('/**', start), start);

    assert.notOk(header.includes('Do NOT decode it'),
      'confirming the slice is doing work: the prohibitions are not satisfiable from the interface header, which predates this key');
  });

  test('AC10 (#237) — the #222 tripwires were INVERTED, not deleted, and no file lost assertions doing it', async function(assert) {
    // THE LOAD-BEARING ONE, AND IT IS AN ASSERTION ABOUT OTHER FILES'
    // ASSERTIONS. #222 planted assertions pinned to the DEFECTIVE state,
    // labelled so a reader would find them, and instructed the next engineer to
    // INVERT rather than delete them. A fix necessarily reds them. The failure
    // mode this exists to catch is "repair by deletion": delete the red
    // assertion, the suite goes green, and the only evidence the fix landed is
    // gone with it.
    //
    // IT CANNOT LIVE IN THE FILE IT MEASURES. An assertion that a pin still
    // exists, sitting beside that pin, is satisfied by deleting both. Same
    // reasoning as test/unit/access-sample-migration-test.ts, which does this
    // for #222.
    //
    // THREE CLAUSES, AND THE SECOND AND THIRD ARE WHAT MAKE IT FALSIFIABLE.
    // "No `DEFECT #228:` message survives" alone is satisfied by deletion —
    // that is the exact failure. The count floor distinguishes an inversion
    // from a deletion, and clause 3 reads the three specific pins by content.
    //
    // AND ALL THREE MEASURE CODE, WHICH THEY DID NOT. An earlier revision of this
    // file applied `codeOf()` to clause 1 only: clause 2 counted over the raw
    // source and clause 3 read its pins out of the raw source, so COMMENTING
    // OUT the two inverted tripwires at orm-test.ts left the whole suite green
    // (972/0) with this test passing, while hard-DELETING the same two lines
    // reded it (971/1). Commenting out is the same failure with one keystroke
    // of camouflage, and it is the form a tidy-up reaches for. Everything below
    // now goes through `codeOf`, and the tampers are enumerated where they are
    // asserted.
    //
    // BASELINES ARE CODE-ONLY OCCURRENCE COUNTS on origin/dev at c5f7907 --
    // `(codeOf(source).match(/assert\./g) ?? []).length`, the SAME metric the
    // assertion applies to the head. They were previously captured with
    // `grep -c` (which counts LINES) and compared as occurrences, so
    // access-sample-migration-test.ts's floor sat 3 BELOW its true origin/dev
    // reading (43 lines vs 46 occurrences, 44 of them in code). Capturing in
    // one unit and comparing in another is how a floor stops being a floor.
    const files = {
      '../integration/orm-test.ts': 590,
      './access-context-test.ts': 26,
      './access-filter-enforcement-test.ts': 203,
      './access-sample-migration-test.ts': 44,
    };

    const sources = {};
    for (const path of Object.keys(files)) sources[path] = await readRepoFile(path);

    // CLAUSE 1 — no assertion still carries a `DEFECT #228:` message.
    //
    // Measured over CODE, with `//` lines stripped, because the inverted
    // assertions' own comments have to be free to say what they were labelled
    // before — an assertion that forbade the string everywhere would forbid
    // explaining the inversion, which is the opposite of what #222 asked for.
    const codeOf = source => source
      .split('\n')
      .filter(line => !line.trim().startsWith('//'))
      .join('\n');

    assert.notOk(codeOf(sources['../integration/orm-test.ts']).includes('DEFECT #228:'),
      'no assertion in orm-test.ts still carries a `DEFECT #228:` message — the tripwire was answered, not left in place');
    assert.ok(sources['../integration/orm-test.ts'].includes('DEFECT #228:'),
      'while the comments still NAME the label, so the inversion is traceable to what it inverted (confirming clause 1 is measuring code, not prose)');

    // CLAUSE 2 — and no file paid for it with assertions. Baselines are the
    // code-only occurrence counts above, taken on origin/dev at c5f7907: the
    // head this branch started from, and the head the #228 refinement measured
    // the inversion budget against.
    //
    // A COUNT OF CALL SITES, AND ITS LIMIT IS STATED ON PURPOSE: it cannot tell
    // a real assertion from a trivial one, so it is a FLOOR, not a proof. The
    // proof that the specific pins were inverted rather than swapped for filler
    // is clause 3 below, which reads them by content.
    for (const [path, baseline] of Object.entries(files)) {
      const count = (codeOf(sources[path]).match(/assert\./g) ?? []).length;

      assert.ok(count >= baseline,
        `${path} carries ${count} EXECUTING assertion call sites (comments stripped), not fewer than the ${baseline} it had on origin/dev at c5f7907 — a net drop is the "repair by deletion" this AC exists to catch, and counting over codeOf() is what makes commenting an assertion out count as a drop rather than as prose padding the floor`);
    }

    // CLAUSE 3 — the specific pins, by content, at the tier they were planted.
    // Each pair is [what the defective head pinned, what the fixed head pins].
    // The first half must be GONE and the second half must be PRESENT AND
    // EXECUTING, so deleting the pin, commenting it out, rewording it, or
    // leaving it untouched all fail. Those four tampers were each run against
    // this clause on a clean rebuilt tree; what it does NOT catch is a changed
    // assertion message, which is deliberate — the pins are on the assertion
    // form, and the surrounding prose has to stay free to explain the
    // inversion.
    const orm = sources['../integration/orm-test.ts'];
    const ormCode = codeOf(orm);

    for (const [was, now, label] of [
      ["assert.equal(encoded.status, 200,", "assert.equal(encoded.status, 403,",
        'GET /owners/%61rchived: 200 -> 403 (orm-test.ts:1723)'],
      ["assert.ok(encoded.body.includes('\"secret\"')", "assert.notOk(encoded.body.includes('\"secret\"')",
        'and the record is no longer returned in full (orm-test.ts:1725)'],
      ["assert.equal(cased.status, 403,", "assert.equal(cased.status, 200,",
        'GET /owners/ARCHIVED: RE-SPECIFIED to 200 — a distinct record the /archived rule was never about (orm-test.ts:1680)'],
    ]) {
      // ABSENT-half over the RAW source (strictly stricter: the pre-fix form
      // must not reappear even inside a comment), PRESENT-half over CODE.
      assert.notOk(orm.includes(was), `${label} — the pre-fix form is gone`);
      assert.ok(ormCode.includes(now),
        `${label} — and the inverted form is present AND EXECUTING, at the same tier over the same socket. Tampers verified against this clause, each on a clean rebuilt tree: COMMENTING the assertion out reds it (was 972/0 green before codeOf was applied here), DELETING it reds it, and REWORDING it — e.g. assert.equal -> assert.strictEqual on the same pin — reds it. It does not catch a changed assertion MESSAGE, and is not claimed to.`);
    }

    // AC9 — AND THE LOCKSTEP THAT STOPS THE THREE COPIES DRIFTING IS STILL
    // WIRED, on the new signature. Both mechanisms are anchored on the same
    // exact literal; loosening either one to a regex, or letting them disagree,
    // would let the shipped README sample diverge from the matcher under test —
    // which is how fail-open variant 5 survived four review rounds.
    const SIGNATURE = "'  access(request, { model, operation, recordId }) {'";

    for (const path of ['./access-filter-enforcement-test.ts', './access-sample-migration-test.ts']) {
      assert.ok(sources[path].includes(`const ACCESS_SIGNATURE = ${SIGNATURE};`),
        `${path} still anchors the body extractor on the exact signature literal, updated for recordId`);
    }
  });
});
