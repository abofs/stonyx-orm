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

  test('[DEFECT] #234 AC10 — an unusable `linkage` denies whether it is a non-function, an async or generator function, a non-boolean answer or a throw, and none of them escapes JSON.stringify', function(assert) {
    // `linkage` is PUBLIC (`OrmRecord.toJSON`, src/types/orm-types.ts) and the
    // README tells consumers to pass one, so it arrives from outside this
    // package and may be any value — and whatever it is, `toJSON` INVOKES it.
    //
    // `typeof linkage === 'function'` is NOT the question "can this answer a
    // synchronous boolean", and BOTH pre-fix outcomes were measured surviving a
    // typeof-only check. All four rows are real measurements on this record:
    //
    //   toJSON({ linkage: null })              -> FULL PRE-#234 LINKAGE, no log
    //   toJSON({ linkage: true })              -> THREW TypeError
    //   toJSON({ linkage: async () => false }) -> FULL PRE-#234 LINKAGE, no log
    //   toJSON({ linkage: class Klass {} })    -> THREW out of JSON.stringify
    //
    // The async row is the one this table exists for. A promise is TRUTHY, so
    // an awaited resolver — the natural shape in the queue-payload and
    // websocket contexts the README's Consumer Contracts section points
    // consumers at — published every related id, byte-identical to unpatched
    // dev, with ZERO signal. That is the same argument that convicts `null` (a
    // resolver's natural failure shape must not be read as the permissive
    // path), one branch over, landing on the GRANT side.
    //
    // AND `Boolean(...)` ALONE DOES NOT CLOSE IT — measured, not reasoned. With
    // `Boolean(verdict)` plus a try/catch in place, every `'leak'` row below
    // STILL emitted the full pre-#234 linkage with no log, because truthiness
    // is exactly what those values already had. The answer must BE a boolean.
    const record = seed();
    const errorStub = sinon.stub(log, 'error');

    class Klass {}

    // label, value, the reason the single log line must give, and what this
    // shape did BEFORE this validation existed:
    //   'leak'  — emitted the full pre-#234 document, silently
    //   'throw' — raised out of the enclosing JSON.stringify
    //   'quiet' — denied already, but with no signal at all
    const unusable = [
      // NON-FUNCTION. The falsy half leaked; the truthy half threw.
      ['null', null, /must be a function/, 'leak'],
      ['0', 0, /must be a function/, 'leak'],
      ['false', false, /must be a function/, 'leak'],
      ["''", '', /must be a function/, 'leak'],
      ['NaN', NaN, /must be a function/, 'leak'],
      ['true', true, /must be a function/, 'throw'],
      ["'x'", 'x', /must be a function/, 'throw'],
      ['{}', {}, /must be a function/, 'throw'],
      ['[]', [], /must be a function/, 'throw'],
      ["Symbol('s')", Symbol('s'), /must be a function/, 'throw'],
      ['10n', 10n, /must be a function/, 'throw'],
      ['an object whose valueOf AND toString both throw',
        { valueOf() { throw new Error('vo'); }, toString() { throw new Error('ts'); } },
        /must be a function/, 'throw'],

      // FUNCTION-SHAPED, DEFERRED ANSWER. Passes `typeof`; answers with a
      // promise, which is truthy, which GRANTED.
      ['async () => false', async () => false, /SYNCHRONOUS function/, 'leak'],
      ['async () => true', async () => true, /SYNCHRONOUS function/, 'leak'],
      ['function* () { yield false; }', function* () { yield false; }, /SYNCHRONOUS function/, 'leak'],
      ['async function* () { yield false; }', async function* () { yield false; }, /SYNCHRONOUS function/, 'leak'],
      ['() => Promise.resolve(false)', () => Promise.resolve(false), /Promise \(or other thenable\)/, 'leak'],
      ['() => ({ then() {} })', () => ({ then() {} }), /Promise \(or other thenable\)/, 'leak'],

      // FUNCTION-SHAPED, NON-BOOLEAN ANSWER. A resolver that did not answer.
      ['() => ({})', () => ({}), /a value of type object rather than a boolean/, 'leak'],
      ["() => 'no'", () => 'no', /a value of type string rather than a boolean/, 'leak'],
      ['() => 1', () => 1, /a value of type number rather than a boolean/, 'leak'],
      ['() => []', () => [], /an array rather than a boolean/, 'leak'],
      ['() => null', () => null, /null rather than a boolean/, 'quiet'],
      ['() => undefined', () => undefined, /a value of type undefined rather than a boolean/, 'quiet'],

      // FUNCTION-SHAPED, THROWS. Every one of these escaped the JSON.stringify.
      ['class Klass {}', Klass, /it threw \(Class constructor/, 'throw'],
      ['Klass.bind(null)', Klass.bind(null), /it threw \(Class constructor/, 'throw'],
      ["() => { throw new Error('fn-boom'); }", () => { throw new Error('fn-boom'); }, /it threw \(fn-boom\)/, 'throw'],
      // The REPORT is itself a throw site: `String(Object.create(null))` throws
      // "Cannot convert object to primitive value", so a naive catch body would
      // throw out of the catch that exists so that nothing throws.
      ['() => { throw Object.create(null); }', () => { throw Object.create(null); }, /could not be described/, 'throw'],
    ];

    const PRE_FIX = {
      leak: 'the FULL pre-#234 linkage, silently',
      throw: 'a throw out of the enclosing JSON.stringify',
      quiet: 'a denial with no signal at all'
    };

    try {
      // ABSENT is the one value that still means "no verdict". Load-bearing:
      // AC5/AC5b depend on it, and it is the `JSON.stringify` hook path.
      assert.deepEqual(record.toJSON({ linkage: undefined }).relationships, PRE_CHANGE_RELATIONSHIPS,
        'an ABSENT linkage is still today\'s document — `undefined` is not "unusable"');
      assert.strictEqual(errorStub.callCount, 0, 'and absent is not an error');

      for (const [label, value, reason, preFix] of unusable) {
        errorStub.resetHistory();

        let document;
        assert.strictEqual(typeof (document = record.toJSON({ linkage: value })), 'object',
          `toJSON({ linkage: ${label} }) returns a document rather than throwing`);

        assert.strictEqual(document.relationships.owner.data, null,
          `${label} DENIES the belongsTo (before: ${PRE_FIX[preFix]})`);
        assert.deepEqual(document.relationships.traits.data, [],
          `${label} DENIES the hasMany`);

        // The wire shape is deliberately indistinguishable from a genuinely
        // empty relationship, so the log is the ONLY signal a consumer whose
        // resolver quietly returned `null` — or a promise — will ever get.
        // Once per DOCUMENT: this record has TWO relationships, so a per-key or
        // per-record log would count higher and a missing one would count zero.
        // The throwing rows are the ones that make that non-trivial — they fail
        // once per related record, and are still reported once.
        assert.strictEqual(errorStub.callCount, 1,
          `${label} is reported exactly once per document, not once per relationship or per related record`);
        assert.ok(reason.test(String(errorStub.firstCall.args[0])),
          `${label} says WHICH way it was unusable (expected ${reason}, got: ${errorStub.firstCall.args[0]})`);
      }

      // And the promise src/record.ts makes: no value of this option throws out
      // of the enclosing `JSON.stringify`, which would take `console.log` and
      // `Orm.db.save()`'s neighbours down with it. The assertion NAME used to
      // guarantee this while three function shapes still broke it.
      for (const [label, value] of unusable) {
        const wrapper = { toJSON: () => record.toJSON({ linkage: value }) };
        assert.strictEqual(typeof JSON.stringify({ data: wrapper }), 'string',
          `JSON.stringify survives a linkage of ${label}`);
      }

      // WHAT THIS TABLE COVERS, NAMED. A list of eight non-function values
      // reads as complete and is not: it was, and the function half was wide
      // open behind it. Anyone narrowing this table has to delete a name.
      const covered = unusable.map(([label]) => label);

      assert.deepEqual(
        ['async () => false', 'function* () { yield false; }', '() => Promise.resolve(false)',
          '() => ({})', "() => 'no'", 'class Klass {}', 'Klass.bind(null)',
          "() => { throw new Error('fn-boom'); }"].filter(label => !covered.includes(label)),
        [],
        `the table covers the FUNCTION-shaped hazards a typeof check lets through — async, async generator, generator, thenable-returning, object/string/number-returning, class, bound class and throwing — as well as non-functions. All ${covered.length} shapes verified here: ${covered.join(' | ')}`);

      // CONFIRMS THE CHECK COULD HAVE FAILED, on both halves. Without these,
      // every assertion above is equally green against a build that denies all
      // linkage unconditionally.
      errorStub.resetHistory();
      assert.deepEqual(record.toJSON({ linkage: () => true }).relationships, PRE_CHANGE_RELATIONSHIPS,
        'a plain function ANSWERING `true` still emits the full linkage');
      assert.strictEqual(errorStub.callCount, 0, 'and is not reported');

      const partial = record.toJSON({ linkage: type => type !== 'owner' });
      assert.strictEqual(partial.relationships.owner.data, null,
        'and a per-type boolean answer is still applied per type');
      assert.deepEqual(partial.relationships.traits.data, [{ type: 'trait', id: RELATED_ID }],
        'with the sibling relationship kept');
      assert.strictEqual(errorStub.callCount, 0, 'and neither usable shape is reported');
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
      assert.deepEqual(seen[0].context, { model: PROBE, operation: 'read', recordId: null },
        'asked about the RELATED model, for a read — naming an id is a read, whatever verb the request carries');
      assert.strictEqual(seen[0].request, READ_REQUEST,
        'and handed the live request by identity, not a fabricated one');
    } finally {
      delete registry[PROBE];
    }
  });

  test('[GUARD] #234 + #241 — recordId is null on the cross-model ask, and is NOT the request\'s route-parameter id', function(assert) {
    // WHY THIS TEST EXISTS AS A SEPARATE ASSERTION, next to an AC13 deepEqual
    // that already names `recordId: null`. AC13 drives the filter with
    // `READ_REQUEST`, whose `params` is `{}` — so the mutation this whole test
    // is aimed at, `recordId: request.params.id` in `resolveVerdict`, produces
    // `undefined` there and AC13 dies on a technicality about SPELLING rather
    // than about the cross-model leak. Measured: with `params: {}` the wrong
    // construction and the right one differ only by `undefined` vs `null`.
    //
    // So this drives it with the shape the LIVE router produces for a
    // single-record route — `GET /owners/gina` — where the route parameter
    // names an OWNER while the ask below is about a DIFFERENT model. Now the
    // wrong construction yields the string `'gina'` and the assertion dies on
    // the thing that actually matters: one model's id reaching another model's
    // predicate, the abofs/stonyx-orm#202 defect class.
    //
    // MUTATIONS THIS KILLS (each measured against this test):
    //
    //   recordId: request.params.id            -> 'gina'   FAIL
    //   recordId: getId(request.params)        -> 'gina'   FAIL
    //   recordId: record?.id                   -> 9234     FAIL
    //   recordId: undefined                    -> absent-shaped, FAIL
    //   (key omitted entirely)                 -> tsc TS2345, and FAIL here
    const registry = Orm.instance.accessFunctions;
    const PROBE = 'zz-234-recordid-probe';
    const seen = [];

    // The live shape of `GET /owners/gina`: the route parameter names the
    // PRIMARY record, an owner. The linkage ask below is about `PROBE`.
    const PRIMARY_REQUEST = { method: 'GET', path: '/gina', params: { id: 'gina' }, query: {} };
    const RELATED_RECORD = { id: 9234 };

    registry[PROBE] = (request, context) => { seen.push(context); return true; };

    try {
      assert.strictEqual(createLinkageFilter(PRIMARY_REQUEST)(PROBE, RELATED_RECORD), true,
        'precondition: the probe grants, so the predicate really was reached');
      assert.strictEqual(seen.length, 1, 'and asked exactly once');

      assert.strictEqual(seen[0].recordId, null,
        'recordId is null: this request addresses no record OF THIS MODEL');
      assert.notStrictEqual(seen[0].recordId, PRIMARY_REQUEST.params.id,
        'and is NOT the route-parameter id, which names a record of ANOTHER model (#202)');
      assert.notStrictEqual(seen[0].recordId, RELATED_RECORD.id,
        'and is NOT the record under decision either — the verdict is cached per TYPE, before any record is seen');

      // `null`, not merely nullish. `undefined` is the spelling that means
      // "this context was hand-assembled and did not come from `auth()`"
      // (AccessContext.recordId, src/types/orm-types.ts), and it is not even
      // assignable to `string | number | null`.
      assert.true('recordId' in seen[0], 'the key is always PRESENT, the rule the contract states');
      assert.strictEqual(seen[0].recordId === undefined, false, 'and is null, not undefined');

      // The other two facts must still be model-correct alongside it.
      assert.strictEqual(seen[0].model, PROBE, 'the ask is still about the RELATED model');
      assert.strictEqual(seen[0].operation, 'read', 'for a read');
    } finally {
      delete registry[PROBE];
    }
  });

  test('[GUARD] #234 + #241 — a predicate that authorises on recordId cannot be tricked into answering about the primary record', function(assert) {
    // The assertion above pins the VALUE. This one pins the CONSEQUENCE, so
    // the reason the value matters survives even if someone decides the shape
    // assertion is over-specified and deletes it.
    //
    // The probe is the shipped sample's own shape: deny the record named
    // `gina`. Asked about a RELATED model on a request addressed to owner
    // `gina`, it must NOT deny — `gina` is not a record of this model, and a
    // predicate handed the primary id would empty the whole relationship for
    // every record of the related type at once.
    const registry = Orm.instance.accessFunctions;
    const PROBE = 'zz-234-recordid-consequence';

    registry[PROBE] = (request, context) => context.recordId !== 'gina';

    try {
      const filter = createLinkageFilter({ method: 'GET', path: '/gina', params: { id: 'gina' }, query: {} });

      assert.strictEqual(filter(PROBE, { id: 9234 }), true,
        'the related model is still linkable — the owner id `gina` never reached its predicate');
      assert.strictEqual(filter(PROBE, { id: 'gina' }), true,
        'and not even a related record that happens to SHARE the id is judged by the route parameter');
    } finally {
      delete registry[PROBE];
    }
  });

  test('[GUARD] #234 AC14 — the one interpreter is reachable from the package entry point, and denies every CLAIMED model when there is no request', async function(assert) {
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

    // THAT PATH WAS ALREADY TRIVIALLY SAFE — `getAccess(type)` returns
    // `undefined` and three lines later it is a denial, with no consumer code
    // involved. It says nothing about a CLAIMED model, which is where the
    // export is actually used, and where the factory was NOT fail-closed.
    // Measured on the shipped fixture before the guard in createLinkageFilter:
    //
    //   createLinkageFilter(undefined | null | 'x' | 0)
    //     -> owner=false animal=TRUE trait=TRUE category=TRUE phone-number=TRUE
    //
    // `owner` denied only because the shipped sample guards its own
    // `request.path` read; the other four predicates ignore the request
    // entirely, and a predicate that never READS the request cannot fail closed
    // when it is missing. Whether an absent request denies was delegated, in
    // full, to consumer code — by a factory whose stated purpose is
    // fail-closed, exported into exactly the request-less contexts (a queue
    // payload, a websocket frame) the README's Consumer Contracts section
    // points consumers at.
    const CLAIMED = ['owner', 'animal', 'trait', 'category', 'phone-number'];
    const errorStub = sinon.stub(log, 'error');

    try {
      // CONFIRMS THE CHECK BELOW COULD HAVE FAILED. With a live request at
      // least one CLAIMED model grants, so a blanket denial is not what is
      // being measured.
      assert.ok(CLAIMED.some(model => filter(model, { id: 1 }) === true),
        'precondition: with a live request, at least one claimed model GRANTS');

      for (const [label, value] of [['undefined', undefined], ['null', null], ["'x'", 'x'], ['0', 0], ['true', true]]) {
        errorStub.resetHistory();

        const requestless = ormPackage.createLinkageFilter(value);

        assert.strictEqual(errorStub.callCount, 1,
          `createLinkageFilter(${label}) reports the missing request ONCE, at construction — so the signal exists even for a caller that goes on to serialize nothing`);
        assert.ok(/no request/.test(String(errorStub.firstCall.args[0])),
          `createLinkageFilter(${label}) says the request is what was missing`);

        for (const model of CLAIMED) {
          assert.strictEqual(requestless(model, { id: 1 }), false,
            `createLinkageFilter(${label}) denies CLAIMED model "${model}" (before: owner denied, but animal/trait/category/phone-number all GRANTED)`);
        }

        assert.strictEqual(errorStub.callCount, 1,
          `createLinkageFilter(${label}) does not re-report once per model`);
      }

      // THE RESIDUAL, PINNED AS DOCUMENTED RATHER THAN LEFT TO BE REDISCOVERED.
      // `{}` is an object and passes. This module owns no request contract —
      // `auth()` reads `.method`, the shipped sample reads `.path`, a
      // consumer's predicate reads whatever it likes — so anything past "is it
      // an object" would be this package inventing a shape for someone else's
      // framework. A stand-in object is therefore NOT a safe substitute for a
      // live request, and the README says so.
      errorStub.resetHistory();

      const standIn = ormPackage.createLinkageFilter({});

      assert.strictEqual(errorStub.callCount, 0, 'an object-shaped stand-in is not reported');
      assert.ok(CLAIMED.some(model => standIn(model, { id: 1 }) === true),
        'and is NOT covered by the guard — a predicate that ignores its request still grants, which is why the README requires a LIVE request rather than any object');
    } finally {
      errorStub.restore();
    }

    // AND THE OBLIGATION IS WRITTEN DOWN WHERE A CONSUMER WILL FIND IT.
    // quality.md rule 2: one findable place, not only a code comment.
    const readme = await readFile(new URL('../../README.md', import.meta.url), 'utf8');
    const start = readme.indexOf('### Consumer Contracts');
    assert.ok(start > -1, 'precondition: the Consumer Contracts section exists');

    const section = readme.slice(start, readme.indexOf('\n### ', start + 4));

    assert.ok(/requires a live request, and there is no safe call\s+without one/.test(section),
      'the section states that `createLinkageFilter` requires a live request');
    assert.ok(/denies \*\*all\*\* linkage and logs/.test(section),
      'and states what happens without one, rather than leaving it to be discovered');
    assert.ok(/`\{\}` is an object\s*\n?\s*and passes the guard/.test(section),
      'and names the residual: an object stand-in passes the guard and is not a substitute');
    assert.ok(/queue\s+consumer or a websocket handler/.test(section),
      'and answers the request-less contexts this same section sends consumers to');
    assert.ok(/an `async` resolver returns a promise, a promise is\s+truthy/.test(section),
      'the async-resolver hazard is stated for consumers, not only in a code comment');
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
    // Scoped to the linkage BULLET, not to `section`. The section slice runs to
    // the next `## ` heading, which is ~480 lines away and swallows the
    // `?include=` documentation -- so a section-wide `/issues\/235/` is
    // satisfied by a cross-reference elsewhere and does not pin this bullet.
    // Measured: it survived the mutation that put #233 back on the `included`
    // exclusion and stripped the link off the POST/PATCH one.
    const bulletStart = section.indexOf('- **Relationship linkage is filtered on the four request-bound read surfaces');
    assert.ok(bulletStart > -1, 'precondition: the linkage bullet is findable');
    const bullet = section.slice(bulletStart, section.indexOf('\n- **', bulletStart + 10));

    assert.strictEqual((bullet.match(/issues\/235/g) || []).length, 2,
      'BOTH deferred LINKAGE exclusions — `included` and the POST/PATCH documents — are attributed to #235');
    assert.ok(/#233\]\(https:\/\/github\.com\/abofs\/stonyx-orm\/issues\/233\) owns whether a/.test(bullet),
      'and #233 is kept for what it actually owns: whether a resource appears in `included` at all');
    assert.ok(bullet.includes('PATCH /animals/1'),
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
