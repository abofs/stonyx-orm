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
import { readFile } from 'node:fs/promises';
import Orm, { createRecord, store } from '@stonyx/orm';
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
    assert.ok(/issues\/233/.test(section), 'the `included` membership boundary is attributed to its own issue');
  });
});
