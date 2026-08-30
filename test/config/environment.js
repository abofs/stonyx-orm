// Test-specific config overrides for ORM
// These target the post-standalone-transform shape: { orm: { ... }, restServer: { ... } }
//
// ---------------------------------------------------------------------------
// This file MUST stay `.js`. It is not a style preference (#184 SME review).
//
// stonyx resolves `<root>/test/config/environment` through `importConfig`.
// From v0.2.3-beta.63 onward (commit 4c80c87, "enforce .js-only config
// resolution", one commit after the beta.62 tag) that resolver builds
// `${basePath}.js` and throws `Config not found:` when it is absent — there is
// no `.ts` fallback. Stonyx.start() then SWALLOWS that specific error as
// "missing test override is non-fatal". So a `.ts` file here does not fail
// loudly: the merge is silently skipped, every pin below evaporates, the
// ambient environment wins again, and the suite stays green while doing it.
//
// This package declares `stonyx` 0.2.3-beta.76 and only resolves beta.61 —
// the last release that could load a `.ts` config — via a `pnpm.overrides`
// pin. One dependency bump would have disarmed the whole of #184 silently.
// `test/integration/env-isolation-test.ts` asserts, in a real boot, that this
// file is actually read; see TEST_OVERRIDE_SENTINEL below.
// ---------------------------------------------------------------------------
//
// EVERY key config/environment.js reads is pinned here, deliberately (#184).
// mergeObject deep-merges this over the resolved config, so an explicit key
// wins; a key left out silently inherits whatever the developer, CI runner or
// container happens to have exported. Pinning only some of them is worse than
// pinning none, because it looks safe: db.file was pinned while db.mode was
// not, which did not neutralise the database — it just made the pinned path
// the base directory for a different write target.
//
// Evaluate this as a SET, not key by key.
//
// What the guards in test/integration/env-isolation-test.ts DO cover:
//   - that every variable named in config/environment.js's destructuring block
//     is exercised by the regression suite's polluting set (a derived
//     read-list is compared against that set, so adding a variable to
//     config/environment.js without pinning it here turns the suite red);
//   - that with all of them exported to sentinel values, the resolved
//     `config.orm` + `config.restServer` are byte-identical to a boot with
//     them unset.
//
// What they do NOT cover:
//   - a NEW ambient variable read somewhere other than config/environment.js
//     (src/, another module's config) — the derivation only parses this
//     package's config file;
//   - variables consumed by @stonyx/rest-server, @stonyx/cron or @stonyx/logs
//     beyond the keys pinned under `restServer` below;
//   - anything read after boot rather than at config-resolution time.

/**
 * Proof-of-life value for the assertion in env-isolation-test.ts. It exists
 * only so a real boot can be asked "did you actually merge this file?" — a
 * question a green suite cannot answer, because a green suite is exactly what
 * the swallowed `Config not found:` failure produces.
 */
export const TEST_OVERRIDE_SENTINEL = 'orm-184-test-override-loaded';

/**
 * The suite's REST port. Deliberately NOT `REST_PORT`.
 *
 * @stonyx/rest-server's own config resolves `port: REST_PORT ?? 2666`, and
 * this file previously pinned `restServer.dir` but not `restServer.port`,
 * while pinning `orm.restServer.enabled: 'true'` unconditionally. The suite
 * therefore bound whatever the developer had exported as REST_PORT, or 2666 —
 * a port in active use by unrelated services on developer machines, which
 * cascaded into an EADDRINUSE failure storm for one reviewer. A test-scoped
 * name means an ambient production variable can no longer reach the listener,
 * and CI can still relocate the port when it needs to.
 */
const TEST_REST_PORT = Number(process.env.ORM_TEST_REST_PORT ?? 42666);

// Connection blocks are pinned to null rather than undefined: null is falsy,
// so src/main.ts's else-if driver chain skips it identically, and it survives
// the JSON round-trip that undefined does not.

// Every variable config/environment.js destructures. Ambient values for any of
// these are ignored by the pins below; say so, because silence is why #184 sat
// undetected. DB_MODE is included deliberately: the refinement named it the
// most dangerous of the set (it silently redirects the write target rather
// than failing), and the previous version of this warning omitted it.
const ambientVars = [
  'ORM_ACCESS_PATH', 'ORM_MODEL_PATH', 'ORM_REST_ROUTE', 'ORM_SERIALIZER_PATH',
  'ORM_TRANSFORM_PATH', 'ORM_VIEW_PATH', 'ORM_USE_REST_SERVER',
  'DB_AUTO_SAVE', 'DB_FILE', 'DB_MODE', 'DB_DIRECTORY', 'DB_SCHEMA_PATH',
  'DB_SAVE_INTERVAL',
  'MYSQL_HOST', 'MYSQL_PORT', 'MYSQL_USER', 'MYSQL_PASSWORD', 'MYSQL_DATABASE',
  'MYSQL_CONNECTION_LIMIT', 'MYSQL_MIGRATIONS_DIR',
  'PG_HOST', 'PG_PORT', 'PG_USER', 'PG_PASSWORD', 'PG_DATABASE',
  'PG_CONNECTION_LIMIT', 'PG_MIGRATIONS_DIR',
  'TIMESCALE_HOST', 'TIMESCALE_PORT', 'TIMESCALE_USER', 'TIMESCALE_PASSWORD',
  'TIMESCALE_DATABASE', 'TIMESCALE_CONNECTION_LIMIT', 'TIMESCALE_MIGRATIONS_DIR',
  'DYNAMODB_REGION', 'DYNAMODB_ENDPOINT', 'DYNAMODB_TABLE_PREFIX',
];

const ignored = ambientVars.filter(name => process.env[name]);

if (ignored.length) {
  // Not an acceptance criterion — silence is not the defect, the connection
  // is. But this is the reason #184 sat undetected, and it costs nothing.
  // Names only, never values: these can hold production credentials.
  console.warn(
    `[@stonyx/orm test config] Ignoring ${ignored.length} ambient variable(s): ${ignored.join(', ')}. ` +
    'The test suite pins its own configuration and will not read them.'
  );
}

export default {
  testOverrideSentinel: TEST_OVERRIDE_SENTINEL,

  orm: {
    paths: {
      access: './test/sample/access',
      model: './test/sample/models',
      serializer: './test/sample/serializers',
      transform: './test/sample/transforms',
      view: './test/sample/views'
    },
    db: {
      autosave: 'false',
      file: './test/sample/db.json',
      mode: 'file',
      directory: 'db',
      saveInterval: 60 * 60,
      schema: './test/sample/db-schema.js'
    },
    // NOTE: MySQL test config is NOT here — it lives in test/helpers/mysql-test-helper.ts.
    // Adding a mysql block here causes the ORM to initialize MysqlDB during setupIntegrationTests,
    // which breaks non-MySQL tests and causes race conditions with MySQL test setup.
    mysql: null,
    postgres: null,
    timescale: null,
    dynamodb: null,
    restServer: {
      enabled: 'true',
      route: '/'
    }
  },
  restServer: {
    dir: './test/sample/requests',
    port: TEST_REST_PORT
  }
}
