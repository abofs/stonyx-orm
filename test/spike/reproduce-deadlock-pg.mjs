/**
 * Spike: Reproduce deadlock under concurrent fire-and-forget writes (#154)
 * PostgreSQL variant — runs against the existing local Postgres instance.
 *
 * Same pattern as the MySQL script: simulates the ORM's un-awaited persist
 * calls on a multi-connection pool against FK-linked tables.
 *
 * PostgreSQL reports deadlocks as error code 40P01 (deadlock_detected).
 *
 * Usage:
 *   node test/spike/reproduce-deadlock-pg.mjs
 */

import pg from 'pg';
const { Pool } = pg;

// ---------------------------------------------------------------------------
// Config — uses local trix-postgres container on port 5432
// ---------------------------------------------------------------------------
const PG_CONFIG = {
  host: '127.0.0.1',
  port: 5432,
  user: 'trix',
  password: 'trix-local',
  database: 'deadlock_spike',
};

const POOL_SIZE = parseInt(process.env.POOL_SIZE || '10');
const NUM_USERS = parseInt(process.env.NUM_USERS || '10');
const DEVICES_PER_USER = parseInt(process.env.DEVICES_PER_USER || '10');
const SESSIONS_PER_USER = parseInt(process.env.SESSIONS_PER_USER || '10');
const ROUNDS = parseInt(process.env.ROUNDS || '50');

// ---------------------------------------------------------------------------
// Results tracking
// ---------------------------------------------------------------------------
const results = {
  deadlockErrors: [],
  lockWaitTimeouts: [],
  otherErrors: [],
  droppedWrites: [],
  totalOpsFired: 0,
  totalOpsCompleted: 0,
  totalOpsFailed: 0,
  roundTimings: [],
};

// ---------------------------------------------------------------------------
// Database setup
// ---------------------------------------------------------------------------
async function ensureDatabase() {
  // Connect to default 'trix' database to create our spike database
  const adminPool = new Pool({ ...PG_CONFIG, database: 'trix' });
  try {
    await adminPool.query(`DROP DATABASE IF EXISTS deadlock_spike`);
    await adminPool.query(`CREATE DATABASE deadlock_spike`);
  } finally {
    await adminPool.end();
  }
}

const SCHEMA_SQL = `
DROP TABLE IF EXISTS sessions CASCADE;
DROP TABLE IF EXISTS devices CASCADE;
DROP TABLE IF EXISTS users CASCADE;

CREATE TABLE users (
  id SERIAL PRIMARY KEY,
  name VARCHAR(100) NOT NULL
);

CREATE TABLE devices (
  id SERIAL PRIMARY KEY,
  user_id INT REFERENCES users(id) ON DELETE SET NULL,
  label VARCHAR(100) NOT NULL
);

CREATE TABLE sessions (
  id SERIAL PRIMARY KEY,
  user_id INT REFERENCES users(id) ON DELETE SET NULL,
  token VARCHAR(100) NOT NULL
);
`;

// ---------------------------------------------------------------------------
// Fire-and-forget helpers (mirrors ORM pattern)
// ---------------------------------------------------------------------------

/**
 * Mirrors store.remove() → persist('delete', ...).catch(...)
 * Un-awaited by the caller. Each call grabs its own connection from the pool.
 */
function fireAndForgetDelete(pool, table, id) {
  results.totalOpsFired++;

  const sql = `DELETE FROM ${table} WHERE id = $1`;
  const promise = pool.query(sql, [id])
    .then(() => { results.totalOpsCompleted++; })
    .catch((err) => {
      results.totalOpsFailed++;
      if (err.code === '40P01') {  // deadlock_detected
        results.deadlockErrors.push({
          table, id, message: err.message, code: err.code,
        });
      } else if (err.code === '55P03') {  // lock_not_available
        results.lockWaitTimeouts.push({
          table, id, message: err.message, code: err.code,
        });
      } else {
        results.otherErrors.push({
          table, id, message: err.message, code: err.code,
        });
      }
    });

  return promise;
}

/**
 * Mirrors updateRecord() → persist('update', ...).catch(...)
 * Un-awaited. Fires SET NULL updates concurrently with parent DELETEs.
 */
function fireAndForgetUpdate(pool, table, id, column, value) {
  results.totalOpsFired++;

  const sql = `UPDATE ${table} SET ${column} = $1 WHERE id = $2`;
  const promise = pool.query(sql, [value, id])
    .then(() => { results.totalOpsCompleted++; })
    .catch((err) => {
      results.totalOpsFailed++;
      if (err.code === '40P01') {
        results.deadlockErrors.push({
          table, id, message: err.message, code: err.code,
        });
      } else if (err.code === '55P03') {
        results.lockWaitTimeouts.push({
          table, id, message: err.message, code: err.code,
        });
      } else {
        results.otherErrors.push({
          table, id, message: err.message, code: err.code,
        });
      }
    });

  return promise;
}

// ---------------------------------------------------------------------------
// Seed data
// ---------------------------------------------------------------------------
async function seedData(pool) {
  const userIds = [];
  const deviceIds = [];
  const sessionIds = [];

  for (let u = 0; u < NUM_USERS; u++) {
    const { rows } = await pool.query(
      'INSERT INTO users (name) VALUES ($1) RETURNING id', [`user-${u}`]
    );
    const userId = rows[0].id;
    userIds.push(userId);

    for (let d = 0; d < DEVICES_PER_USER; d++) {
      const { rows: devRows } = await pool.query(
        'INSERT INTO devices (user_id, label) VALUES ($1, $2) RETURNING id',
        [userId, `device-${u}-${d}`]
      );
      deviceIds.push({ id: devRows[0].id, userId });
    }

    for (let s = 0; s < SESSIONS_PER_USER; s++) {
      const { rows: sessRows } = await pool.query(
        'INSERT INTO sessions (user_id, token) VALUES ($1, $2) RETURNING id',
        [userId, `token-${u}-${s}`]
      );
      sessionIds.push({ id: sessRows[0].id, userId });
    }
  }

  return { userIds, deviceIds, sessionIds };
}

// ---------------------------------------------------------------------------
// Scenarios
// ---------------------------------------------------------------------------

async function scenarioConcurrentParentDeletes(pool, userIds) {
  const promises = [];
  for (const userId of userIds) {
    promises.push(fireAndForgetDelete(pool, 'users', userId));
  }
  await Promise.allSettled(promises);
}

async function scenarioDeleteWithChildUpdates(pool, userIds, deviceIds, sessionIds) {
  const promises = [];
  for (const userId of userIds) {
    promises.push(fireAndForgetDelete(pool, 'users', userId));
    const userDevices = deviceIds.filter(d => d.userId === userId);
    const userSessions = sessionIds.filter(s => s.userId === userId);
    for (const device of userDevices) {
      promises.push(fireAndForgetUpdate(pool, 'devices', device.id, 'user_id', null));
    }
    for (const session of userSessions) {
      promises.push(fireAndForgetUpdate(pool, 'sessions', session.id, 'user_id', null));
    }
  }
  await Promise.allSettled(promises);
}

async function scenarioCrossUserReassignment(pool, userIds, deviceIds) {
  if (userIds.length < 2) return;
  const promises = [];
  for (let i = 0; i < userIds.length - 1; i++) {
    const userA = userIds[i];
    const userB = userIds[i + 1];
    const userADevices = deviceIds.filter(d => d.userId === userA);
    promises.push(fireAndForgetDelete(pool, 'users', userA));
    for (const device of userADevices) {
      promises.push(fireAndForgetUpdate(pool, 'devices', device.id, 'user_id', userB));
    }
    promises.push(fireAndForgetDelete(pool, 'users', userB));
  }
  await Promise.allSettled(promises);
}

// ---------------------------------------------------------------------------
// Verification
// ---------------------------------------------------------------------------
async function verifyState(pool, expectedDeletedUserIds) {
  const { rows: remainingUsers } = await pool.query('SELECT id FROM users');
  const remainingUserIds = new Set(remainingUsers.map(r => r.id));

  for (const userId of expectedDeletedUserIds) {
    if (remainingUserIds.has(userId)) {
      results.droppedWrites.push({
        table: 'users', id: userId,
        issue: 'User should have been deleted but still exists',
      });
    }
  }

  const { rows: orphanedDevices } = await pool.query(
    'SELECT d.id, d.user_id FROM devices d LEFT JOIN users u ON d.user_id = u.id WHERE d.user_id IS NOT NULL AND u.id IS NULL'
  );
  for (const dev of orphanedDevices) {
    results.droppedWrites.push({
      table: 'devices', id: dev.id,
      issue: `Device references deleted user ${dev.user_id} — FK SET NULL was not applied`,
    });
  }

  const { rows: orphanedSessions } = await pool.query(
    'SELECT s.id, s.user_id FROM sessions s LEFT JOIN users u ON s.user_id = u.id WHERE s.user_id IS NOT NULL AND u.id IS NULL'
  );
  for (const sess of orphanedSessions) {
    results.droppedWrites.push({
      table: 'sessions', id: sess.id,
      issue: `Session references deleted user ${sess.user_id} — FK SET NULL was not applied`,
    });
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  console.log('=== Spike #154: Deadlock Reproduction (PostgreSQL) ===\n');
  console.log(`Pool size: ${POOL_SIZE}`);
  console.log(`Users per round: ${NUM_USERS}`);
  console.log(`Devices per user: ${DEVICES_PER_USER}`);
  console.log(`Sessions per user: ${SESSIONS_PER_USER}`);
  console.log(`Rounds: ${ROUNDS}\n`);

  await ensureDatabase();
  console.log('Database created.\n');

  const pool = new Pool({ ...PG_CONFIG, max: POOL_SIZE });

  // Create schema
  await pool.query(SCHEMA_SQL);
  console.log('Schema created.\n');

  for (let round = 0; round < ROUNDS; round++) {
    const roundStart = Date.now();

    await pool.query(SCHEMA_SQL);
    const { userIds, deviceIds, sessionIds } = await seedData(pool);

    const scenarioIndex = round % 3;
    if (scenarioIndex === 0) {
      await scenarioConcurrentParentDeletes(pool, userIds);
      await verifyState(pool, userIds);
    } else if (scenarioIndex === 1) {
      await scenarioDeleteWithChildUpdates(pool, userIds, deviceIds, sessionIds);
      await verifyState(pool, userIds);
    } else {
      await scenarioCrossUserReassignment(pool, userIds, deviceIds);
      await verifyState(pool, userIds);
    }

    const elapsed = Date.now() - roundStart;
    results.roundTimings.push(elapsed);
    const marker = results.deadlockErrors.length > 0 || results.lockWaitTimeouts.length > 0 ? ' ***' : '';
    process.stdout.write(`  Round ${round + 1}/${ROUNDS}: ${elapsed}ms${marker}\n`);
  }

  // Report
  console.log('\n=== RESULTS ===\n');
  console.log(`Total fire-and-forget operations: ${results.totalOpsFired}`);
  console.log(`  Completed: ${results.totalOpsCompleted}`);
  console.log(`  Failed:    ${results.totalOpsFailed}\n`);
  console.log(`Deadlock errors (40P01): ${results.deadlockErrors.length}`);
  console.log(`Lock wait timeouts (55P03): ${results.lockWaitTimeouts.length}`);
  console.log(`Other errors: ${results.otherErrors.length}`);
  console.log(`Silently dropped writes: ${results.droppedWrites.length}\n`);

  if (results.deadlockErrors.length > 0) {
    console.log('--- Deadlock Details ---');
    for (const err of results.deadlockErrors.slice(0, 10)) {
      console.log(`  Table: ${err.table}, ID: ${err.id}`);
      console.log(`  Error: ${err.message}`);
      console.log(`  Code: ${err.code}\n`);
    }
    if (results.deadlockErrors.length > 10) {
      console.log(`  ... and ${results.deadlockErrors.length - 10} more\n`);
    }
  }

  if (results.droppedWrites.length > 0) {
    console.log('--- Dropped Write Details ---');
    for (const dw of results.droppedWrites.slice(0, 10)) {
      console.log(`  Table: ${dw.table}, ID: ${dw.id}`);
      console.log(`  Issue: ${dw.issue}\n`);
    }
    if (results.droppedWrites.length > 10) {
      console.log(`  ... and ${results.droppedWrites.length - 10} more\n`);
    }
  }

  // Verdict
  console.log('=== VERDICT ===\n');
  const hasDeadlocks = results.deadlockErrors.length > 0;
  const hasTimeouts = results.lockWaitTimeouts.length > 0;
  const hasDroppedWrites = results.droppedWrites.length > 0;

  if (hasDeadlocks) {
    console.log('FAIL: Deadlocks reproduced under the ORM fire-and-forget pattern.');
    console.log(`  ${results.deadlockErrors.length} deadlock(s) across ${ROUNDS} rounds.`);
    console.log('  The un-awaited pool.query() calls on FK-linked tables create');
    console.log('  concurrent transactions that deadlock on shared row locks.');
    console.log('  This confirms the issue is engine-agnostic (not MySQL-specific).');
  } else if (hasTimeouts) {
    console.log('FAIL: Lock wait timeouts detected.');
    console.log(`  ${results.lockWaitTimeouts.length} timeout(s) across ${ROUNDS} rounds.`);
  } else if (hasDroppedWrites) {
    console.log('FAIL: Writes silently dropped — rows remain that should have been deleted.');
    console.log(`  ${results.droppedWrites.length} dropped write(s) detected.`);
  } else {
    console.log('PASS: No deadlocks, timeouts, or dropped writes detected.');
    console.log('  NOTE: Absence of evidence is not evidence of absence.');
    console.log('  Consider increasing ROUNDS, NUM_USERS, or POOL_SIZE.');
  }

  console.log('');

  const { writeFile } = await import('fs/promises');
  const outputPath = new URL('./results-pg-raw.json', import.meta.url).pathname;
  await writeFile(outputPath, JSON.stringify(results, null, 2));
  console.log(`Raw results written to: ${outputPath}`);

  await pool.end();
  process.exit(hasDeadlocks || hasTimeouts || hasDroppedWrites ? 1 : 0);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(2);
});
