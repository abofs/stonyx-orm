# Spike #154 — Results

**Date:** 2026-06-17
**Issue:** abofs/stonyx-orm#154

## Verdict: PARTIAL — Further testing required

### PostgreSQL Results (completed)

**Configuration:** Pool size 10, 10 users × 10 devices × 10 sessions, 50 rounds

**Findings:**
- **Deadlocks (40P01): 0** — Postgres MVCC does not produce deadlocks under this pattern
- **Lock wait timeouts: 0**
- **FK constraint violations (23503): 103** — cross-scenario UPDATE attempts referencing already-deleted users
- **Silently dropped writes: 0** — no data loss in Postgres
- **Total fire-and-forget ops: 5,468** (5,365 completed, 103 failed)

**Interpretation:**
- Postgres's MVCC model handles concurrent fire-and-forget writes without deadlocking
- However, the FK constraint violations (103/5468 = 1.9% failure rate) demonstrate that the fire-and-forget pattern DOES produce race conditions where operations reference stale state
- These aren't "silent" drops — they throw errors — but the ORM's `.catch()` handler only logs them, meaning the caller never knows the operation failed

### MySQL Results (BLOCKED)

**Status:** Unable to execute. Docker Desktop on this machine cannot pull new images from Docker Hub — pulls hang indefinitely despite registry auth succeeding and rate limits being clear. The MySQL 8 image (~600MB) is not cached locally.

**What's needed:** Either:
1. Resolve Docker Desktop pull issue (may need restart/reinstall)
2. Run on a different machine with MySQL available
3. Use an existing MySQL instance (e.g., synamicd-dev server)

### Why MySQL May Differ

The specific deadlock scenario Danny identified relies on **InnoDB's gap-locking behavior during FK cascade operations**:

1. `DELETE FROM users WHERE id = 1` acquires an X lock on the users row, then acquires locks on child rows (devices, sessions) to execute `ON DELETE SET NULL`
2. A concurrent `DELETE FROM devices WHERE id = 5` (fire-and-forget from the cascade hook) acquires an X lock on the device row, then needs to verify the FK (users row)
3. Connection 1 holds users lock → needs device lock. Connection 2 holds device lock → needs users lock. **Classic deadlock cycle.**

Postgres avoids this because:
- MVCC means readers don't block writers (FK checks use snapshot visibility)
- ON DELETE SET NULL cascades happen within the same transaction as the parent DELETE (not as separate autocommit operations on separate connections)

InnoDB's locking model is fundamentally different — it uses row-level locks that are held until commit, and FK checks require shared locks on the referenced rows.

## Interim Conclusions

1. **The fire-and-forget pattern is demonstrably unsafe** — even on Postgres, 1.9% of operations fail with FK constraint violations that are silently caught and logged
2. **The deadlock hypothesis remains plausible for MySQL** — Postgres's MVCC prevents it, but InnoDB's locking model creates the exact conditions Danny described
3. **Regardless of deadlocks, the pattern has a correctness hole** — un-awaited operations mean the HTTP response returns before writes complete, and any failure is silent to the caller

## Follow-up

- [ ] Run MySQL variant once Docker Hub pulls are resolved
- [ ] If MySQL confirms deadlocks: file write-serialization issue (global, all DB drivers)
- [ ] Regardless: the FK violation errors suggest a separate concern about fire-and-forget correctness for cross-referencing operations
