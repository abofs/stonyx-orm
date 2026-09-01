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

const { module, test, todo } = QUnit;

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

  todo('AC10 (#237) — the #222 tripwires were INVERTED, not deleted', function(assert) {
    assert.ok(false, 'SCAFFOLD — not implemented');
  });
});
