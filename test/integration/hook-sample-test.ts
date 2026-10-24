// @ts-nocheck
/**
 * The documented HOOK samples, extracted from the shipped docs and EXECUTED —
 * abofs/stonyx-orm#270.
 *
 * WHY THIS FILE EXISTS. The #270 fix corrected four hook samples in README.md
 * and docs/hooks.md from `context.params.id` to `context.request.recordId`.
 * Nothing held those corrections. Measured at this head, immediately before
 * this file was written: replacing every `context.request.recordId` in
 * README.md and docs/hooks.md with `context.params.id` — 6 occurrences and 2
 * occurrences respectively, the defect restored byte-exactly — left the full
 * suite at 1019 pass / 0 fail, exit 0. `grep -rn 'context.request.recordId'
 * test/` was empty. The corrected samples were prose.
 *
 * The access() samples already had this: test/integration/readme-access/ writes
 * them to disk out of README.md and boots a server on them. This is the same
 * mechanism for the hook corpus, reusing the same extractor
 * (test/helpers/readme-sample-helper.ts) rather than inventing a second one.
 *
 * WHY IT RUNS IN THE MAIN SUITE'S PROCESS. Hooks are a module-level registry
 * (src/hooks.ts), not a construct-time path like `paths.access`, so they can be
 * registered against the already-booted app — no separate process is needed and
 * the process count stays at eight. It does mean this file depends on the main
 * suite's REST server still being open, and test/integration/orm-test.ts closes
 * it in `hooks.after`. File-path order puts this file first ("hook-" < "orm-"),
 * and the `control` test below fails loudly rather than vacuously if that ever
 * stops being true: it asserts the DELETE got a real status and that the
 * samples were actually entered.
 *
 * WHAT IS SUPPLIED, AND WHY THAT IS NOT CHEATING. The sample bytes are written
 * to disk unmodified and imported. Several of them use identifiers the doc
 * block never imports — `store`, `cache`, `auditLog`, `sendNotification` — and
 * two use `context.state.currentUser`. Those are the documented samples'
 * ambient context, so the harness provides them as globals and as a
 * first-registered hook. Nothing between the markdown and the running hook
 * edits the sample's own bytes; in particular nothing touches the id
 * expression, which is the whole subject.
 *
 * WHAT THIS COVERS. All four id-expression sites the #270 fix corrected:
 * two `store.get('animal', …)` lookups in README.md, one in docs/hooks.md, and
 * README.md's `cache.invalidate(\`owner:…:pets\`)` key. Each is covered by
 * observation of the value the sample itself passed, not by re-reading the
 * markdown.
 *
 * WHAT IT DOES NOT COVER, STATED SO IT IS NOT ASSUMED. Prose is not executed —
 * only the fenced samples are. And a sample keyed on the request id that this
 * file's extractor cannot SEE is not executed; that is the same fence-scanning
 * exposure documented on findFencedBlocks and tracked on #279. The floor below
 * is what notices a sample dropping out of the executed set.
 */
import QUnit from 'qunit';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { createRecord, store, beforeHook, afterHook, clearAllHooks } from '@stonyx/orm';
import { setupIntegrationTests } from 'stonyx/test-helpers';
import config from 'stonyx/config';
import { extractResolvingHookSamples } from '../helpers/readme-sample-helper.js';

const { module, test } = QUnit;

const GENERATED_DIR = './test/integration/generated-hooks';

/** The record the samples are made to resolve. Chosen not to collide with the fixture set. */
const TARGET_ID = 4270;

/**
 * The target's owner, and the user the request runs as — abofs/stonyx-orm#256.
 *
 * A belongsTo on a record is the related Record, not its id. The README's
 * authorization sample compares the owner to `user.id`; running as the owner
 * (not an admin) is what makes that comparison decide the outcome. Compared as
 * a Record it never equals the id, and the owner's own DELETE is refused.
 */
const TARGET_OWNER = 'hook-sample-owner';

/**
 * The request target. A LEADING-ZERO ALIAS, not the plain spelling — that is
 * the whole point of #270. `/animals/04270` and `/animals/4270` are one record
 * and two strings, so `params.id` and `recordId` differ here and an assertion
 * on the observed key can tell them apart. With the plain spelling the two
 * differ only by type and a `==` somewhere could hide it.
 */
const TARGET_URL = `/animals/0${TARGET_ID}`;

/**
 * An animal with NO owner, for the authorization sample's refusal side
 * (#256). The sample compares `animal.owner?.id` to `user.id`; when the animal
 * is unowned and the user has no id, both sides are `undefined` and a sample
 * that only compares ids lets a non-admin delete it. Requested by the plain
 * spelling: this case is about the comparison, not the id resolution.
 */
const UNOWNED_ID = 4271;

/**
 * A floor on the executed corpus, in the same shape as PROBED_TARGET_COUNTS
 * (test/integration/readme-sample-test.ts) and NUMERIC_CORPUS_FLOOR
 * (test/integration/reference-access/record-id-resolution.ts).
 *
 * Every assertion below is driven by whatever the extractor returned, so a
 * sample that stops being extracted takes its own coverage with it silently.
 * Measured at this head: README.md yields 4 and docs/hooks.md yields 3 (the
 * relationship change-detection sample, #256, made it 3).
 *
 * A floor, not an equality — adding a documented sample should not need this
 * line touched. Removing one should. Lower it in the same commit and the diff
 * says what was given up.
 */
const EXECUTED_HOOK_SAMPLE_FLOOR = { 'README.md': 4, 'docs/hooks.md': 3 };

/**
 * A floor on the OBSERVATIONS, not just on the number of samples executed.
 *
 * EXECUTED_HOOK_SAMPLE_FLOOR alone leaves a hole of exactly the shape this file
 * exists to close: a sample can be extracted, written to disk and imported —
 * satisfying that floor — while contributing nothing, because the hook it
 * registers is never entered by this request. Re-point one `beforeHook('delete',
 * …)` at `'update'` and its coverage is gone with every count still met.
 *
 * Measured at this head: 6 executed samples produce 3 store lookups, 1 cache key
 * and 2 audit entries — 6 observations, one per sample, so every executed sample
 * is entered. These numbers are that fact, pinned.
 *
 * #256 added a PATCH before the DELETE, because two samples now capture the
 * previous owner id in a `beforeHook('update', …)`. Measured after that change:
 * 7 executed samples, 5 lookups (+2 update captures), 1 cache key, 3 audit
 * entries (+1 update audit).
 */
const OBSERVATION_FLOOR = { lookups: 5, cacheKeys: 1, auditEntries: 3 };

/** Every `store.get(model, id)` the executed samples made. */
const observedLookups = [];

/** Every cache key an executed sample built. */
const observedCacheKeys = [];

/** Every audit entry an executed sample wrote. */
const observedAuditEntries = [];

/** Every notification an executed sample sent. */
const observedNotifications = [];

let executed = [];
let patchStatus = null;
let deleteStatus = null;

/** The user the next request runs as; read by the first-registered hook. */
let currentUser = null;

/** The refusal side of the authorization sample (#256), measured before the allowed DELETE. */
let deniedStatuses = {};

/** Notifications sent by an attribute-only PATCH on the unowned animal (#256). */
let unownedPatchNotifications = null;

module('[Docs] executed hook samples (#270)', function(hooks) {
  setupIntegrationTests(hooks);

  hooks.before(async function() {
    // Already-serialized shape, so the sample serializer's trait handler does not
    // add a habitat trait to the shared store (the Db schema test expects none).
    createRecord('owner', { id: TARGET_OWNER, gender: 'female', age: 30 }, { serialize: false });
    createRecord('animal', { id: TARGET_ID, type: 'dog', age: 1, size: 'small', owner: TARGET_OWNER }, { serialize: false });
    createRecord('animal', { id: UNOWNED_ID, type: 'dog', age: 1, size: 'small' }, { serialize: false });

    // The samples' ambient context. `store` is the real store behind a recorder,
    // so a sample's lookup returns exactly what the ORM's would.
    globalThis.store = new Proxy(store, {
      get(target, prop, receiver) {
        if (prop !== 'get') {
          const value = Reflect.get(target, prop, receiver);
          return typeof value === 'function' ? value.bind(target) : value;
        }

        return (model, ...rest) => {
          const result = target.get(model, ...rest);
          if (rest.length > 0) observedLookups.push({ model, id: rest[0], resolved: result != null });
          return result;
        };
      },
    });
    globalThis.cache = { invalidate: async key => { observedCacheKeys.push(key); } };
    globalThis.auditLog = { create: async entry => { observedAuditEntries.push(entry); } };
    globalThis.sendNotification = async notification => { observedNotifications.push(notification); };
    globalThis.beforeHook = beforeHook;
    globalThis.afterHook = afterHook;

    // Registered FIRST so it runs before every sample hook: two samples read
    // `context.state.currentUser`. For the observed DELETE it is the record's
    // OWNER, not an admin (#256): the authorization sample lets an owner delete
    // their own animal, so a correct sample does not halt the request and every
    // later sample still runs, while a sample that compares the owner Record to
    // the id refuses it with 403. The refusal cases run first, as other users.
    beforeHook('delete', 'animal', context => {
      context.state.currentUser = currentUser;
    });

    await rm(GENERATED_DIR, { recursive: true, force: true });
    await mkdir(GENERATED_DIR, { recursive: true });

    for (const path of Object.keys(EXECUTED_HOOK_SAMPLE_FLOOR)) {
      const samples = await extractResolvingHookSamples(path);

      for (const { code, index } of samples) {
        const slug = path.replace(/[^a-z0-9]+/gi, '-');
        const file = `${GENERATED_DIR}/${slug}-${index}.js`;

        // Unmodified. The id expression under test is in these bytes.
        await writeFile(file, code, 'utf8');

        // Imported by absolute URL, not by a relative specifier: the write above
        // is cwd-relative and a module specifier is module-relative, and a file
        // that silently fails to import would take its coverage with it.
        await import(pathToFileURL(`${process.cwd()}/${file.slice(2)}`).href);

        executed.push({ path, index, code, file });
      }
    }

    const url = path => `http://localhost:${config.restServer.port}${path}`;

    // An attribute-only update on the UNOWNED animal (#256): no owner before,
    // none after, so the adoption samples must stay silent. Both sides of their
    // comparison are `undefined` here, and equal is the right answer.
    const unownedPatch = await fetch(url(`/animals/${UNOWNED_ID}`), {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data: { type: 'animal', attributes: { age: 2 } } }),
    });
    unownedPatchNotifications = { status: unownedPatch.status, sent: [...observedNotifications] };

    // The refusal side of the authorization sample (#256), before anything is
    // observed. Each must be refused; a sample that lets either through deletes
    // the record, and the allowed DELETE below then has nothing to delete.
    currentUser = { id: 'hook-sample-stranger', isAdmin: false };
    deniedStatuses.nonOwner = (await fetch(url(TARGET_URL), { method: 'DELETE' })).status;

    currentUser = { isAdmin: false };
    deniedStatuses.idlessOnUnowned = (await fetch(url(`/animals/${UNOWNED_ID}`), { method: 'DELETE' })).status;

    // Everything above was about a different record or a refused request; the
    // observation tests below are about the target's PATCH and DELETE only.
    observedLookups.length = 0;
    observedCacheKeys.length = 0;
    observedAuditEntries.length = 0;
    observedNotifications.length = 0;
    currentUser = { id: TARGET_OWNER, isAdmin: false };

    // An attribute-only update first (#256): enters the samples' update hooks.
    // The owner does not change, so a sample that detects an owner change must
    // stay silent here.
    const patch = await fetch(`http://localhost:${config.restServer.port}${TARGET_URL}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data: { type: 'animal', attributes: { age: 2 } } }),
    });
    patchStatus = patch.status;

    const response = await fetch(`http://localhost:${config.restServer.port}${TARGET_URL}`, { method: 'DELETE' });
    deleteStatus = response.status;
  });

  hooks.after(function() {
    clearAllHooks();
    store.remove('owner', TARGET_OWNER);
    if (store.get('animal', UNOWNED_ID)) store.remove('animal', UNOWNED_ID);
    delete globalThis.store;
    delete globalThis.cache;
    delete globalThis.auditLog;
    delete globalThis.sendNotification;
    delete globalThis.beforeHook;
    delete globalThis.afterHook;
  });

  test('control — the samples were extracted, executed and entered', function(assert) {
    for (const [path, floor] of Object.entries(EXECUTED_HOOK_SAMPLE_FLOOR)) {
      const count = executed.filter(sample => sample.path === path).length;

      assert.ok(
        count >= floor,
        `${path} yielded ${count} executed hook sample(s) keyed on the request's record id; the floor requires at least ${floor}. ` +
        'Either a sample was deleted or the extractor stopped seeing it. If deliberate, lower EXECUTED_HOOK_SAMPLE_FLOOR in the same commit.'
      );
    }

    // Non-vacuity. Without these, every assertion below passes against a
    // request that never happened and hooks that never ran — which is exactly
    // the failure mode this file exists to end. Floors rather than `> 0`,
    // because `> 0` is met by one sample carrying five silent ones.
    assert.strictEqual(patchStatus, 200, `PATCH ${TARGET_URL} -> ${patchStatus} (200 means the update hook chain completed)`);
    assert.strictEqual(deleteStatus, 204, `DELETE ${TARGET_URL} -> ${deleteStatus} (204 means the request reached the ORM and the hook chain completed)`);

    for (const [what, floor] of Object.entries(OBSERVATION_FLOOR)) {
      const observed = { lookups: observedLookups, cacheKeys: observedCacheKeys, auditEntries: observedAuditEntries }[what].length;

      assert.ok(
        observed >= floor,
        `the executed samples produced ${observed} ${what}; the floor requires at least ${floor}. ` +
        'A sample that is extracted and imported but whose hook is never entered contributes nothing and is otherwise invisible. ' +
        'If a sample was deliberately removed or re-pointed, lower OBSERVATION_FLOOR in the same commit.'
      );
    }
  });

  test('every documented hook sample looks the record up by the id the ORM resolved', function(assert) {
    // `params.id` for this request is the string '04270'; `request.recordId` is
    // the number 4270. A sample keyed on the raw text resolves nothing.
    for (const { model, id, resolved } of observedLookups) {
      assert.strictEqual(
        id,
        TARGET_ID,
        `a documented sample asked the store for ${JSON.stringify(id)} (${typeof id}) on '${model}'; ` +
        `${TARGET_URL} resolves to ${TARGET_ID} (number). A sample keyed on context.params.id passes the raw text '0${TARGET_ID}' here.`
      );

      assert.ok(resolved, `and the lookup returned a record — a sample keyed on the raw client text gets undefined, and the next line throws`);
    }
  });

  test('every documented hook sample keys its cache on the id the ORM resolved', function(assert) {
    for (const key of observedCacheKeys) {
      assert.strictEqual(
        key,
        `owner:${TARGET_ID}:pets`,
        `a documented sample invalidated ${JSON.stringify(key)}; keyed on context.params.id it would be "owner:0${TARGET_ID}:pets", ` +
        'a second entry for one record — so the write\'s entry is never invalidated'
      );
    }
  });

  test('every documented hook sample records the resolved id in its audit entry', function(assert) {
    for (const entry of observedAuditEntries) {
      assert.strictEqual(
        entry.recordId,
        TARGET_ID,
        `a documented sample audited recordId ${JSON.stringify(entry.recordId)} (${typeof entry.recordId}); the ORM resolved ${TARGET_ID}`
      );
    }
  });

  test('the authorization sample lets the owner delete their own animal (#256)', function(assert) {
    // The request runs as TARGET_OWNER, not an admin. The sample compares the
    // record's owner to the user's id; a sample that compares the owner Record
    // itself never matches and returns 403 here.
    assert.strictEqual(
      deleteStatus,
      204,
      `DELETE ${TARGET_URL} as its owner "${TARGET_OWNER}" (not an admin) -> ${deleteStatus}; ` +
      '403 means a documented authorization sample compared the owner Record to the user id instead of `owner.id`'
    );
  });

  test('the authorization sample refuses a non-owner, and an id-less user on an unowned animal (#256)', function(assert) {
    // The inverse of the test above. Without it, an authorization sample with
    // its check removed (`if (false)`) passes this whole file.
    assert.strictEqual(
      deniedStatuses.nonOwner,
      403,
      `DELETE ${TARGET_URL} as a non-owner, non-admin -> ${deniedStatuses.nonOwner}; a documented authorization sample let it through`
    );

    // `animal.owner?.id !== user.id` is `undefined !== undefined` here: false,
    // so a sample that only compares ids deletes the animal.
    assert.strictEqual(
      deniedStatuses.idlessOnUnowned,
      403,
      `DELETE /animals/${UNOWNED_ID} (no owner) as a non-admin with no id -> ${deniedStatuses.idlessOnUnowned}; ` +
      'a documented authorization sample treated "no owner" and "no user id" as a match'
    );
  });

  test('no adoption notification on an update to an unowned animal (#256)', function(assert) {
    // No owner before and none after: both sides of the adoption samples'
    // comparison are `undefined`, and "unchanged" is the correct reading.
    assert.strictEqual(unownedPatchNotifications.status, 200, `PATCH /animals/${UNOWNED_ID} -> ${unownedPatchNotifications.status}`);
    assert.deepEqual(
      unownedPatchNotifications.sent,
      [],
      `an attribute-only update to an unowned animal sent ${unownedPatchNotifications.sent.length} notification(s): ${JSON.stringify(unownedPatchNotifications.sent)}`
    );
  });

  test('no adoption notification on an update that does not change the owner (#256)', function(assert) {
    // `oldState` holds attributes only, so `oldState.owner` is undefined and a
    // sample that compares it to `record.owner` (a Record) notifies on EVERY
    // update. This PATCH changes only `age`.
    assert.strictEqual(patchStatus, 200, `PATCH ${TARGET_URL} -> ${patchStatus}`);
    assert.deepEqual(
      observedNotifications,
      [],
      `an attribute-only update sent ${observedNotifications.length} notification(s): ${JSON.stringify(observedNotifications)}`
    );
  });
});
