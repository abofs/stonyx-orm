const {
  ORM_ACCESS_PATH,
  ORM_MODEL_PATH,
  ORM_REST_ROUTE,
  ORM_SERIALIZER_PATH,
  ORM_TRANSFORM_PATH,
  ORM_USE_REST_SERVER,
  DB_AUTO_SAVE,
  DB_FILE,
  DB_MODE,
  DB_DIRECTORY,
  DB_SCHEMA_PATH,
  DB_SAVE_INTERVAL
} = process;

export default {
  logColor: 'white',
  logMethod: 'db',
  
  db: {
    autosave: DB_AUTO_SAVE ?? 'false', // 'true' (cron interval), 'false' (disabled), 'onUpdate' (save after each write op)
    file: DB_FILE ?? 'db.json',
    mode: DB_MODE ?? 'file', // 'file' (single db.json) or 'directory' (one file per collection)
    directory: DB_DIRECTORY ?? 'db', // directory name for collection files when mode is 'directory'
    saveInterval: DB_SAVE_INTERVAL ?? 60 * 60, // 1 hour
    schema: DB_SCHEMA_PATH ?? './config/db-schema.js'
  },
  paths: {
    access: ORM_ACCESS_PATH ?? './access', // Optional for restServer access hooks
    model: ORM_MODEL_PATH ?? './models',
    serializer: ORM_SERIALIZER_PATH ?? './serializers',
    transform: ORM_TRANSFORM_PATH ?? './transforms'
  },
  restServer: {
    enabled: ORM_USE_REST_SERVER ?? 'true', // Whether to load restServer for automatic route setup or 
    route: ORM_REST_ROUTE ?? '/',
  }
}
