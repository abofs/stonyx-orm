// @ts-nocheck
//
// abofs/stonyx-orm#234 — the two halves of the change that are NOT
// request-shaped, plus the documentation the change obliges.
//
//   1. THE DEFAULT. `Record.toJSON` is also the `JSON.stringify` hook, so an
//      implicit caller arrives as `toJSON('data')` — a STRING in the options
//      slot — and has no syntactic place to pass a verdict
//      (abofs/stonyx-orm#230). The no-argument document must therefore be
//      byte-identical to what shipped before this change, and fail-closed by
//      default is not available: `Orm.instance.accessFunctions` is `{}` in any
//      process that never ran `setup-rest-server`, so a fail-closed default
//      would empty every relationship on every document in a CLI, an SQL-only
//      process or a unit test — a breaking change to a serialization API in
//      processes with no REST surface to protect.
//
//   2. ONE VERDICT INTERPRETER. `auth()` and the linkage path must read a
//      consumer `access()` return through the SAME function, or the two answer
//      differently about the same value and the linkage path becomes a second,
//      unreviewed authorization vocabulary.
//
import QUnit from 'qunit';
import sinon from 'sinon';
import { readFile } from 'node:fs/promises';
import Orm, { createRecord, store } from '@stonyx/orm';
import * as ormPackage from '@stonyx/orm';
import log from 'stonyx/log';
import { setupIntegrationTests } from 'stonyx/test-helpers';
import OrmRequest from '../../src/orm-request.js';
import Record from '../../src/record.js';
import { interpretAccess, createLinkageFilter } from '../../src/access-verdict.js';

const { module, test } = QUnit;

// A request object is required by `auth()` only for its `.method`, and by the
// shipped fixture for its `.path`. These are the values the LIVE router
// produces for `GET /animals` — the assertions below are about verdict
// INTERPRETATION, which is pure, not about request identification, which is
// asserted over the live router in test/integration/orm-test.ts.
const READ_REQUEST = { method: 'GET', path: '/', params: {}, query: {} };

module('[Unit] #234 linkage verdict', function(hooks) {
  setupIntegrationTests(hooks);

  // The fixture records this file needs are BUILT HERE rather than read out of
  // the store. Unit modules that run earlier clear the model stores wholesale
  // (test/unit/record-tojson-cleaned-test.ts does it in beforeEach AND
  // afterEach, and the memory-eviction module evicts), so `store.get('animal',
  // 1)` is `undefined` by the time this module runs — measured, not assumed.
  // An assertion about the DEFAULT document must not depend on which unit file
  // ran before it.
  const OWNER_ID = 'zz-234-owner';
  const RELATED_ID = 9234;

  const seed = () => {
    createRecord('owner', { id: OWNER_ID, gender: 'female', age: 36, pets: [], phoneNumbers: [] }, { serialize: false });
    createRecord('trait', { id: RELATED_ID, type: 'color', value: 'black' }, { serialize: false });

    return createRecord('animal', {
      id: RELATED_ID, type: 1, age: 2, size: 'small', owner: OWNER_ID, traits: [RELATED_ID]
    }, { serialize: false });
  };

  const unseed = () => {
    store.remove('animal', RELATED_ID, { _skipAutoPersist: true });
    store.remove('trait', RELATED_ID, { _skipAutoPersist: true });
    store.remove('owner', OWNER_ID, { _skipAutoPersist: true });
  };

  // The document these records produce today, before this change, in full.
  const PRE_CHANGE_RELATIONSHIPS = {
    owner: { data: { type: 'owner', id: OWNER_ID } },
    traits: { data: [{ type: 'trait', id: RELATED_ID }] }
  };

  test('[GUARD] #234 AC5 — a zero-argument toJSON() produces the pre-change document', function(assert) {
    const record = seed();

    try {
      const document = record.toJSON();

      // THE PRE-CHANGE DOCUMENT, PINNED. No verdict was supplied, so linkage is
      // emitted exactly as it was before #234 — which is also the residual
      // exposure this change deliberately does not close, for the reasons in
      // this file's header and in src/access-verdict.ts.
      assert.deepEqual(document.relationships, PRE_CHANGE_RELATIONSHIPS,
        'linkage is unfiltered and unchanged when no verdict is supplied');

      assert.deepEqual(Object.keys(document).sort(), ['attributes', 'id', 'relationships', 'type'],
        'and no key was added to or removed from the document');
      assert.notOk('links' in document, 'no baseUrl was supplied, so no links — exactly as before');

      // A zero-argument call must remain LEGAL, not merely tolerated: the new
      // option is optional and the arity the language reports is unchanged.
      assert.strictEqual(Record.prototype.toJSON.length, 0,
        'toJSON still declares zero required parameters');

      // CONFIRMS THE CHECK COULD HAVE FAILED. Without this, every assertion
      // above is equally green against a build in which the `linkage` option
      // was never wired up at all.
      const filtered = record.toJSON({ linkage: () => false });
      assert.strictEqual(filtered.relationships.owner.data, null, 'a supplied verdict DOES empty a belongsTo');
      assert.deepEqual(filtered.relationships.traits.data, [], 'and DOES empty a hasMany');

      // And it is applied per RELATED TYPE, not globally: the option receives
      // the linked model's name, so one relationship can be dropped while its
      // sibling on the same document is kept.
      const partial = record.toJSON({ linkage: type => type !== 'owner' });
      assert.strictEqual(partial.relationships.owner.data, null, 'the named type is dropped');
      assert.deepEqual(partial.relationships.traits.data, [{ type: 'trait', id: RELATED_ID }],
        'while its sibling is untouched');
    } finally {
      unseed();
    }
  });

  test('[GUARD] #234 AC5b — JSON.stringify({ data: record }) is unchanged', function(assert) {
    const record = seed();

    try {
      // The ECMAScript serialization protocol calls `record.toJSON('data')` —
      // the KEY, a string, in the slot the new option lives in. Destructuring a
      // string yields `undefined` for every key, which is exactly the
      // no-argument default, so the implicit path keeps working.
      assert.deepEqual(JSON.parse(JSON.stringify({ data: record })), { data: record.toJSON() },
        'the implicit caller and the explicit zero-argument caller agree');

      assert.deepEqual(record.toJSON('data').relationships, PRE_CHANGE_RELATIONSHIPS,
        'a STRING in the options slot is read as the default, not as options');

      // And it does not throw. Throwing out of `toJSON` throws out of the
      // enclosing `JSON.stringify`, which would break `console.log`, logging and
      // `Orm.db.save()`'s neighbours — a far worse failure mode than an HTTP
      // status, and the second reason this change DROPS rather than errors.
      assert.strictEqual(typeof JSON.stringify(record), 'string', 'a bare stringify of a record still works');
    } finally {
      unseed();
    }
  });

  test('[GUARD] #234 AC9 — auth() and the linkage path share one verdict interpreter', function(assert) {
    // Six documented return shapes, plus the function shape, asked BOTH ways.
    // A second inline copy of the six branches is the failure this asserts
    // against: it can drift, and a reviewer has to notice that it drifted.
    const shapes = [
      ['false', false, false],
      ["'read'", 'read', true],
      ["['read']", ['read'], true],
      ['true', true, true],
      ['{}', {}, false],
      ['42', 42, false],
    ];

    const registry = Orm.instance.accessFunctions;
    const PROBE = 'zz-234-verdict-probe';

    for (const [label, shape, expected] of shapes) {
      // Through auth(): the shipped path, unchanged in behaviour.
      const ormRequest = new OrmRequest({ model: 'animal', access: () => shape });
      const state = {};
      const status = ormRequest.auth(READ_REQUEST, state);
      const authGranted = status === undefined;

      // Through the linkage path: `getAccess(type)` -> interpret -> apply.
      registry[PROBE] = () => shape;
      let linkageGranted;

      try {
        linkageGranted = createLinkageFilter(READ_REQUEST)(PROBE, { id: 1 });
      } finally {
        delete registry[PROBE];
      }

      assert.strictEqual(authGranted, expected, `auth() reads ${label} as ${expected ? 'grant' : 'deny'}`);
      assert.strictEqual(linkageGranted, authGranted, `and the linkage path agrees about ${label}`);
      assert.strictEqual(status, expected ? undefined : 403, `auth() answers ${label} with the shipped status`);
    }

    // The seventh shape is the interesting one, because the two paths APPLY it
    // differently while INTERPRETING it identically: auth() plants it in
    // `state.filter` for the handler to use on the addressed records; the
    // linkage path runs it against the related record directly.
    const predicate = record => record.id !== 'angela';
    const ormRequest = new OrmRequest({ model: 'owner', access: () => predicate });
    const state = {};

    assert.strictEqual(ormRequest.auth(READ_REQUEST, state), undefined, 'a function return grants the request');
    assert.strictEqual(state.filter, predicate, 'and auth() plants it as the per-record filter, by identity');

    registry[PROBE] = () => predicate;

    try {
      const linkage = createLinkageFilter(READ_REQUEST);
      assert.strictEqual(linkage(PROBE, { id: 'gina' }), true, 'the linkage path applies the same predicate per record');
      assert.strictEqual(linkage(PROBE, { id: 'angela' }), false, 'and denies the record it rejects');
    } finally {
      delete registry[PROBE];
    }

    // Called directly, so a mutation to `interpretAccess` cannot hide behind
    // either caller. `undefined` for `operation` is REACHABLE — express
    // delivers HEAD to the GET handler and `methodAccessMap` has no entry for
    // it — and it must deny rather than be defaulted to 'read'.
    assert.deepEqual(interpretAccess(['read'], undefined), { granted: false },
      'an unclassified operation denies rather than being defaulted');
    assert.deepEqual(interpretAccess('', 'read'), { granted: false }, 'an empty string is falsy and denies');
    assert.strictEqual(interpretAccess(predicate, 'read').filter, predicate,
      'the function shape is carried through by identity, not wrapped');
  });

  test('[DEFECT] #234 AC10 — a supplied-but-unusable `linkage` denies, and cannot throw out of JSON.stringify', function(assert) {
    // `linkage` is PUBLIC (`OrmRecord.toJSON`, src/types/orm-types.ts) and the
    // README tells consumers to pass one, so it arrives from outside this
    // package and may be any value. Measured on the pre-fix build, both halves
    // silently wrong in opposite directions:
    //
    //   toJSON({ linkage: null })  -> owner {"type":"owner","id":"..."}   FULL PRE-#234 LEAK
    //   toJSON({ linkage: true })  -> THREW TypeError: linkage is not a function
    //
    // The first is the shape a resolver takes when it cannot resolve a session
    // -- the fail-closed INTENT -- read as "no verdict supplied". The second is
    // the outcome src/record.ts's own comment promises cannot happen, because a
    // throw here escapes the enclosing `JSON.stringify`.
    const record = seed();
    const errorStub = sinon.stub(log, 'error');

    try {
      // ABSENT is the one value that still means "no verdict". Load-bearing:
      // AC5/AC5b depend on it, and it is the `JSON.stringify` hook path.
      assert.deepEqual(record.toJSON({ linkage: undefined }).relationships, PRE_CHANGE_RELATIONSHIPS,
        'an ABSENT linkage is still today\'s document — `undefined` is not "unusable"');
      assert.strictEqual(errorStub.callCount, 0, 'and absent is not an error');

      // Everything else is supplied-and-unusable. Falsy leaked; truthy threw.
      const unusable = [
        ['null', null], ['0', 0], ['false', false], ["''", ''],
        ['true', true], ["'x'", 'x'], ['{}', {}], ['[]', []],
      ];

      for (const [label, value] of unusable) {
        errorStub.resetHistory();

        let document;
        assert.strictEqual(typeof (document = record.toJSON({ linkage: value })), 'object',
          `toJSON({ linkage: ${label} }) returns a document rather than throwing`);

        assert.strictEqual(document.relationships.owner.data, null,
          `${label} DENIES the belongsTo (was: the full pre-#234 linkage, or a TypeError)`);
        assert.deepEqual(document.relationships.traits.data, [],
          `${label} DENIES the hasMany`);

        // The wire shape is deliberately indistinguishable from a genuinely
        // empty relationship, so the log is the ONLY signal a consumer whose
        // resolver quietly returned `null` will ever get. Once per DOCUMENT --
        // this record has TWO relationships, so a per-key or per-record log
        // would count higher and a missing one would count zero.
        assert.strictEqual(errorStub.callCount, 1,
          `${label} is reported exactly once per document, not once per relationship`);
        assert.ok(/must be a function/.test(errorStub.firstCall.args[0]),
          `${label} says what was wrong with it`);
      }

      // And the promise src/record.ts makes: no value of this option throws out
      // of the enclosing `JSON.stringify`, which would take `console.log` and
      // `Orm.db.save()`'s neighbours down with it.
      for (const [label, value] of unusable) {
        const wrapper = { toJSON: () => record.toJSON({ linkage: value }) };
        assert.strictEqual(typeof JSON.stringify({ data: wrapper }), 'string',
          `JSON.stringify survives a linkage of ${label}`);
      }

      // CONFIRMS THE CHECK COULD HAVE FAILED: a usable verdict is still applied
      // rather than everything being denied wholesale.
      assert.deepEqual(record.toJSON({ linkage: () => true }).relationships, PRE_CHANGE_RELATIONSHIPS,
        'a FUNCTION that grants still emits the full linkage');
    } finally {
      errorStub.restore();
      unseed();
    }
  });

  test('[GUARD] #234 AC11 — the decision cache keys on the RAW id, so 1 and \'1\' stay distinct', function(assert) {
    // The PR presents this as a deliberate, security-relevant choice, and it was
    // pinned by nothing: `String(id)` AND the exact `${type}:${id}` composite the
    // comment warns against BOTH survived the full 979-test suite.
    //
    // The hazard the comment claimed — "let one model's verdict answer for
    // another record" — is unachievable: `decisions` is already partitioned per
    // type by `byType`, so a composite key inside a per-type map is one-to-one
    // with the raw one. The real exposure is narrower and entirely WITHIN one
    // model: two records whose ids differ only by JavaScript type. This fixture
    // cannot produce it (owner ids are strings, animal ids are numbers), so the
    // probe builds it.
    const registry = Orm.instance.accessFunctions;
    const PROBE = 'zz-234-rawid-probe';
    let recordCalls = 0;

    registry[PROBE] = () => record => { recordCalls++; return typeof record.id === 'number'; };

    try {
      const first = createLinkageFilter(READ_REQUEST);
      assert.strictEqual(first(PROBE, { id: 1 }), true, 'the numeric id 1 is permitted');
      assert.strictEqual(first(PROBE, { id: '1' }), false,
        "and the string id '1' is a DIFFERENT record, asked separately (String(id) and `${type}:${id}` both answer true here)");

      // Both orders, because a collapsing key is order-sensitive: whichever
      // record is asked first wins and answers for the other.
      recordCalls = 0;
      const second = createLinkageFilter(READ_REQUEST);
      assert.strictEqual(second(PROBE, { id: '1' }), false, "the string id '1' is denied when asked first");
      assert.strictEqual(second(PROBE, { id: 1 }), true, 'and the numeric id 1 is still permitted after it');
      assert.strictEqual(recordCalls, 2, 'two distinct raw ids means two predicate invocations, not one cached answer');

      // CONFIRMS THE CACHE IS GENUINELY CONSULTED — without this, the two
      // assertions above are equally green against a build with no cache at
      // all, which is the opposite defect.
      recordCalls = 0;
      const third = createLinkageFilter(READ_REQUEST);
      third(PROBE, { id: 7 });
      third(PROBE, { id: 7 });
      third(PROBE, { id: 7 });
      assert.strictEqual(recordCalls, 1, 'and the SAME raw id is decided once and cached');
    } finally {
      delete registry[PROBE];
    }
  });

  test('[DEFECT] #234 AC12 — both fail-closed catch branches are entered, and both deny', function(assert) {
    // These two blocks were DEAD under the 979: inverting each to GRANT — the
    // fail-open direction, on a security path — left the suite at 979/0/0, and
    // replacing BOTH bodies with `throw` also left it at 979/0/0, which is the
    // decisive measurement: no test entered either block.
    const registry = Orm.instance.accessFunctions;
    const PROBE = 'zz-234-throwing-probe';
    const errorStub = sinon.stub(log, 'error');

    try {
      // BRANCH 1 — `resolveVerdict`'s catch. The consumer `access()` itself
      // throws while being asked about a related model.
      registry[PROBE] = () => { throw new Error('boom-in-access'); };

      const resolveFilter = createLinkageFilter(READ_REQUEST);
      let verdict;

      assert.strictEqual(typeof (verdict = resolveFilter(PROBE, { id: 1 })), 'boolean',
        'a throwing access() does not propagate out of the filter');
      assert.strictEqual(verdict, false, 'it DENIES (mutating this branch to GRANT was invisible to all 979 tests)');
      assert.strictEqual(errorStub.callCount, 1, 'and it is logged — a silently-emptied relationship has no other signal');
      assert.ok(/access\(\) threw while resolving linkage/.test(errorStub.firstCall.args[0]),
        'the log names the branch that denied');
      assert.ok(errorStub.firstCall.args[0].includes('boom-in-access'), 'and carries the consumer error');

      // Bounded: at most once per type per request, so a predicate that throws
      // on every record cannot flood the log.
      resolveFilter(PROBE, { id: 2 });
      resolveFilter(PROBE, { id: 3 });
      assert.strictEqual(errorStub.callCount, 1, 'the per-type verdict is cached, so the denial is logged once per type');

      // BRANCH 2 — the per-record catch. `access()` returns a predicate, and
      // THAT throws. A different branch, one layer down, reached only after a
      // verdict has already been granted.
      errorStub.resetHistory();
      registry[PROBE] = () => () => { throw new Error('boom-per-record'); };

      const recordFilter = createLinkageFilter(READ_REQUEST);

      assert.strictEqual(typeof (verdict = recordFilter(PROBE, { id: 1 })), 'boolean',
        'a throwing per-record predicate does not propagate either');
      assert.strictEqual(verdict, false, 'it DENIES (mutating this branch to GRANT was also invisible to all 979 tests)');
      assert.strictEqual(errorStub.callCount, 1, 'and is logged');
      assert.ok(/access filter threw while filtering linkage/.test(errorStub.firstCall.args[0]),
        'with the OTHER message — the two branches are distinguishable in a log');

      // Bounded per distinct (type, id), and the denial is cached like any
      // other decision rather than re-thrown per lookup.
      recordFilter(PROBE, { id: 1 });
      assert.strictEqual(errorStub.callCount, 1, 'the denial is cached per (type, id), so one record logs once');
      recordFilter(PROBE, { id: 2 });
      assert.strictEqual(errorStub.callCount, 2, 'and a second record is a second decision');

      // CONFIRMS THE CHECKS COULD HAVE FAILED: the same probe registry entry,
      // not throwing, grants — so `false` above is the catch branch answering
      // and not an unrelated denial.
      errorStub.resetHistory();
      registry[PROBE] = () => () => true;
      assert.strictEqual(createLinkageFilter(READ_REQUEST)(PROBE, { id: 1 }), true,
        'a non-throwing predicate on the same probe type grants');
      assert.strictEqual(errorStub.callCount, 0, 'and logs nothing');
    } finally {
      errorStub.restore();
      delete registry[PROBE];
    }
  });

  test('[GUARD] #234 AC13 — the linkage path asks about the RELATED model, for a READ', function(assert) {
    // `model` was well covered (dropping the context kills 7, including
    // orm-test.ts:953). `operation` was not: `'delete'` survived at 979/0/0,
    // so a consumer predicate that branches on `context.operation` — which #222
    // made the supported contract — could be asked the wrong question and
    // nothing here would notice.
    const registry = Orm.instance.accessFunctions;
    const PROBE = 'zz-234-context-probe';
    const seen = [];

    registry[PROBE] = (request, context) => { seen.push({ request, context }); return true; };

    try {
      assert.strictEqual(createLinkageFilter(READ_REQUEST)(PROBE, { id: 1 }), true, 'precondition: the probe grants');
      assert.strictEqual(seen.length, 1, 'the consumer predicate was asked exactly once');
      assert.deepEqual(seen[0].context, { model: PROBE, operation: 'read' },
        'asked about the RELATED model, for a read — naming an id is a read, whatever verb the request carries');
      assert.strictEqual(seen[0].request, READ_REQUEST,
        'and handed the live request by identity, not a fabricated one');
    } finally {
      delete registry[PROBE];
    }
  });

  test('[GUARD] #234 AC14 — the one interpreter is reachable from the package entry point', function(assert) {
    // The README tells a consumer serializing a `Record` outside the REST layer
    // to pass their own resolved `linkage`. Without an exported factory the
    // only way to follow that advice is to write a SECOND reading of `access()`
    // in consumer code — the exact "unreviewed second authorization vocabulary"
    // src/access-verdict.ts exists to prevent, reproduced where no reviewer of
    // this repo will ever see it drift.
    assert.strictEqual(typeof ormPackage.createLinkageFilter, 'function',
      '`createLinkageFilter` is exported from @stonyx/orm');
    assert.strictEqual(ormPackage.createLinkageFilter.length, 1, 'and takes the request');

    const filter = ormPackage.createLinkageFilter(READ_REQUEST);
    assert.strictEqual(typeof filter, 'function', 'it returns a filter');
    assert.strictEqual(filter.length, 2, 'of the (type, record) arity `toJSON`s `linkage` option expects');

    // Reachable AND correct through the public name: an unclaimed model denies,
    // so the exported factory is the same fail-closed primitive the four wired
    // surfaces use, not a laxer public wrapper.
    assert.strictEqual(filter('zz-234-model-claimed-by-nothing', { id: 1 }), false,
      'and it fails closed on a model no access class claims');
  });

  test('[GUARD] #234 AC8 — README Known limitations records the linkage and format() scope', async function(assert) {
    const readme = await readFile(new URL('../../README.md', import.meta.url), 'utf8');
    const start = readme.indexOf('### Known limitations');
    assert.ok(start > -1, 'precondition: the section exists');

    const section = readme.slice(start, readme.indexOf('\n## ', start));

    assert.ok(section.includes('Relationship linkage is filtered on the four request-bound read surfaces'),
      'the section states WHICH surfaces filter linkage');
    assert.ok(section.includes('`format()` and `serialize()` are deliberately not filtered'),
      'the section states that the persistence path is out of scope, and stays out');
    assert.ok(section.includes('data loss'),
      'and says why — filtering the persistence path writes a truncated database');
    assert.ok(section.includes('A bare `toJSON()` still emits unfiltered linkage'),
      'the residual exposure on the language-hook path is recorded as consumer-facing behaviour');
    assert.ok(/issues\/230/.test(section), 'and points at the issue that closes it');
    assert.ok(/issues\/233/.test(section), 'the `included` MEMBERSHIP boundary is attributed to its own issue');

    // #233 alone is the WRONG pointer for what this PR defers, and it was for
    // three reviews: #233 owns whether a resource appears in `included` at
    // all; the deferred LINKAGE work -- inside `included` and on the two write
    // handlers -- is #235, which appeared nowhere in this repository. A reader
    // who follows the only link given lands on membership and is never told
    // that a PERMITTED record still publishes hidden ids.
    assert.ok(/issues\/235/.test(section),
      'and the deferred LINKAGE residual is attributed to #235, not folded into the membership issue');
    assert.ok(section.includes('PATCH /animals/1'),
      'the POST/PATCH exclusion states its consequence rather than naming the handlers');

    // The security claim this section is not permitted to make unqualified.
    // `docs/project-structure.md` carries the standing rule; the measured
    // counter-example is an arity-1 predicate, which GRANTS.
    assert.ok(/does not guarantee a model-correct\s+answer/.test(section),
      'the linkage bullet does not assert model-correct filtering unqualified');
    assert.ok(/single-argument predicate remains the default in every consumer\s+tree/.test(section),
      'and names the shape that makes it grant');
    assert.ok(/issues\/221/.test(section),
      'and points at the arity signal that would surface an unmigrated predicate');
    assert.notOk(/filtered\s*\n?\s*through the related model's own access class on `GET/.test(section),
      'the unqualified "filtered through the related model\'s own access class" claim is gone');

    // quality.md rule 2: the consumer obligation lives in ONE findable place,
    // not only in a design doc, an agent brief or a code comment.
    assert.ok(readme.includes('### Consumer Contracts'),
      'the README has a Consumer Contracts section (grep -i "consumer contract" returned nothing repo-wide)');
    assert.ok(readme.includes('createLinkageFilter'),
      'which names the exported factory rather than inviting a second reading of access()');
  });

  test('[GUARD] #234 AC8b — docs/project-structure.md no longer says this mechanism is unimplemented', async function(assert) {
    // That file states its own purpose: "this file is where the next reader
    // checks whether the chain is still blocked." It said the cross-model
    // resolution was "not implemented yet" and that "the ORM does not yet use
    // it on this path" AFTER this change implemented and wired it, which is
    // the one failure mode that block exists to prevent.
    const doc = await readFile(new URL('../../docs/project-structure.md', import.meta.url), 'utf8');

    assert.notOk(doc.includes("resolve a different model's access class, which is not implemented yet"),
      'the false "not implemented yet" clause is gone');
    assert.notOk(doc.includes('**The mechanism exists; the ORM does not yet use it on this path**'),
      'and so is the unqualified "does not yet use it" claim');

    assert.ok(doc.includes('cross-model resolution IS now\n> implemented for it'),
      'the file records that naming IS now resolved cross-model');
    assert.ok(doc.includes('on the linkage\n> READ path only, never on this one'),
      'and that the WRITE path it is written about is still unrefused');

    // The sentence that survives correctly: this is MEMBERSHIP, which #234 did
    // not close, and deleting the block rather than amending it would have lost
    // it.
    assert.ok(doc.includes('`GET /owners/angela` can be 404 while\n> `GET /animals/1/owner` returns angela in full'),
      'the membership gap that is still open is still stated');

    // And the limit that matters most to a reader of that file.
    assert.ok(/An arity-1 predicate can make it GRANT/.test(doc),
      'the fail-OPEN direction is named, not just the fail-closed one');
  });
});
