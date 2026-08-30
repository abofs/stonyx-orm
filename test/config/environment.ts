// Test-specific config overrides for ORM
// These target the post-standalone-transform shape: { orm: { ... }, restServer: { ... } }
//
// EVERY key config/environment.js reads is pinned here, deliberately (#184).
// mergeObject deep-merges this over the resolved config, so an explicit key
// wins; a key left out silently inherits whatever the developer, CI runner or
// container happens to have exported. Pinning only some of them is worse than
// pinning none, because it looks safe: db.file was pinned while db.mode was
// not, which did not neutralise the database — it just made the pinned path
// the base directory for a different write target.
//
// Evaluate this as a SET, not key by key. If a key is added to
// config/environment.js it must be added here too; the whole-object deepEqual
// in test/integration/env-isolation-test.ts is what catches the drift.

// Connection blocks are pinned to null rather than undefined: null is falsy,
// so src/main.ts's else-if driver chain skips it identically, and it survives
// the JSON round-trip that undefined does not.
const ambientConnectionVars = [
  'MYSQL_HOST', 'PG_HOST', 'TIMESCALE_HOST', 'DYNAMODB_REGION',
] as const;

const ignored = ambientConnectionVars.filter(name => process.env[name]);

if (ignored.length) {
  // Not an acceptance criterion — silence is not the defect, the connection
  // is. But this is the reason #184 sat undetected, and it costs nothing.
  console.warn(
    `[@stonyx/orm test config] Ignoring ambient database variables: ${ignored.join(', ')}. ` +
    'The test suite pins its own configuration and will not connect to them.'
  );
}

export default {
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
    // NOTE: MySQL test config is NOT here — it lives in test/helpers/mysql-test-helper.js.
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
    dir: './test/sample/requests'
  }
}
