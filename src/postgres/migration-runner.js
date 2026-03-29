import { fileExists } from '@stonyx/utils/file';
import fs from 'fs/promises';

export async function ensureMigrationsTable(pool, tableName = '__migrations') {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS "${tableName}" (
      id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      filename VARCHAR(255) NOT NULL UNIQUE,
      applied_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    )
  `);
}

export async function getAppliedMigrations(pool, tableName = '__migrations') {
  const result = await pool.query(`SELECT filename FROM "${tableName}" ORDER BY id ASC`);
  return result.rows.map(row => row.filename);
}

export async function getMigrationFiles(migrationsDir) {
  const exists = await fileExists(migrationsDir);
  if (!exists) return [];

  const entries = await fs.readdir(migrationsDir);

  return entries
    .filter(f => f.endsWith('.sql'))
    .sort();
}

export function parseMigrationFile(content) {
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

export async function applyMigration(pool, filename, upSql, tableName = '__migrations') {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const statements = splitStatements(upSql);

    for (const stmt of statements) {
      await client.query(stmt);
    }

    await client.query(`INSERT INTO "${tableName}" (filename) VALUES ($1)`, [filename]);

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function rollbackMigration(pool, filename, downSql, tableName = '__migrations') {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const statements = splitStatements(downSql);

    for (const stmt of statements) {
      await client.query(stmt);
    }

    await client.query(`DELETE FROM "${tableName}" WHERE filename = $1`, [filename]);

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export function splitStatements(sql) {
  return sql
    .split(';')
    .map(s =>
      s
        .split('\n')
        .filter(line => !line.trim().startsWith('--'))
        .join('\n')
        .trim()
    )
    .filter(s => s.length > 0);
}
