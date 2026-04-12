import type { Pool as PgPool } from 'pg';
import { validateIdentifier } from './query-builder.js';

interface PgConfig {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
  connectionLimit: number;
}

let pool: PgPool | null = null;

/**
 * Create or return the singleton pg Pool.
 */
export async function getPool(pgConfig: PgConfig, extensions: string[] = ['vector']): Promise<PgPool> {
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
    validateIdentifier(ext, 'extension name');
    await pool.query(`CREATE EXTENSION IF NOT EXISTS "${ext}"`);
  }

  return pool;
}

export async function closePool(): Promise<void> {
  if (!pool) return;

  await pool.end();
  pool = null;
}
