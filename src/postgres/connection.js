let pool = null;

export async function getPool(pgConfig) {
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

  // Enable pgvector extension
  await pool.query('CREATE EXTENSION IF NOT EXISTS vector');

  return pool;
}

export async function closePool() {
  if (!pool) return;

  await pool.end();
  pool = null;
}
