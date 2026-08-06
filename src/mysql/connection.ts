import type { Pool } from 'mysql2/promise';

interface MysqlConfig {
  host: string;
  port?: number;
  user: string;
  password: string;
  database: string;
  connectionLimit?: number;
  migrationsTable?: string;
  migrationsDir?: string;
  autoMigrate?: boolean;
}

let pool: Pool | null = null;

export async function getPool(mysqlConfig: MysqlConfig): Promise<Pool> {
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

export async function closePool(): Promise<void> {
  if (!pool) return;

  await pool.end();
  pool = null;
}

export type { MysqlConfig };
