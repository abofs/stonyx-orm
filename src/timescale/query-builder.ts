// Re-export all base PostgreSQL query builders
export { validateIdentifier, buildInsert, buildUpdate, buildDelete, buildSelect } from '../postgres/query-builder.js';

import { validateIdentifier } from '../postgres/query-builder.js';

const SAFE_INTERVAL = /^\d+\s+(microsecond|millisecond|second|minute|hour|day|week|month|year)s?$/i;

export function validateInterval(interval: string, context: string = 'interval'): string {
  if (!interval || typeof interval !== 'string' || !SAFE_INTERVAL.test(interval.trim())) {
    throw new Error(`Invalid SQL ${context}: "${interval}". Intervals must match pattern like "7 days", "1 hour", "30 minutes".`);
  }

  return interval.trim();
}

const SAFE_AGGREGATE = /^(COUNT|SUM|AVG|MIN|MAX|FIRST|LAST)\s*\(\s*"?[a-zA-Z_][a-zA-Z0-9_]*"?\s*\)\s*(AS\s+"?[a-zA-Z_][a-zA-Z0-9_]*"?)?$/i;

export function validateAggregate(expr: string, context: string = 'aggregate'): string {
  if (!expr || typeof expr !== 'string' || !SAFE_AGGREGATE.test(expr.trim())) {
    throw new Error(`Invalid SQL ${context}: "${expr}". Aggregates must be simple function calls like "AVG(value) AS avg_value".`);
  }

  return expr.trim();
}

interface QueryResult {
  sql: string;
  values: unknown[];
}

interface SqlResult {
  sql: string;
}

interface HypertableOptions {
  chunkInterval?: string;
}

interface TimeBucketOptions {
  aggregates?: string[];
  where?: Record<string, unknown>;
  orderBy?: string;
  limit?: number;
}

interface ContinuousAggregateOptions {
  withNoData?: boolean;
}

/**
 * Build a CREATE TABLE + hypertable conversion statement.
 * TimescaleDB hypertables are regular tables converted via create_hypertable().
 */
export function buildCreateHypertable(table: string, timeColumn: string, options: HypertableOptions = {}): QueryResult {
  validateIdentifier(table, 'table name');
  validateIdentifier(timeColumn, 'column name');

  const { chunkInterval = '7 days' } = options;
  validateInterval(chunkInterval, 'chunk interval');

  const sql = `SELECT create_hypertable('"${table}"', '${timeColumn}', chunk_time_interval => INTERVAL '${chunkInterval}', if_not_exists => TRUE)`;

  return { sql, values: [] };
}

/**
 * Build a time_bucket aggregation query.
 */
export function buildTimeBucket(table: string, timeColumn: string, bucketSize: string, options: TimeBucketOptions = {}): QueryResult {
  validateIdentifier(table, 'table name');
  validateIdentifier(timeColumn, 'column name');

  const { aggregates = [], where, orderBy = 'bucket', limit } = options;
  const values: unknown[] = [];
  let paramIndex = 1;

  const selectCols: string[] = [`time_bucket($${paramIndex++}, "${timeColumn}") AS bucket`];
  values.push(bucketSize);

  for (const agg of aggregates) {
    selectCols.push(validateAggregate(agg));
  }

  const whereClauses: string[] = [];
  if (where) {
    for (const [k, v] of Object.entries(where)) {
      validateIdentifier(k, 'column name');
      whereClauses.push(`"${k}" = $${paramIndex++}`);
      values.push(v);
    }
  }

  const whereStr = whereClauses.length > 0 ? ` WHERE ${whereClauses.join(' AND ')}` : '';
  if (orderBy) validateIdentifier(orderBy, 'ORDER BY column');
  const orderStr = orderBy ? ` ORDER BY "${orderBy}"` : '';
  let limitStr = '';
  if (limit != null) {
    limitStr = ` LIMIT $${paramIndex++}`;
    values.push(limit);
  }

  const sql = `SELECT ${selectCols.join(', ')} FROM "${table}"${whereStr} GROUP BY bucket${orderStr}${limitStr}`;

  return { sql, values };
}

/**
 * Build a continuous aggregate creation statement.
 */
export function buildContinuousAggregate(viewName: string, table: string, timeColumn: string, bucketSize: string, aggregates: string[], options: ContinuousAggregateOptions = {}): SqlResult {
  validateIdentifier(viewName, 'view name');
  validateIdentifier(table, 'table name');
  validateIdentifier(timeColumn, 'column name');

  const { withNoData = false } = options;
  validateInterval(bucketSize, 'bucket size');
  aggregates.forEach(agg => validateAggregate(agg));

  const selectCols: string[] = [
    `time_bucket('${bucketSize}', "${timeColumn}") AS bucket`,
    ...aggregates,
  ];

  const withClause = withNoData ? ' WITH NO DATA' : '';

  const sql = `CREATE MATERIALIZED VIEW "${viewName}" WITH (timescaledb.continuous) AS SELECT ${selectCols.join(', ')} FROM "${table}" GROUP BY bucket${withClause}`;

  return { sql };
}

/**
 * Build an ADD compression policy statement.
 */
export function buildCompressionPolicy(table: string, compressAfter: string): SqlResult {
  validateIdentifier(table, 'table name');
  validateInterval(compressAfter, 'compress after interval');

  const sql = `SELECT add_compression_policy('"${table}"', INTERVAL '${compressAfter}', if_not_exists => TRUE)`;

  return { sql };
}

/**
 * Build an ALTER TABLE to enable compression on a hypertable.
 */
export function buildEnableCompression(table: string, segmentBy?: string, orderBy?: string): SqlResult {
  validateIdentifier(table, 'table name');

  let opts = `timescaledb.compress`;
  if (segmentBy) {
    validateIdentifier(segmentBy, 'column name');
    opts += `, timescaledb.compress_segmentby = '"${segmentBy}"'`;
  }
  if (orderBy) {
    validateIdentifier(orderBy, 'column name');
    opts += `, timescaledb.compress_orderby = '"${orderBy}"'`;
  }

  const sql = `ALTER TABLE "${table}" SET (${opts})`;

  return { sql };
}
