let pool = null;

export async function getPool(mysqlConfig) {
  if (pool) return pool;

  const mysql = await import('mysql2/promise');

  pool = mysql.createPool({
    host: mysqlConfig.host,
    port: mysqlConfig.port,
    user: mysqlConfig.user,
    password: mysqlConfig.password,
    database: mysqlConfig.database,
    connectionLimit: mysqlConfig.connectionLimit,
    waitForConnections: true,
    enableKeepAlive: true,
    keepAliveInitialDelay: 10000,
  });

  return pool;
}

export async function closePool() {
  if (!pool) return;

  await pool.end();
  pool = null;
}
