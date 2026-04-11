import PostgresDB from '../postgres/postgres-db.js';
import { buildCreateHypertable, buildTimeBucket, buildContinuousAggregate, buildCompressionPolicy, buildEnableCompression } from './query-builder.js';

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

interface CompressionOptions {
  segmentBy?: string;
  orderBy?: string;
}

export default class TimescaleDB extends PostgresDB {
  static override extensions: string[] = ['timescaledb'];
  static override configKey: string = 'timescale';

  constructor(deps: Record<string, unknown> = {}) {
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
   */
  async createHypertable(modelName: string, timeColumn: string, options: HypertableOptions = {}): Promise<void> {
    const schemas = this.deps.introspectModels();
    const schema = schemas[modelName];
    if (!schema) throw new Error(`Model '${modelName}' not found`);

    const { sql } = (this.deps as unknown as { buildCreateHypertable: typeof buildCreateHypertable }).buildCreateHypertable(schema.table, timeColumn, options);
    await this.requirePool().query(sql);
  }

  /**
   * Query time-bucketed aggregations on a hypertable.
   */
  async timeBucket(modelName: string, timeColumn: string, bucketSize: string, options: TimeBucketOptions = {}): Promise<Record<string, unknown>[]> {
    const schemas = this.deps.introspectModels();
    const schema = schemas[modelName];
    if (!schema) return [];

    const { sql, values } = (this.deps as unknown as { buildTimeBucket: typeof buildTimeBucket }).buildTimeBucket(schema.table, timeColumn, bucketSize, options);

    try {
      const result = await this.requirePool().query(sql, values);
      return result.rows;
    } catch (error) {
      if ((error as { code?: string }).code === '42P01') return [];
      throw error;
    }
  }

  /**
   * Create a continuous aggregate view on a hypertable.
   */
  async createContinuousAggregate(viewName: string, modelName: string, timeColumn: string, bucketSize: string, aggregates: string[], options: ContinuousAggregateOptions = {}): Promise<void> {
    const schemas = this.deps.introspectModels();
    const schema = schemas[modelName];
    if (!schema) throw new Error(`Model '${modelName}' not found`);

    const { sql } = (this.deps as unknown as { buildContinuousAggregate: typeof buildContinuousAggregate }).buildContinuousAggregate(viewName, schema.table, timeColumn, bucketSize, aggregates, options);
    await this.requirePool().query(sql);
  }

  /**
   * Enable compression on a hypertable.
   */
  async enableCompression(modelName: string, options: CompressionOptions = {}): Promise<void> {
    const schemas = this.deps.introspectModels();
    const schema = schemas[modelName];
    if (!schema) throw new Error(`Model '${modelName}' not found`);

    const { sql } = (this.deps as unknown as { buildEnableCompression: typeof buildEnableCompression }).buildEnableCompression(schema.table, options.segmentBy, options.orderBy);
    await this.requirePool().query(sql);
  }

  /**
   * Add a compression policy to a hypertable.
   */
  async addCompressionPolicy(modelName: string, compressAfter: string): Promise<void> {
    const schemas = this.deps.introspectModels();
    const schema = schemas[modelName];
    if (!schema) throw new Error(`Model '${modelName}' not found`);

    const { sql } = (this.deps as unknown as { buildCompressionPolicy: typeof buildCompressionPolicy }).buildCompressionPolicy(schema.table, compressAfter);
    await this.requirePool().query(sql);
  }
}
