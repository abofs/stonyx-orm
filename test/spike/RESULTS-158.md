# Spike #158 — Results

**Date:** 2026-06-17
**Issue:** abofs/stonyx-orm#158

## Verdict: CONFIRMED — PATCH updates silently fail to persist to MySQL

The bug is structural (code ordering), not a race condition. It affects ALL HTTP PATCH operations via the auto-REST handler on every request.

---

## Findings

### Test 1: Direct Code-Path Simulation

Against MySQL 9.6.0 (local Homebrew):

1. **PASS** — Created user with `email_verified = 0` in MySQL
2. **PASS** — Simulated `_persistUpdate` with `context.record = undefined` → early return, no SQL executed
3. **PASS** — MySQL row unchanged (email_verified still 0) after the "update"
4. **PASS** — When `context.record` IS provided (simulating correct behavior), MySQL row updates correctly

### Test 3: Source Code Ordering Verification

From `src/orm-request.ts`:

- **Line 449:** `await sqlDb.persist(operation, this.model, context, response)` — persist runs here
- **Line 465:** `context.record = store.get(this.model, getId(request.params))` — record assigned here (16 lines LATER)

From `src/mysql/mysql-db.ts`:

- **Line 466:** `const record = context.record;`
- **Line 467:** `if (!record) return;` — early return when undefined (silent no-op)

## Root Cause

The `_withHooks()` method in `orm-request.ts` has the persist call BEFORE the `context.record` assignment for update operations. The handler executes (updates in-memory), then persist runs against an incomplete context, then context.record is set (too late for SQL).

For CREATE operations, this doesn't matter because `_persistCreate` derives the record from `response.data` instead of `context.record`.

For programmatic updates via `updateRecord()` (in `manage-record.ts`), this doesn't matter because that code path explicitly sets `context.record` before calling persist.

## Blast Radius

**ALL HTTP PATCH operations via auto-REST handler:**
- Admin "Verify Email" (`emailVerified: true`)
- User device selection (`selectedDevice: <id>`)
- Any attribute update via PATCH to an auto-REST endpoint

**NOT affected:**
- CREATE operations (derives record from response.data)
- Programmatic `updateRecord()` calls (sets context.record before persist)
- In-memory state (updates correctly, reverts on process restart)

## Suggested Fix

In `orm-request.ts` `_withHooks()`, move the `context.record` assignment for updates BEFORE the persist call:

```typescript
// After handler executes and before persist:
if (operation === 'update' && response?.data) {
  context.record = store.get(this.model, getId(request.params));
}

// Then persist:
if (sqlDb && (operation === 'create' || operation === 'update')) {
  await sqlDb.persist(operation, this.model, context, response);
}
```

Alternatively, `_persistUpdate` could look up the record itself from the store rather than relying on `context.record`.

## Relation to Other Issues

- Same failure class as 2026-05-14 email-verification prod incident
- Same test-suite blind spot as #154 (deadlock spike) — in-memory tests can't catch SQL persistence issues
- Independent of #154 (deadlock) — different code path, different mechanism
