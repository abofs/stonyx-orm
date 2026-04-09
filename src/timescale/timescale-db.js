import PostgresDB from '../postgres/postgres-db.js';
import { buildCreateHypertable, buildTimeBucket, buildContinuousAggregate, buildCompressionPolicy, buildEnableCompression } from './query-builder.js';

export default class TimescaleDB extends PostgresDB {
  static extensions = ['timescaledb'];
  static configKey = 'timescale';

  constructor(deps = {}) {
    super({
      ...deps,
      buildCreateHypertable,
      buildTimeBucket,
      buildContinuousAggregate,
      buildCompressionPolicy,
      buildEnableCompression,
    });
  }

  /**
   * Convert a table to a TimescaleDB hypertable.
   * Should be called after the table is created (e.g. after initial migration).
   * @param {string} modelName
   * @param {string} timeColumn - The time-partitioning column
   * @param {Object} [options]
   * @param {string} [options.chunkInterval='7 days']
   */
  async createHypertable(modelName, timeColumn, options = {}) {
    const schemas = this.deps.introspectModels();
    const schema = schemas[modelName];
    if (!schema) throw new Error(`Model '${modelName}' not found`);

    const { sql } = this.deps.buildCreateHypertable(schema.table, timeColumn, options);
    await this.pool.query(sql);
  }

  /**
   * Query time-bucketed aggregations on a hypertable.
   * @param {string} modelName
   * @param {string} timeColumn - Timestamp column to bucket
   * @param {string} bucketSize - Bucket interval (e.g. '1 hour', '5 minutes')
   * @param {Object} [options]
   * @param {string[]} [options.aggregates] - Aggregate expressions
   * @param {Object} [options.where] - WHERE conditions
   * @param {number} [options.limit]
   * @returns {Promise<Object[]>} Rows with bucket + aggregate columns
   */
  async timeBucket(modelName, timeColumn, bucketSize, options = {}) {
    const schemas = this.deps.introspectModels();
    const schema = schemas[modelName];
    if (!schema) return [];

    const { sql, values } = this.deps.buildTimeBucket(schema.table, timeColumn, bucketSize, options);

    try {
      const result = await this.pool.query(sql, values);
      return result.rows;
    } catch (error) {
      if (error.code === '42P01') return [];
      throw error;
    }
  }

  /**
   * Create a continuous aggregate view on a hypertable.
   * @param {string} viewName - Name for the materialized view
   * @param {string} modelName - Source hypertable model
   * @param {string} timeColumn - Timestamp column
   * @param {string} bucketSize - Bucket interval
   * @param {string[]} aggregates - Aggregate expressions
   * @param {Object} [options]
   * @param {boolean} [options.withNoData=false]
   */
  async createContinuousAggregate(viewName, modelName, timeColumn, bucketSize, aggregates, options = {}) {
    const schemas = this.deps.introspectModels();
    const schema = schemas[modelName];
    if (!schema) throw new Error(`Model '${modelName}' not found`);

    const { sql } = this.deps.buildContinuousAggregate(viewName, schema.table, timeColumn, bucketSize, aggregates, options);
    await this.pool.query(sql);
  }

  /**
   * Enable compression on a hypertable.
   * @param {string} modelName
   * @param {Object} [options]
   * @param {string} [options.segmentBy] - Column to segment by
   * @param {string} [options.orderBy] - Column to order by
   */
  async enableCompression(modelName, options = {}) {
    const schemas = this.deps.introspectModels();
    const schema = schemas[modelName];
    if (!schema) throw new Error(`Model '${modelName}' not found`);

    const { sql } = this.deps.buildEnableCompression(schema.table, options.segmentBy, options.orderBy);
    await this.pool.query(sql);
  }

  /**
   * Add a compression policy to a hypertable.
   * @param {string} modelName
   * @param {string} compressAfter - Interval after which to compress (e.g. '7 days')
   */
  async addCompressionPolicy(modelName, compressAfter) {
    const schemas = this.deps.introspectModels();
    const schema = schemas[modelName];
    if (!schema) throw new Error(`Model '${modelName}' not found`);

    const { sql } = this.deps.buildCompressionPolicy(schema.table, compressAfter);
    await this.pool.query(sql);
  }
}
