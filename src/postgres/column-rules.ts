import type { ColumnRule } from '../column-conversion.js';

/**
 * PostgreSQL's write-path conversion rule (#292).
 *
 * JSONB columns must receive a JSON *string*. node-pg's `prepareValue`
 * (`pg/lib/utils.js`) checks `Array.isArray` before its object fallback, so a
 * raw array is rendered as a Postgres array literal (`{"1","2","3"}`) rather
 * than JSON. `[]` becomes `{}`, which is valid JSON, so it lands silently
 * corrupted with no error.
 *
 * Two behaviours this rule must keep:
 *
 *  - `typeof value === 'string'` passes through untouched. A JSONB column
 *    already holding a JSON string (`'{"a":1}'`) must store the object it
 *    describes; an unconditional `JSON.stringify` would double-encode it.
 *  - An `undefined` column type is a no-op. `updated_at`, `id` and FK columns
 *    are added outside the attribute loop and are absent from
 *    `schema.columns`.
 *
 * The `'JSONB'` sentinel is the exact literal emitted by
 * `src/postgres/type-map.ts`, the only module that produces the values in
 * `schema.columns`. The two producing functions are `getPgType` and
 * `getVectorType` (`src/postgres/schema-introspector.ts` writes `columns[key]`
 * at exactly three sites, all routed through those two); `mysqlTypeToPg` is not
 * exported and is reachable only from inside `getPgType`.
 *
 * One documented gap: `getPgType` returns a consumer transform's declared
 * `pgType` verbatim, so a consumer writing `pgType: 'jsonb'` puts a value in
 * `schema.columns` that type-map never authored and this exact-match sentinel
 * misses. It misses identically on the create path, pre-fix and post-fix --
 * pre-existing and symmetric, not introduced here.
 */
export const postgresJsonRule: ColumnRule = (value, columnType) =>
  columnType === 'JSONB' && typeof value !== 'string'
    ? JSON.stringify(value)
    : value;
