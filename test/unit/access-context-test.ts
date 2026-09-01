// @ts-nocheck
//
// abofs/stonyx-orm#202 — the tier-independent half.
//
// ---------------------------------------------------------------------------
// WHY ONLY TWO ACs LIVE HERE
//
// The refinement pins the validation tier per AC and it is not the
// implementer's to choose (#202, "Refinement — revised (Sprint 83)", §7):
// anything that depends on request shape runs over the LIVE express router,
// because `makeRequest` in test/unit/access-filter-enforcement-test.ts:95-116
// FABRICATES `baseUrl` and `path` from a url string it also invents, and
// `dispatch` (:119-125) calls `auth()` directly with no router at all. Variant 5
// survived four review rounds inside that harness and was found only by
// raw-socket measurement.
//
// So AC1, AC2, AC3, AC5, AC7, AC8, AC9 and the integration half of AC4 are in
// test/integration/orm-test.ts, module 'Access Context and Registry (#202)'.
//
// What is left is what genuinely does not depend on the router:
//   AC4 (unit half) — the context object's own shape: `record` is absent.
//   AC6 (static)    — the two copies a consumer actually sees document the
//                     second argument.
// ---------------------------------------------------------------------------
import QUnit from 'qunit';
import { setupIntegrationTests } from 'stonyx/test-helpers';
import OrmRequest from '../../src/orm-request.js';

const { module, test, todo } = QUnit;

// The four verbs, and the ONLY four. Both copies of the documentation have to
// name every one of them; a copy that names three has not documented the
// vocabulary.
const VERBS = ['read', 'create', 'update', 'delete'];

// Reads a file relative to this test file. The two subjects are the two copies
// `npm pack` actually ships (package.json `files`: `dist`, `src`, `config`,
// `README.md`) — docs/usage-patterns.md and the sample access class do not ship
// and so are not what an installing consumer reads.
async function readRepoFile(relativePath) {
  const { readFile } = await import('node:fs/promises');

  return readFile(new URL(relativePath, import.meta.url), 'utf8');
}

// Asserts every needle is present in `haystack`, naming the missing one.
function containsAll(assert, haystack, needles, label) {
  for (const needle of needles) {
    assert.ok(haystack.includes(needle), `${label} states: ${needle}`);
  }
}

module('[Unit] access() context argument (#202)', function(hooks) {
  // `new OrmRequest(...)` reads the model registry and the plural registry, so
  // the app has to have finished booting. Same reason as
  // test/unit/access-filter-enforcement-test.ts:190.
  setupIntegrationTests(hooks);

  test('AC4 — the auth-time context carries no `record` key, and no key beyond model and operation', function(assert) {
    // An earlier draft of the issue proposed `{ model, operation, record }` and
    // it was refuted: @stonyx/rest-server `src/request.ts:58-60` runs `auth()`
    // after route matching but BEFORE any handler, so nothing has been fetched.
    // Supplying a record would mean a pre-fetch on EVERY request, in the middle
    // of an authorization path.
    //
    // This half is at the unit tier deliberately and legitimately: the claim is
    // about the context object's OWN SHAPE, which is built from `this.model` and
    // `methodAccessMap` and does not depend on any transport value. The claim
    // that DOES depend on transport — that a full dispatch through the live
    // router introduces no store read — is the integration half, in
    // test/integration/orm-test.ts.
    const seen = [];
    const ormRequest = new OrmRequest({
      model: 'animal',
      access: (request, context) => {
        seen.push(context);

        return true;
      },
    });

    // `auth()` reads exactly two things off the request: `request.method`, for
    // the operation lookup, and the request itself, which it forwards untouched
    // as argument one. Nothing else about the request shape is in play here.
    for (const method of ['GET', 'POST', 'PATCH', 'DELETE']) {
      ormRequest.auth({ method }, {});
    }

    assert.equal(seen.length, 4, 'the predicate was called once per operation');

    for (const context of seen) {
      assert.deepEqual(Object.keys(context).sort(), ['model', 'operation'],
        'the context carries exactly `model` and `operation`');
      assert.notOk('record' in context,
        'and NO `record` key — auth() runs before anything is fetched, so a record could only come from a new pre-fetch');
      assert.strictEqual(context.record, undefined, 'nor a record under any other reading');
    }

    assert.deepEqual(seen.map(context => context.operation), VERBS,
      'and the four operations are the four verbs, in method order GET/POST/PATCH/DELETE');
    assert.deepEqual([...new Set(seen.map(context => context.model))], ['animal'],
      'with `model` fixed at mount time on every one of them');
  });

  todo('AC1 (#236) — the auth-time context carries exactly `model`, `operation` and `recordId`', function(assert) {
    // SCAFFOLD. Replaces the two-key pin in AC4 above; see the refinement
    // comment on #228, §8 "#228a" assertion 1.
    assert.ok(false, 'SCAFFOLD — not implemented');
  });

  test('AC6 — src/orm-request.ts documents the second argument, its keys and the four-verb vocabulary', async function(assert) {
    // NET-NEW TEXT ONLY, and that restriction is the point of the AC. #201
    // already shipped the "do not reconstruct the request path" warning and the
    // five-variant list into this same header, so an assertion that merely
    // grepped the file for "access" or for the variant list would pass on work
    // this story did not do.
    //
    // So the header is SLICED at the #201 warning banner and every requirement
    // below is asserted against the slice ABOVE it — text that did not exist
    // before this story. Delete the new paragraphs and the slice collapses.
    const source = await readRepoFile('../../src/orm-request.ts');

    const contractStart = source.indexOf('THE `access()` CONTRACT');
    const priorWarning = source.indexOf('DO NOT RECONSTRUCT THE REQUEST PATH INSIDE `access()`');

    assert.ok(contractStart !== -1, 'the header carries an `access()` contract section');
    assert.ok(priorWarning !== -1, "and #201's URL-derivation warning is still there — this story retires nothing (that is #213)");
    assert.ok(contractStart < priorWarning, 'the contract section is net-new text ahead of it, not a re-reading of it');

    const netNew = source.slice(contractStart, priorWarning);

    containsAll(assert, netNew, [
      'access(request, { model, operation })',
      'context.model',
      'context.operation',
      ...VERBS.map(verb => `'${verb}'`),
      'undefined',
      'HEAD',
      "Orm.instance.getAccess('animal')",
    ], 'the shipped src/orm-request.ts header');

    assert.ok(/`record` IS NOT IN THIS CONTEXT/.test(netNew),
      'and says `record` is not in the context');
    assert.ok(netNew.includes('BEFORE any handler executes'),
      'and why: auth() runs before any handler executes, so a record would mean a pre-fetch');
    assert.ok(netNew.includes('ADDITIVE'),
      'and that the second argument is additive, so an existing single-argument predicate keeps working');

    // Vacuity guard. Every requirement above is asserted against the slice, so
    // it can only be met by text this story added — but only if the slice is
    // actually a slice. A `priorWarning` of -1 would have made `netNew` the
    // whole file and every assertion satisfiable by #201's text.
    assert.ok(netNew.length > 0 && netNew.length < source.length,
      'and the slice really is a slice of the header, not the whole file');
  });

  test('AC6 — README.md documents the second argument, its keys, and that `record` is absent and why', async function(assert) {
    const readme = await readRepoFile('../../README.md');

    // Sliced the same way and for the same reason: between the new section's
    // own heading and the pre-existing `### Return values`. The #201 warning
    // block (`Identifying the collection`) and the five-variant table both sit
    // OUTSIDE this slice, so neither can satisfy anything below.
    const sectionStart = readme.indexOf('### The access context (second argument)');
    const sectionEnd = readme.indexOf('### Return values', sectionStart);

    assert.ok(sectionStart !== -1, 'the README carries an access-context section');
    assert.ok(sectionEnd > sectionStart, 'and it ends at the pre-existing `### Return values`');

    const section = readme.slice(sectionStart, sectionEnd);

    containsAll(assert, section, [
      'access(request, { model, operation })',
      '`model`',
      '`operation`',
      ...VERBS.map(verb => `'${verb}'`),
      'kebab-case',
      'Orm.instance.getAccess(',
      'Orm.instance.accessFunctions',
    ], 'the README access-context section');

    assert.ok(section.includes('#### `record` is not in the context'),
      'and it states that `record` is not in the context');
    assert.ok(section.includes('before any handler executes'),
      'and why — nothing has been fetched when auth() runs');
    assert.ok(/additive/i.test(section),
      'and that the second argument is additive');
    assert.ok(section.includes('undefined') && section.includes('HEAD'),
      'and that `operation` is undefined rather than defaulted for a method express delivers but the map does not name');

    // The #201 text is still present and still OUTSIDE the slice. This story
    // adds; #213 retires.
    assert.ok(readme.includes('Identifying the collection'),
      "#201's URL-derivation warning is untouched");
    assert.notOk(section.includes('| 1 | `request.url` is mount-relative'),
      'and the five-variant table is not what satisfied any assertion above');
  });

  test('AC6 — both documented copies are copies a consumer actually receives', async function(assert) {
    // The AC names "the two copies a consumer sees", which is a claim about
    // packaging, not about prose. `npm pack` ships what `files` lists.
    // docs/usage-patterns.md and test/sample/access/global-access.ts do not
    // ship, so documenting the contract there only would not satisfy AC6.
    const packageJson = JSON.parse(await readRepoFile('../../package.json'));

    assert.ok(packageJson.files.includes('src'),
      'src/ ships, so the orm-request.ts header reaches an installing consumer');
    assert.ok(packageJson.files.includes('README.md'),
      'README.md ships too');
    assert.notOk(packageJson.files.includes('docs'),
      'docs/ does NOT ship — documenting the contract only there would not reach a consumer');
    assert.notOk(packageJson.files.includes('test'),
      'nor does test/, which is why the sample access class is not one of the two copies');
  });
});
