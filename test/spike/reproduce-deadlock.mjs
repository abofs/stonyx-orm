/**
 * Spike: Reproduce MySQL deadlock under concurrent fire-and-forget writes (#154)
 *
 * This script simulates the ORM's persist pattern:
 *   - store.remove() calls sqlDb.persist('delete', ...) WITHOUT awaiting
 *   - The persist call does pool.execute(DELETE ...) on whatever connection
 *     the pool hands out
 *   - When multiple removes fire in quick succession (e.g., cascade: delete
 *     user + SET NULL on devices/sessions), each gets its own connection and
 *     its own autocommit transaction
 *
 * We test whether this creates InnoDB deadlocks or silently dropped writes
 * on FK-linked tables with ON DELETE SET NULL constraints.
 *
 * Usage:
 *   docker compose -f test/spike/docker-compose.yml up -d
 *   # wait ~5s for MySQL to be ready
 *   node test/spike/reproduce-deadlock.mjs
 */

import mysql from 'mysql2/promise';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
const MYSQL_CONFIG = {
  host: '127.0.0.1',
  port: 3307,
  user: 'root',
  password: 'spiketest',
  database: 'deadlock_spike',
};

const POOL_SIZE = 10;         // same default range the ORM uses
const NUM_USERS = 5;          // users to seed per round
const DEVICES_PER_USER = 5;   // FK children per user
const SESSIONS_PER_USER = 5;
const ROUNDS = 20;            // repeat to increase odds

// ---------------------------------------------------------------------------
// Schema setup
// ---------------------------------------------------------------------------
const SCHEMA_SQL = `
DROP TABLE IF EXISTS sessions;
DROP TABLE IF EXISTS devices;
DROP TABLE IF EXISTS users;

CREATE TABLE users (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(100) NOT NULL
) ENGINE=InnoDB;

CREATE TABLE devices (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT,
  label VARCHAR(100) NOT NULL,
  CONSTRAINT fk_device_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB;

CREATE TABLE sessions (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT,
  token VARCHAR(100) NOT NULL,
  CONSTRAINT fk_session_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB;
`;

// ---------------------------------------------------------------------------
// Results tracking
// ---------------------------------------------------------------------------
const results = {
  deadlockErrors: [],      // ER_LOCK_DEADLOCK / 1213
  lockWaitTimeouts: [],    // ER_LOCK_WAIT_TIMEOUT / 1205
  otherErrors: [],
  droppedWrites: [],       // rows that should have been deleted but weren't
  totalDeletesFired: 0,
  totalDeletesCompleted: 0,
  totalDeletesFailed: 0,
  roundTimings: [],
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Mirrors the ORM's fire-and-forget pattern from store.remove() (store.ts:181):
 *
 *   Orm.instance.sqlDb.persist('delete', key, { recordId: id }, {}).catch((err) => {
 *     Orm.instance.emitPersistError({ ... });
 *   });
 *
 * The persist call is NOT awaited. It runs on whatever pool connection is free.
 * We collect the promise to check results later, but the caller does NOT await.
 */
function fireAndForgetDelete(pool, table, id) {
  results.totalDeletesFired++;

  const sql = `DELETE FROM \`${table}\` WHERE \`id\` = ?`;
  const promise = pool.execute(sql, [id])
    .then(() => {
      results.totalDeletesCompleted++;
    })
    .catch((err) => {
      results.totalDeletesFailed++;

      if (err.errno === 1213 || err.code === 'ER_LOCK_DEADLOCK') {
        results.deadlockErrors.push({
          table,
          id,
          message: err.message,
          errno: err.errno,
          sqlState: err.sqlState,
        });
      } else if (err.errno === 1205 || err.code === 'ER_LOCK_WAIT_TIMEOUT') {
        results.lockWaitTimeouts.push({
          table,
          id,
          message: err.message,
          errno: err.errno,
        });
      } else {
        results.otherErrors.push({
          table,
          id,
          message: err.message,
          errno: err.errno,
          code: err.code,
        });
      }
    });

  return promise; // collected but NOT awaited by the "caller"
}

/**
 * Mirrors the ORM's fire-and-forget update from updateRecord (manage-record.ts:186):
 *
 *   orm.sqlDb.persist('update', modelName, { record, oldState }, {}).catch(...)
 *
 * Also un-awaited. We fire SET NULL updates concurrently with the parent DELETE.
 */
function fireAndForgetUpdate(pool, table, id, column, value) {
  results.totalDeletesFired++; // reuse counter — it's "total fire-and-forget ops"

  const sql = `UPDATE \`${table}\` SET \`${column}\` = ? WHERE \`id\` = ?`;
  const promise = pool.execute(sql, [value, id])
    .then(() => {
      results.totalDeletesCompleted++;
    })
    .catch((err) => {
      results.totalDeletesFailed++;

      if (err.errno === 1213 || err.code === 'ER_LOCK_DEADLOCK') {
        results.deadlockErrors.push({
          table,
          id,
          message: err.message,
          errno: err.errno,
          sqlState: err.sqlState,
        });
      } else if (err.errno === 1205 || err.code === 'ER_LOCK_WAIT_TIMEOUT') {
        results.lockWaitTimeouts.push({
          table,
          id,
          message: err.message,
          errno: err.errno,
        });
      } else {
        results.otherErrors.push({
          table,
          id,
          message: err.message,
          errno: err.errno,
          code: err.code,
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
    const [result] = await pool.execute(
      'INSERT INTO users (name) VALUES (?)',
      [`user-${u}`]
    );
    const userId = result.insertId;
    userIds.push(userId);

    for (let d = 0; d < DEVICES_PER_USER; d++) {
      const [devResult] = await pool.execute(
        'INSERT INTO devices (user_id, label) VALUES (?, ?)',
        [userId, `device-${u}-${d}`]
      );
      deviceIds.push({ id: devResult.insertId, userId });
    }

    for (let s = 0; s < SESSIONS_PER_USER; s++) {
      const [sessResult] = await pool.execute(
        'INSERT INTO sessions (user_id, token) VALUES (?, ?)',
        [userId, `token-${u}-${s}`]
      );
      sessionIds.push({ id: sessResult.insertId, userId });
    }
  }

  return { userIds, deviceIds, sessionIds };
}

// ---------------------------------------------------------------------------
// Scenario 1: Concurrent parent deletes with FK SET NULL cascade
//
// This is the most direct reproduction: multiple users are deleted
// simultaneously via fire-and-forget. Each DELETE triggers InnoDB's
// internal ON DELETE SET NULL on child rows. When two parents share
// FK-linked children (or when the cascade locks overlap), deadlocks
// can occur.
// ---------------------------------------------------------------------------
async function scenarioConcurrentParentDeletes(pool, userIds) {
  const promises = [];

  // Fire all user deletes concurrently — no await, just like the ORM
  for (const userId of userIds) {
    promises.push(fireAndForgetDelete(pool, 'users', userId));
  }

  // Wait for all fire-and-forget promises to settle
  await Promise.allSettled(promises);
}

// ---------------------------------------------------------------------------
// Scenario 2: Interleaved parent delete + child updates
//
// Simulates the ORM doing: store.remove(user) + updateRecord(device, { user: null })
// Both fire-and-forget. The parent DELETE triggers FK SET NULL, while a
// concurrent UPDATE on the same child row creates a lock contention window.
// ---------------------------------------------------------------------------
async function scenarioDeleteWithChildUpdates(pool, userIds, deviceIds, sessionIds) {
  const promises = [];

  for (const userId of userIds) {
    // Fire parent delete (triggers ON DELETE SET NULL on devices + sessions)
    promises.push(fireAndForgetDelete(pool, 'users', userId));

    // Simultaneously fire explicit SET NULL updates on children
    // This mirrors the ORM pattern where relationship cleanup fires
    // un-awaited updates alongside the parent delete
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

// ---------------------------------------------------------------------------
// Scenario 3: Cross-user child reassignment during delete
//
// While user A is being deleted (cascading SET NULL on their devices),
// fire an update that reassigns user A's device to user B — and also
// delete user B. This creates a classic deadlock cycle:
//   Connection 1: DELETE user A → lock users row A → cascade lock device rows
//   Connection 2: UPDATE device SET user_id = B → lock device row → needs FK check on users B
//   Connection 3: DELETE user B → lock users row B → cascade lock device rows
// ---------------------------------------------------------------------------
async function scenarioCrossUserReassignment(pool, userIds, deviceIds) {
  if (userIds.length < 2) return;

  const promises = [];

  for (let i = 0; i < userIds.length - 1; i++) {
    const userA = userIds[i];
    const userB = userIds[i + 1];
    const userADevices = deviceIds.filter(d => d.userId === userA);

    // Delete user A
    promises.push(fireAndForgetDelete(pool, 'users', userA));

    // Reassign user A's devices to user B
    for (const device of userADevices) {
      promises.push(fireAndForgetUpdate(pool, 'devices', device.id, 'user_id', userB));
    }

    // Delete user B
    promises.push(fireAndForgetDelete(pool, 'users', userB));
  }

  await Promise.allSettled(promises);
}

// ---------------------------------------------------------------------------
// Verification: check for silently dropped writes
// ---------------------------------------------------------------------------
async function verifyState(pool, expectedDeletedUserIds) {
  // Check which users still exist
  const [remainingUsers] = await pool.execute('SELECT id FROM users');
  const remainingUserIds = new Set(remainingUsers.map(r => r.id));

  for (const userId of expectedDeletedUserIds) {
    if (remainingUserIds.has(userId)) {
      results.droppedWrites.push({
        table: 'users',
        id: userId,
        issue: 'User should have been deleted but still exists',
      });
    }
  }

  // Check for orphaned FK references (devices/sessions pointing to deleted users)
  const [orphanedDevices] = await pool.execute(
    'SELECT d.id, d.user_id FROM devices d LEFT JOIN users u ON d.user_id = u.id WHERE d.user_id IS NOT NULL AND u.id IS NULL'
  );
  for (const dev of orphanedDevices) {
    results.droppedWrites.push({
      table: 'devices',
      id: dev.id,
      issue: `Device references deleted user ${dev.user_id} — FK SET NULL was not applied`,
    });
  }

  const [orphanedSessions] = await pool.execute(
    'SELECT s.id, s.user_id FROM sessions s LEFT JOIN users u ON s.user_id = u.id WHERE s.user_id IS NOT NULL AND u.id IS NULL'
  );
  for (const sess of orphanedSessions) {
    results.droppedWrites.push({
      table: 'sessions',
      id: sess.id,
      issue: `Session references deleted user ${sess.user_id} — FK SET NULL was not applied`,
    });
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  console.log('=== Spike #154: MySQL Deadlock Reproduction ===\n');
  console.log(`Pool size: ${POOL_SIZE}`);
  console.log(`Users per round: ${NUM_USERS}`);
  console.log(`Devices per user: ${DEVICES_PER_USER}`);
  console.log(`Sessions per user: ${SESSIONS_PER_USER}`);
  console.log(`Rounds: ${ROUNDS}`);
  console.log('');

  const pool = mysql.createPool({
    ...MYSQL_CONFIG,
    connectionLimit: POOL_SIZE,
    waitForConnections: true,
  });

  // Wait for MySQL to be ready
  let retries = 0;
  while (retries < 30) {
    try {
      await pool.execute('SELECT 1');
      break;
    } catch {
      retries++;
      if (retries >= 30) {
        console.error('Could not connect to MySQL. Is docker running?');
        console.error('  docker compose -f test/spike/docker-compose.yml up -d');
        process.exit(1);
      }
      await new Promise(r => setTimeout(r, 1000));
    }
  }

  console.log('Connected to MySQL.\n');

  // Create schema
  const statements = SCHEMA_SQL.split(';').map(s => s.trim()).filter(Boolean);
  for (const stmt of statements) {
    await pool.execute(stmt);
  }
  console.log('Schema created.\n');

  // ---------------------------------------------------------------------------
  // Run scenarios across multiple rounds
  // ---------------------------------------------------------------------------
  for (let round = 0; round < ROUNDS; round++) {
    const roundStart = Date.now();

    // Re-create schema each round for clean state
    for (const stmt of statements) {
      await pool.execute(stmt);
    }

    const { userIds, deviceIds, sessionIds } = await seedData(pool);

    const scenarioIndex = round % 3;

    if (scenarioIndex === 0) {
      // Scenario 1: pure concurrent parent deletes
      await scenarioConcurrentParentDeletes(pool, userIds);
      await verifyState(pool, userIds);
    } else if (scenarioIndex === 1) {
      // Scenario 2: parent deletes + child updates interleaved
      await scenarioDeleteWithChildUpdates(pool, userIds, deviceIds, sessionIds);
      await verifyState(pool, userIds);
    } else {
      // Scenario 3: cross-user reassignment during delete
      await scenarioCrossUserReassignment(pool, userIds, deviceIds);
      await verifyState(pool, userIds);
    }

    const elapsed = Date.now() - roundStart;
    results.roundTimings.push(elapsed);

    const marker = results.deadlockErrors.length > 0 || results.lockWaitTimeouts.length > 0 ? ' ***' : '';
    process.stdout.write(`  Round ${round + 1}/${ROUNDS}: ${elapsed}ms${marker}\n`);
  }

  // ---------------------------------------------------------------------------
  // Report
  // ---------------------------------------------------------------------------
  console.log('\n=== RESULTS ===\n');
  console.log(`Total fire-and-forget operations: ${results.totalDeletesFired}`);
  console.log(`  Completed: ${results.totalDeletesCompleted}`);
  console.log(`  Failed:    ${results.totalDeletesFailed}`);
  console.log('');
  console.log(`Deadlock errors (ER_LOCK_DEADLOCK / 1213): ${results.deadlockErrors.length}`);
  console.log(`Lock wait timeouts (ER_LOCK_WAIT_TIMEOUT / 1205): ${results.lockWaitTimeouts.length}`);
  console.log(`Other errors: ${results.otherErrors.length}`);
  console.log(`Silently dropped writes: ${results.droppedWrites.length}`);
  console.log('');

  if (results.deadlockErrors.length > 0) {
    console.log('--- Deadlock Details ---');
    for (const err of results.deadlockErrors.slice(0, 10)) {
      console.log(`  Table: ${err.table}, ID: ${err.id}`);
      console.log(`  Error: ${err.message}`);
      console.log(`  errno: ${err.errno}, sqlState: ${err.sqlState}`);
      console.log('');
    }
    if (results.deadlockErrors.length > 10) {
      console.log(`  ... and ${results.deadlockErrors.length - 10} more\n`);
    }
  }

  if (results.lockWaitTimeouts.length > 0) {
    console.log('--- Lock Wait Timeout Details ---');
    for (const err of results.lockWaitTimeouts.slice(0, 5)) {
      console.log(`  Table: ${err.table}, ID: ${err.id}`);
      console.log(`  Error: ${err.message}`);
      console.log('');
    }
  }

  if (results.otherErrors.length > 0) {
    console.log('--- Other Error Details ---');
    for (const err of results.otherErrors.slice(0, 5)) {
      console.log(`  Table: ${err.table}, ID: ${err.id}`);
      console.log(`  Error: ${err.message}`);
      console.log(`  Code: ${err.code}, errno: ${err.errno}`);
      console.log('');
    }
  }

  if (results.droppedWrites.length > 0) {
    console.log('--- Dropped Write Details ---');
    for (const dw of results.droppedWrites.slice(0, 10)) {
      console.log(`  Table: ${dw.table}, ID: ${dw.id}`);
      console.log(`  Issue: ${dw.issue}`);
      console.log('');
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
    console.log('FAIL: InnoDB deadlocks reproduced under the ORM fire-and-forget pattern.');
    console.log(`  ${results.deadlockErrors.length} deadlock(s) detected across ${ROUNDS} rounds.`);
    console.log('  The un-awaited pool.execute() calls on FK-linked tables create');
    console.log('  concurrent autocommit transactions that deadlock on shared row locks.');
  } else if (hasTimeouts) {
    console.log('FAIL: Lock wait timeouts detected (potential deadlocks resolved by timeout).');
    console.log(`  ${results.lockWaitTimeouts.length} timeout(s) detected across ${ROUNDS} rounds.`);
  } else if (hasDroppedWrites) {
    console.log('FAIL: Writes were silently dropped — rows remain that should have been deleted.');
    console.log(`  ${results.droppedWrites.length} dropped write(s) detected.`);
  } else {
    console.log('PASS: No deadlocks, timeouts, or dropped writes detected in this run.');
    console.log('  NOTE: Absence of evidence is not evidence of absence.');
    console.log('  The race window may be too narrow to hit with this configuration.');
    console.log('  Consider increasing ROUNDS, NUM_USERS, or POOL_SIZE.');
  }

  console.log('');

  // Dump raw JSON for RESULTS.md
  const outputPath = new URL('./results-raw.json', import.meta.url).pathname;
  const { writeFile } = await import('fs/promises');
  await writeFile(outputPath, JSON.stringify(results, null, 2));
  console.log(`Raw results written to: ${outputPath}`);

  await pool.end();
  process.exit(hasDeadlocks || hasTimeouts || hasDroppedWrites ? 1 : 0);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(2);
});
