import { readFile, fileExists } from '@stonyx/utils/file';
import path from 'path';
import fs from 'fs/promises';
import type { Pool, PoolClient } from 'pg';
import { validateIdentifier } from './query-builder.js';

export async function ensureMigrationsTable(pool: Pool, tableName: string = '__migrations'): Promise<void> {
  validateIdentifier(tableName, 'migration table name');
  await pool.query(`
    CREATE TABLE IF NOT EXISTS "${tableName}" (
      id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      filename VARCHAR(255) NOT NULL UNIQUE,
      applied_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
}

export async function getAppliedMigrations(pool: Pool, tableName: string = '__migrations'): Promise<string[]> {
  validateIdentifier(tableName, 'migration table name');
  const result = await pool.query(
    `SELECT filename FROM "${tableName}" ORDER BY id ASC`
  );

  return result.rows.map(row => row.filename as string);
}

export async function getMigrationFiles(migrationsDir: string): Promise<string[]> {
  const exists = await fileExists(migrationsDir);
  if (!exists) return [];

  const entries = await fs.readdir(migrationsDir);

  return entries
    .filter(f => f.endsWith('.sql'))
    .sort();
}

export function parseMigrationFile(content: string): { up: string; down: string } {
  const upMarker = '-- UP';
  const downMarker = '-- DOWN';
  const upIndex = content.indexOf(upMarker);
  const downIndex = content.indexOf(downMarker);

  if (upIndex === -1) {
    return { up: content.trim(), down: '' };
  }

  const upStart = upIndex + upMarker.length;
  const upEnd = downIndex !== -1 ? downIndex : content.length;
  const up = content.slice(upStart, upEnd).trim();
  const down = downIndex !== -1 ? content.slice(downIndex + downMarker.length).trim() : '';

  return { up, down };
}

export async function applyMigration(pool: Pool, filename: string, upSql: string, tableName: string = '__migrations'): Promise<void> {
  validateIdentifier(tableName, 'migration table name');
  const client: PoolClient = await pool.connect();

  try {
    await client.query('BEGIN');

    const statements = splitStatements(upSql);

    for (const stmt of statements) {
      await client.query(stmt);
    }

    await client.query(
      `INSERT INTO "${tableName}" (filename) VALUES ($1)`,
      [filename]
    );

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function rollbackMigration(pool: Pool, filename: string, downSql: string, tableName: string = '__migrations'): Promise<void> {
  validateIdentifier(tableName, 'migration table name');
  const client: PoolClient = await pool.connect();

  try {
    await client.query('BEGIN');

    const statements = splitStatements(downSql);

    for (const stmt of statements) {
      await client.query(stmt);
    }

    await client.query(
      `DELETE FROM "${tableName}" WHERE filename = $1`,
      [filename]
    );

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

function splitStatements(sql: string): string[] {
  return sql
    .split(';')
    .map(s => s.trim())
    .filter(s => s.length > 0 && !s.startsWith('--'));
}
