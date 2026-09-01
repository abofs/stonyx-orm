import { pluralize as basePluralize } from '@stonyx/utils/string';
import type { OrmRecord } from './types/orm-types.js';

export function isDbError(error: unknown): error is { code: string; message: string } {
  return typeof error === 'object' && error !== null && 'code' in error && typeof (error as Record<string, unknown>).code === 'string' && 'message' in error && typeof (error as Record<string, unknown>).message === 'string';
}

export function isOrmRecord(value: unknown): value is OrmRecord {
  return typeof value === 'object' && value !== null && '__data' in value && '__relationships' in value;
}

// Wrapper to handle dasherized model names (e.g., "access-link" → "access-links")
export function pluralize(word: string): string {
  if (word.includes('-')) {
    const parts = word.split('-');
    const last = parts.pop() as string;
    const pluralizedLast = basePluralize(last);
    return [...parts, pluralizedLast].join('-');
  }

  return basePluralize(word);
}

/**
 * The highest NUMERIC id held by a set of records, or `0` when there is none.
 *
 * ONE COPY, and the duplication it replaces is the reason it lives here. Three
 * near-identical reduces existed at once: `assignRecordId` (server-assigned id
 * selection), `StandaloneDB.create` (src/standalone-db.ts) and the #203 test
 * helper. `docs/improvements.md`'s standing WET Code category prescribes
 * exactly this remedy -- extract into the module that already acts as the
 * shared utility -- and `assignRecordId` already imported `isOrmRecord` from
 * here.
 *
 * NON-NUMBERS ARE SKIPPED RATHER THAN COERCED TO `0`, AND THAT IS STYLISTIC.
 * `StandaloneDB`'s shape mapped them to `0`, which can never beat a seed of
 * `0`. Measured over eleven input classes (`[]`, `1`, `NaN`, `'5'`, `'abc'`,
 * `-3`, `0`, `null`, `undefined`, `Infinity`, and mixed arrays) the two shapes
 * produce IDENTICAL output on every one. In particular `typeof NaN` is
 * `'number'`, so NEITHER shape coerces `NaN` -- both reject it on `NaN > max`,
 * which is `false`. An earlier revision of this code asserted that the skip was
 * what made the `NaN` case work; it is not, the comparison is, and that claim
 * has been removed rather than left standing.
 *
 * WHAT IS LOAD-BEARING is that this is not `Math.max(...ids)`. `Math.max`
 * returns `NaN` if any operand is `NaN`, and a record CAN be held under the key
 * `NaN` -- so the obvious fix assigns `NaN`, lands on that slot and overwrites
 * it, which is abofs/stonyx-orm#203 in a new disguise. Pinned by
 * test/unit/assign-record-id-test.ts AC2; before that file existed the whole
 * suite scored 951/0 under exactly that fix.
 */
export function maxNumericId(records: { id?: unknown }[]): number {
  return records.reduce((max: number, record) => {
    const { id } = record;

    return typeof id === 'number' && id > max ? id : max;
  }, 0);
}

/**
 * The message prefix `assignRecordId` throws with when no free id can be
 * derived for a model, and the ONE string `createHandler` matches on to answer
 * `409` instead of letting the rejection reach express's default handler.
 *
 * It lives here rather than in either file because both need it and neither
 * should own a copy: a literal in two places is how the two id coercions in
 * orm-request.ts drifted apart (see `coerceId`). The repo has no error codes
 * and no custom error classes -- 24 bare `throw new Error` sites across `src/`
 * -- so a shared prefix is the narrowest way to make ONE failure distinguishable
 * without inventing an error taxonomy this codebase does not use.
 */
export const NO_FREE_ID_ERROR = 'Cannot assign record ID: no free id available';
