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
 * The request target. A LEADING-ZERO ALIAS, not the plain spelling — that is
 * the whole point of #270. `/animals/04270` and `/animals/4270` are one record
 * and two strings, so `params.id` and `recordId` differ here and an assertion
 * on the observed key can tell them apart. With the plain spelling the two
 * differ only by type and a `==` somewhere could hide it.
 */
const TARGET_URL = `/animals/0${TARGET_ID}`;

/**
 * A floor on the executed corpus, in the same shape as PROBED_TARGET_COUNTS
 * (test/integration/readme-sample-test.ts) and NUMERIC_CORPUS_FLOOR
 * (test/integration/reference-access/record-id-resolution.ts).
 *
 * Every assertion below is driven by whatever the extractor returned, so a
 * sample that stops being extracted takes its own coverage with it silently.
 * Measured at this head: README.md yields 4 and docs/hooks.md yields 2.
 *
 * A floor, not an equality — adding a documented sample should not need this
 * line touched. Removing one should. Lower it in the same commit and the diff
 * says what was given up.
 */
const EXECUTED_HOOK_SAMPLE_FLOOR = { 'README.md': 4, 'docs/hooks.md': 2 };

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
 */
const OBSERVATION_FLOOR = { lookups: 3, cacheKeys: 1, auditEntries: 2 };

/** Every `store.get(model, id)` the executed samples made. */
const observedLookups = [];

/** Every cache key an executed sample built. */
const observedCacheKeys = [];

/** Every audit entry an executed sample wrote. */
const observedAuditEntries = [];

let executed = [];
let deleteStatus = null;

module('[Docs] executed hook samples (#270)', function(hooks) {
  setupIntegrationTests(hooks);

  hooks.before(async function() {
    createRecord('animal', { id: TARGET_ID, type: 'dog', age: 1, size: 'small' });

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
    globalThis.sendNotification = async () => {};
    globalThis.beforeHook = beforeHook;
    globalThis.afterHook = afterHook;

    // Registered FIRST so it runs before every sample hook: two samples read
    // `context.state.currentUser`. An admin, so neither sample halts the
    // request and every later sample still runs.
    beforeHook('delete', 'animal', context => {
      context.state.currentUser = { id: 'harness-admin', isAdmin: true };
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

    const response = await fetch(`http://localhost:${config.restServer.port}${TARGET_URL}`, { method: 'DELETE' });
    deleteStatus = response.status;
  });

  hooks.after(function() {
    clearAllHooks();
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
});
