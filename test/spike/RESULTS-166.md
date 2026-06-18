# Spike #166 — Results

**Date:** 2026-06-17
**Issue:** abofs/stonyx-orm#166

## Verdict: CONFIRMED (latent) — store.get() falsy-ID bug; regression vector unclear

The `store.get()` falsy-ID bug is real and confirmed. However, the code paths for POST create persist are **identical** between beta.83 and beta.89 — the regression vector between those two versions could not be identified from code analysis alone.

---

## Findings

### Test 1: store.get() falsy-ID edge cases

`store.get(key, id)` at line 67 of `store.ts` uses `if (!id)` (falsy check):

```typescript
get(key: string, id?: number | string) {
    if (!id) return this.data.get(key);  // returns the Map for id=0, undefined, ''
    return this.data.get(key)?.get(id);
}
```

- **PASS** — `store.get(model, undefined)` returns a Map (truthy non-record)
- **PASS** — `store.get(model, 0)` returns a Map (truthy non-record)
- **PASS** — `store.get(model, '')` returns a Map (truthy non-record)
- **PASS** — The returned Map has no `toJSON()` → throws TypeError
- **PASS** — `store.get(model, 42)` for missing record returns `undefined` (correct)

### Test 2: assignRecordId

`assignRecordId()` at line 204 also uses a falsy check: `if (rawData.id) return;`

- `rawData.id = 0` would pass the falsy check and get overwritten with a pending negative ID
- For normal auto-increment usage (no id in POST body), this assigns `-(++pendingIdCounter)`

### Test 3-4: _persistCreate code path

- `_persistCreate` reads `response.data.id` for the store.get lookup
- For pending IDs (negative integers), `store.get(model, -1)` works correctly (`!(-1)` is false)
- Re-key from pending to real ID works correctly in simulation
- MySQL INSERT + re-key + response mutation all work as expected

### Test 7: Bisect beta.83 vs dev

- `_persistCreate` **unchanged** between beta.83 and beta.89 (identical mysql-db.ts)
- `persist()` wrapper unchanged between beta.83 and beta.89 (write queue added only in #165 / beta.90)
- `store.get()` unchanged between beta.83 and beta.89
- Only changes: orm-request.ts (#160 context.record for update, #157 WRITE_OPERATIONS + _skipAutoPersist)
- Neither #160 nor #157 modifies the create code path

## Analysis

### Confirmed: Latent store.get() falsy-ID bug

`store.get(key, id)` uses `if (!id)` instead of a nullish check. When `id` is `0`, `undefined`, or `''`, it returns the entire model Map instead of `undefined`. The Map is truthy but has no `toJSON()`, causing TypeError in consumer code that expects a record or undefined.

This bug has existed since `store.get()` was written. It is NOT a regression introduced between beta.83 and beta.89.

### Unclear: Regression vector

Between beta.83 and beta.89, the POST create persist code path is **identical**:

| Component | beta.83 | beta.89 | Changed? |
|-----------|---------|---------|----------|
| `createHandler` | ✅ `_skipAutoPersist: true` | ✅ Same | No |
| `_withHooks` persist condition | `create \|\| update` | `WRITE_OPERATIONS.has()` | Yes, but equivalent for 'create' |
| `_withHooks` context.record for create | `store.get(model, recordId)` after persist | Same | No |
| `mysql-db.ts persist()` | Direct switch/case | Same | No |
| `mysql-db.ts _persistCreate` | Full method | Same | No |
| `store.get()` | `if (!id)` falsy check | Same | No |

**Possible explanations:**

1. **Consumer-side change**: The consumer added or modified a beforeHook that calls `store.get(model, bodyId)` where `bodyId` is undefined (no id in POST body for auto-increment)
2. **Version mismatch**: Consumer may actually be on beta.90 (published today with #165 write queue), not beta.89
3. **Transitive dependency**: A `stonyx` or `@stonyx/utils` version bump changed runtime behavior that surfaces the latent store.get bug

## Recommendations

1. **Fix the latent bug**: Change `store.get()` to use a proper check instead of falsy:
   ```typescript
   get(key: string, id?: number | string) {
       if (arguments.length < 2) return this.data.get(key);
       return this.data.get(key)?.get(id!);
   }
   ```
   Or:
   ```typescript
   if (id === undefined) return this.data.get(key);
   ```

2. **Request consumer reproduction**: Ask Danny for a minimal reproduction case — specifically what the beforeHook does and what `id` value triggers the bug

3. **Verify version**: Confirm whether the consumer is actually on beta.89 or beta.90

## Test Results

24 PASS, 0 FAIL, 0 SKIP
