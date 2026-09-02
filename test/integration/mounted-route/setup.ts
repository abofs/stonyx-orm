/**
 * Custom Stonyx bootstrap for the mounted-route (non-default REST route)
 * integration tests — abofs/stonyx-orm#254.
 *
 * Modelled on test/integration/dynamodb/setup.ts, which is this repo's working
 * template for "boot Stonyx with a bespoke raw ORM config".
 *
 * Two constraints force a separate process rather than a module inside the
 * main suite:
 *
 *  1. `orm.restServer.route` is a boot-time global. Stonyx is a singleton and
 *     setup-rest-server runs once during Orm.init(), so a second app cannot be
 *     booted at a different route inside one QUnit process.
 *  2. All 95 fetches in test/integration/orm-test.ts are root-relative, so
 *     flipping the shared test/config/environment.ts to a non-default route
 *     would 404 every one of them.
 *
 * Like the dynamodb harness this must NOT run under NODE_ENV=test, or
 * test/config/environment.ts clobbers the paths and the route.
 *
 * ORM_TEST_ROUTE selects the row of the AC3/AC5 route matrix; package.json's
 * `test` script chains one process per row.
 */
const cwd = process.cwd();

const { default: Stonyx } = await import('stonyx');

// Raw ORM config — the Stonyx standalone transform wraps this as { orm: config }
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
    // Distinct from ./test/sample/db.json so this run cannot step on the main suite
    file: './test/sample/mounted-route-db.json',
    schema: './test/sample/db-schema.js',
  },
  restServer: {
    enabled: 'true',
    route: process.env.ORM_TEST_ROUTE ?? '/api',
  },
  // 'modules' is spread at the top level by the standalone transform, which is
  // how we configure @stonyx/rest-server itself.
  modules: {
    restServer: {
      // Distinct from the main suite's default 2666 so a straggling listener
      // from the previous chained run cannot be mistaken for this one.
      port: process.env.MOUNTED_REST_PORT ?? '2777',
      dir: './test/sample/requests',
    },
  },
};

new Stonyx(config, cwd);
