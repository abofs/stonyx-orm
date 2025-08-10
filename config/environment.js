const {
  ORM_MODEL_PATH,
  ORM_SERIALIZER_PATH,
  ORM_TRANSFORM_PATH,
  DB_AUTO_SAVE,
  DB_FILE,
  DB_SCHEMA_PATH,
  DB_SAVE_INTERVAL
} = process;

export default {
  db: {
    autosave: DB_AUTO_SAVE ?? 'false',
    file: DB_FILE ?? 'db.json',
    logColor: 'white',
    saveInterval: DB_SAVE_INTERVAL ?? 60 * 60, // 1 hour
    schema: DB_SCHEMA_PATH ?? './config/db-schema.js'
  },
  paths: {
    model: ORM_MODEL_PATH ?? './models',
    serializer: ORM_SERIALIZER_PATH ?? './serializers',
    transform: ORM_TRANSFORM_PATH ?? './transforms'
  }
}
