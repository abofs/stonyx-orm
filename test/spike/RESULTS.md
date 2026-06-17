# Spike #154 — Results

**Date:** 2026-06-17
**Issue:** abofs/stonyx-orm#154

## Verdict: CONFIRMED — InnoDB deadlocks reproduced

Danny's report is correct. The ORM's fire-and-forget persist pattern produces InnoDB deadlocks under concurrent FK-linked writes. The issue is reproducible, frequent, and causes silent data loss.

---

### MySQL Results (InnoDB)

**Engine:** MySQL 9.6.0 (Homebrew, local)
**Configuration:** Pool size 10, 5 users × 5 devices × 5 sessions, 20 rounds

**Findings:**
- **Deadlocks (ER_LOCK_DEADLOCK / 1213): 38** — reproduced in 18 of 20 rounds (90%)
- **Silently dropped writes: 5** — user rows that should have been deleted still exist in the database
- **FK constraint violations (1452): 17** — concurrent reassignment attempts referencing deleted users
- **Total fire-and-forget ops: 588** (533 completed, 55 failed = 9.4% failure rate)

**Deadlock mechanism confirmed:**
- `DELETE FROM users WHERE id=1` acquires X lock on users row → cascades to acquire locks on devices/sessions rows for ON DELETE SET NULL
- Concurrent `DELETE FROM devices WHERE id=5` (fire-and-forget) acquires X lock on device row → needs FK check lock on users row
- Connection 1 holds users → needs device. Connection 2 holds device → needs users. **Classic deadlock cycle.**
- InnoDB picks a victim and rolls it back. The `.catch()` handler logs the error but never retries. **The write is silently lost.**

**Data loss proof:** 5 user rows across 20 rounds survived deletion — they should have been deleted but the deadlock-victim transaction was rolled back and never retried. In production, this means account deletion requests silently fail to delete the user.

### PostgreSQL Results (MVCC)

**Engine:** PostgreSQL 17.9 (pgvector/pgvector:pg17, Docker)
**Configuration:** Pool size 10, 10 users × 10 devices × 10 sessions, 50 rounds

**Findings:**
- **Deadlocks (40P01): 0** — Postgres MVCC does not produce deadlocks under this pattern
- **Lock wait timeouts: 0**
- **FK constraint violations (23503): 103** — concurrent updates referencing deleted users (1.9% failure rate)
- **Silently dropped writes: 0**
- **Total fire-and-forget ops: 5,468** (5,365 completed, 103 failed)

**Why Postgres doesn't deadlock:** MVCC means FK checks use snapshot visibility rather than shared locks. ON DELETE SET NULL cascades execute within the same transaction context. InnoDB's locking model is fundamentally different — FK checks require shared locks on referenced rows, creating the lock-ordering inversion.

---

## Conclusions

1. **The deadlock is real, frequent, and causes silent data loss on MySQL/InnoDB.** 38 deadlocks in 20 rounds with a modest 5-user × 10-child schema. Production schemas with more FK relationships will hit this more often.
2. **The issue is MySQL/InnoDB-specific.** Postgres's MVCC model avoids the deadlock entirely. However, Postgres still shows FK constraint violations (1.9%) — the fire-and-forget pattern is generally unsafe for FK-referencing operations regardless of engine.
3. **Danny's analysis is correct in every detail.** The fire-and-forget pattern + multi-connection pool + FK-linked tables + autocommit = classic InnoDB deadlock cycle with silent data loss.
4. **Stone's assessment also holds:** while the bug is real, the consumer pattern of rapid cascade deletes across FK-linked records in a single request is a design smell. The fix should address both sides.

## Recommended Follow-ups

1. **File write-serialization issue** — global persist-layer queue/mutex that serializes writes so two write transactions never overlap (approach #1 from Danny's report). Affects all DB types/drivers, not just MySQL.
2. **File await-delete-persist issue** — close the return-before-persist gap by awaiting delete operations in the request path (approach #4). Independent of serialization.
3. **Consider deadlock retry** — defense-in-depth: catch ER_LOCK_DEADLOCK and retry with backoff (approach #3). Band-aid on its own, but good safety net alongside serialization.
4. **Smart-lock consumer guidance** — evaluate whether the cascade pattern can be simplified to reduce concurrent write pressure regardless of ORM fixes.
