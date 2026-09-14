/**
 * Shared write-path column conversion (#292).
 *
 * This module owns the *iteration* only — the single place where a write
 * payload is walked column-by-column and each value is handed to the driver's
 * own conversion rule. The rules themselves are genuinely disjoint per driver
 * (Postgres stringifies for JSONB; DynamoDB's DocumentClient marshals objects
 * and arrays natively and must NOT be given stringified values) and therefore
 * deliberately live with their drivers rather than being merged here.
 *
 * The duplicated create/update iteration was the drift vector that produced
 * #292: `_recordToRow` converted, `_persistUpdate` did not. Routing both
 * through `convertRow` removes the opportunity for the two to diverge again.
 */

/**
 * A driver-supplied per-column conversion rule.
 *
 * @param value      the raw value about to be bound into the query
 * @param columnType the column's declared type from `schema.columns`, or
 *                   `undefined` when the column is not an attribute column
 *                   (e.g. `updated_at`, FK columns and `id`, which are added
 *                   outside the attribute loop). Rules MUST be a no-op for
 *                   `undefined`.
 */
export type ColumnRule = (value: unknown, columnType: string | undefined) => unknown;

/**
 * Applies `rule` to every column of a complete write payload.
 *
 * Call this on the *finished* payload immediately before handing it to the
 * query builder — not inside a payload-building loop. Columns appended after
 * such a loop (FKs, `updated_at`) would otherwise bypass conversion, which is
 * the same class of defect #292 reports.
 */
export function convertRow(
  row: Record<string, unknown>,
  columns: Record<string, string>,
  rule: ColumnRule
): Record<string, unknown> {
  const converted: Record<string, unknown> = {};

  for (const [col, value] of Object.entries(row)) {
    // `Object.hasOwn`, not `columns[col]`: a column named `toString` or
    // `constructor` would otherwise reach the rule with a function as its
    // "declared type". Inert for the shipped Postgres rule (strict equality
    // against 'JSONB'), but `ColumnRule` is the extension point other drivers
    // write against, and the obvious `if (columnType)` rule would invert.
    converted[col] = rule(value, Object.hasOwn(columns, col) ? columns[col] : undefined);
  }

  return converted;
}
