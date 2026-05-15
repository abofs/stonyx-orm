/**
 * Custom Stonyx bootstrap for DynamoDB integration tests.
 *
 * Because stonyx-orm is a standalone Stonyx module, the Stonyx constructor
 * auto-wraps config under { orm: config }. So we pass the RAW ORM config
 * (not nested under 'orm'). The standalone transform handles the nesting.
 *
 * Not using NODE_ENV=test prevents the standard test/config/environment.ts
 * merge from clobbering our model path.
 */
const cwd = process.cwd();

const { default: Stonyx } = await import('stonyx');

// Raw ORM config — Stonyx standalone transform wraps as { orm: config }
const config = {
  logColor: 'white',
  logMethod: 'db',
  dynamodb: {
    region: 'us-east-1',
    endpoint: 'http://localhost:8000',
  },
  paths: {
    model: './test/integration/dynamodb/models',
    access: './test/sample/access',
    serializer: './test/sample/serializers',
    transform: './test/sample/transforms',
    view: './test/sample/views',
  },
  db: {
    file: './test/sample/db.json',
    schema: './test/sample/db-schema.js',
  },
  restServer: {
    enabled: 'false',
  },
  // 'modules' key gets spread at the top level by the standalone transform,
  // allowing us to configure other Stonyx modules (e.g., rest-server)
  modules: {
    restServer: {
      enabled: 'false',
      port: 0, // Prevent EADDRINUSE if rest-server still tries to bind
    },
  },
};

new Stonyx(config, cwd);
