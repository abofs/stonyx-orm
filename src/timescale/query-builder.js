// Re-export all base PostgreSQL query builders
export { validateIdentifier, buildInsert, buildUpdate, buildDelete, buildSelect } from '../postgres/query-builder.js';

import { validateIdentifier } from '../postgres/query-builder.js';

/**
 * Build a CREATE TABLE + hypertable conversion statement.
 * TimescaleDB hypertables are regular tables converted via create_hypertable().
 * @param {string} table - Table name
 * @param {string} timeColumn - The time-partitioning column (must be a timestamp type)
 * @param {Object} [options]
 * @param {string} [options.chunkInterval='7 days'] - Chunk time interval
 * @returns {{ sql: string, values: any[] }}
 */
export function buildCreateHypertable(table, timeColumn, options = {}) {
  validateIdentifier(table, 'table name');
  validateIdentifier(timeColumn, 'column name');

  const { chunkInterval = '7 days' } = options;

  const sql = `SELECT create_hypertable('"${table}"', '${timeColumn}', chunk_time_interval => INTERVAL '${chunkInterval}', if_not_exists => TRUE)`;

  return { sql, values: [] };
}

/**
 * Build a time_bucket aggregation query.
 * @param {string} table - Table name
 * @param {string} timeColumn - Timestamp column to bucket
 * @param {string} bucketSize - Bucket interval (e.g. '1 hour', '5 minutes', '1 day')
 * @param {Object} [options]
 * @param {string[]} [options.aggregates] - Aggregate expressions (e.g. ['AVG("value") AS avg_value'])
 * @param {Object} [options.where] - WHERE conditions
 * @param {string} [options.orderBy='bucket'] - ORDER BY clause
 * @param {number} [options.limit] - LIMIT
 * @returns {{ sql: string, values: any[] }}
 */
export function buildTimeBucket(table, timeColumn, bucketSize, options = {}) {
  validateIdentifier(table, 'table name');
  validateIdentifier(timeColumn, 'column name');

  const { aggregates = [], where, orderBy = 'bucket', limit } = options;
  const values = [];
  let paramIndex = 1;

  const selectCols = [`time_bucket($${paramIndex++}, "${timeColumn}") AS bucket`];
  values.push(bucketSize);

  for (const agg of aggregates) {
    selectCols.push(agg);
  }

  let whereClauses = [];
  if (where) {
    for (const [k, v] of Object.entries(where)) {
      validateIdentifier(k, 'column name');
      whereClauses.push(`"${k}" = $${paramIndex++}`);
      values.push(v);
    }
  }

  const whereStr = whereClauses.length > 0 ? ` WHERE ${whereClauses.join(' AND ')}` : '';
  const orderStr = orderBy ? ` ORDER BY ${orderBy}` : '';
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
 * @param {string} viewName - Name for the continuous aggregate view
 * @param {string} table - Source hypertable
 * @param {string} timeColumn - Timestamp column
 * @param {string} bucketSize - Bucket interval
 * @param {string[]} aggregates - Aggregate expressions
 * @param {Object} [options]
 * @param {boolean} [options.withNoData=false] - Create without materializing data initially
 * @returns {{ sql: string }}
 */
export function buildContinuousAggregate(viewName, table, timeColumn, bucketSize, aggregates, options = {}) {
  validateIdentifier(viewName, 'view name');
  validateIdentifier(table, 'table name');
  validateIdentifier(timeColumn, 'column name');

  const { withNoData = false } = options;

  const selectCols = [
    `time_bucket('${bucketSize}', "${timeColumn}") AS bucket`,
    ...aggregates,
  ];

  const withClause = withNoData ? ' WITH NO DATA' : '';

  const sql = `CREATE MATERIALIZED VIEW "${viewName}" WITH (timescaledb.continuous) AS SELECT ${selectCols.join(', ')} FROM "${table}" GROUP BY bucket${withClause}`;

  return { sql };
}

/**
 * Build an ADD compression policy statement.
 * @param {string} table - Hypertable name
 * @param {string} compressAfter - Interval after which to compress (e.g. '7 days')
 * @returns {{ sql: string }}
 */
export function buildCompressionPolicy(table, compressAfter) {
  validateIdentifier(table, 'table name');

  const sql = `SELECT add_compression_policy('"${table}"', INTERVAL '${compressAfter}', if_not_exists => TRUE)`;

  return { sql };
}

/**
 * Build an ALTER TABLE to enable compression on a hypertable.
 * @param {string} table - Hypertable name
 * @param {string} segmentBy - Column to segment by (usually the non-time dimension)
 * @param {string} orderBy - Column to order compressed data by (usually the time column)
 * @returns {{ sql: string }}
 */
export function buildEnableCompression(table, segmentBy, orderBy) {
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
