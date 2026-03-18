// Test-specific config overrides for ORM
// These target the post-standalone-transform shape: { orm: { ... }, restServer: { ... } }
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
      file: './test/sample/db.json',
      schema: './test/sample/db-schema.js'
    }
    // NOTE: MySQL test config is NOT here — it lives in test/helpers/mysql-test-helper.js.
    // Adding a mysql block here causes the ORM to initialize MysqlDB during setupIntegrationTests,
    // which breaks non-MySQL tests and causes race conditions with MySQL test setup.
  },
  restServer: {
    dir: './test/sample/requests'
  }
}
