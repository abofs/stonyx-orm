// @ts-nocheck
/**
 * Boots Stonyx against test/sample/access — the reference access sample —
 * for abofs/stonyx-orm#265.
 *
 * The main suite already runs behind this sample, but it closes the REST server
 * when its ORM module finishes and its expectations are entangled with ~95 other
 * requests. The seven bypass spellings include a DELETE that must be refused, so
 * they get an isolated process with its own store, db file and port, exactly like
 * test/integration/mounted-route and test/integration/readme-access.
 *
 * Must NOT run under NODE_ENV=test, or test/config/environment.ts clobbers the
 * paths and the port.
 */
const cwd = process.cwd();

const { default: Stonyx } = await import('stonyx');

const config = {
  logColor: 'white',
  logMethod: 'db',
  paths: {
    access: './test/sample/access',
    model: './test/sample/models',
    serializer: './test/sample/serializers',
    transform: './test/sample/transforms',
    view: './test/sample/views',
  },
  db: {
    autosave: 'false',
    mode: 'file',
    directory: 'db',
    saveInterval: 60 * 60,
    file: './test/sample/reference-access-db.json',
    schema: './test/sample/db-schema.js',
  },
  restServer: {
    enabled: 'true',
    route: '/',
  },
  modules: {
    restServer: {
      // Distinct from the main suite (2666), mounted-route (2777) and
      // readme-access (2888)
      port: process.env.REFERENCE_REST_PORT ?? '2999',
      dir: './test/sample/requests',
    },
  },
};

new Stonyx(config, cwd);
