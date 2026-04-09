let pool = null;

/**
 * Create or return the singleton pg Pool.
 * @param {Object} pgConfig - Connection config (host, port, user, password, database, connectionLimit)
 * @param {string[]} [extensions=['vector']] - PostgreSQL extensions to enable on init
 */
export async function getPool(pgConfig, extensions = ['vector']) {
  if (pool) return pool;

  const { default: pg } = await import('pg');

  pool = new pg.Pool({
    host: pgConfig.host,
    port: pgConfig.port,
    user: pgConfig.user,
    password: pgConfig.password,
    database: pgConfig.database,
    max: pgConfig.connectionLimit,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000,
  });

  // Enable requested PostgreSQL extensions
  for (const ext of extensions) {
    await pool.query(`CREATE EXTENSION IF NOT EXISTS ${ext}`);
  }

  return pool;
}

export async function closePool() {
  if (!pool) return;

  await pool.end();
  pool = null;
}
