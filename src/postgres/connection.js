let pool = null;

export async function getPool(postgresConfig) {
  if (pool) return pool;

  const pg = await import('pg');
  const { Pool } = pg.default;

  pool = new Pool({
    host: postgresConfig.host,
    port: postgresConfig.port,
    user: postgresConfig.user,
    password: postgresConfig.password,
    database: postgresConfig.database,
    max: postgresConfig.connectionLimit,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 2000,
  });

  return pool;
}

export async function closePool() {
  if (!pool) return;
  await pool.end();
  pool = null;
}
