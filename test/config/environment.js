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
  },
  restServer: {
    dir: './test/sample/requests'
  }
}
