import { readFile, fileExists } from '@stonyx/utils/file';
import path from 'path';
import fs from 'fs/promises';

export async function ensureMigrationsTable(pool, tableName = '__migrations') {
  await pool.execute(`
    CREATE TABLE IF NOT EXISTS \`${tableName}\` (
      id INT AUTO_INCREMENT PRIMARY KEY,
      filename VARCHAR(255) NOT NULL UNIQUE,
      applied_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
}

export async function getAppliedMigrations(pool, tableName = '__migrations') {
  const [rows] = await pool.execute(
    `SELECT filename FROM \`${tableName}\` ORDER BY id ASC`
  );

  return rows.map(row => row.filename);
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
  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    // Execute each statement separately (split on semicolons)
    const statements = splitStatements(upSql);

    for (const stmt of statements) {
      await connection.execute(stmt);
    }

    await connection.execute(
      `INSERT INTO \`${tableName}\` (filename) VALUES (?)`,
      [filename]
    );

    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

export async function rollbackMigration(pool, filename, downSql, tableName = '__migrations') {
  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    const statements = splitStatements(downSql);

    for (const stmt of statements) {
      await connection.execute(stmt);
    }

    await connection.execute(
      `DELETE FROM \`${tableName}\` WHERE filename = ?`,
      [filename]
    );

    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

function splitStatements(sql) {
  return sql
    .split(';')
    .map(s => s.trim())
    .filter(s => s.length > 0 && !s.startsWith('--'));
}
