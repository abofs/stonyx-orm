import QUnit from 'qunit';
import pg from 'pg';
import { TEST_TS_CONFIG } from '../../helpers/timescale-test-helper.js';
import { buildCreateHypertable, buildTimeBucket, buildContinuousAggregate, buildCompressionPolicy, buildEnableCompression } from '../../../src/timescale/query-builder.js';

let pool = null;

QUnit.module('[Integration] TimescaleDB — Hypertable & Time-Series', function (hooks) {
  hooks.before(async function () {
    try {
      const client = new pg.Client(TEST_TS_CONFIG);
      await client.connect();
      await client.query('CREATE EXTENSION IF NOT EXISTS timescaledb');
      await client.end();
    } catch {
      return;
    }

    pool = new pg.Pool(TEST_TS_CONFIG);

    // Create a test table for hypertable operations.
    // TimescaleDB requires that any unique constraint includes the partitioning column,
    // so we omit the PRIMARY KEY on id (or would need a composite PK including recorded_at).
    await pool.query(`
      CREATE TABLE IF NOT EXISTS "sensor_readings" (
        "id" INTEGER GENERATED ALWAYS AS IDENTITY,
        "sensor_id" VARCHAR(255) NOT NULL,
        "value" REAL NOT NULL,
        "recorded_at" TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
  });

  hooks.after(async function () {
    if (!pool) return;

    // Drop continuous aggregates first (depends on hypertable)
    await pool.query('DROP MATERIALIZED VIEW IF EXISTS "hourly_sensor_avg" CASCADE');
    await pool.query('DROP TABLE IF EXISTS "sensor_readings" CASCADE');
    await pool.end();
    pool = null;
  });

  // ── Assertion 4: create_hypertable() executes for models ──

  QUnit.test('create_hypertable converts table to hypertable', async function (assert) {
    if (!pool) { assert.expect(0); return; }

    const { sql } = buildCreateHypertable('sensor_readings', 'recorded_at', { chunkInterval: '7 days' });
    await pool.query(sql);

    // Verify it became a hypertable by querying TimescaleDB catalog
    const result = await pool.query(
      `SELECT hypertable_name FROM timescaledb_information.hypertables WHERE hypertable_name = 'sensor_readings'`
    );
    assert.strictEqual(result.rows.length, 1, 'sensor_readings is now a hypertable');
  });

  // ── Assertion 5: time_bucket query returns grouped results ──

  QUnit.test('time_bucket query returns bucketed aggregations', async function (assert) {
    if (!pool) { assert.expect(0); return; }

    // Ensure hypertable exists
    const { sql: htSql } = buildCreateHypertable('sensor_readings', 'recorded_at');
    await pool.query(htSql);

    // Insert time-series data across multiple hours
    const now = new Date();
    const inserts = [];
    for (let h = 0; h < 3; h++) {
      for (let i = 0; i < 5; i++) {
        const ts = new Date(now.getTime() - h * 60 * 60 * 1000 - i * 60 * 1000);
        inserts.push(
          pool.query(
            'INSERT INTO "sensor_readings" ("sensor_id", "value", "recorded_at") VALUES ($1, $2, $3)',
            [`sensor-1`, 10 + h * 5 + i, ts]
          )
        );
      }
    }
    await Promise.all(inserts);

    // Query with time_bucket
    const { sql, values } = buildTimeBucket('sensor_readings', 'recorded_at', '1 hour', {
      aggregates: ['AVG("value") AS avg_value', 'COUNT(*) AS reading_count'],
      orderBy: 'bucket DESC',
    });

    const result = await pool.query(sql, values);

    assert.ok(result.rows.length >= 2, `got ${result.rows.length} buckets (expected ≥2)`);

    for (const row of result.rows) {
      assert.ok(row.bucket instanceof Date, 'bucket is a Date');
      assert.ok(typeof row.avg_value === 'number' || typeof row.avg_value === 'string', 'avg_value present');
      assert.ok(Number(row.reading_count) > 0, 'reading_count > 0');
    }
  });

  QUnit.test('time_bucket with WHERE filters correctly', async function (assert) {
    if (!pool) { assert.expect(0); return; }

    const { sql: htSql } = buildCreateHypertable('sensor_readings', 'recorded_at');
    await pool.query(htSql);

    // Clear and insert data for two sensors
    await pool.query('TRUNCATE TABLE "sensor_readings"');

    const now = new Date();
    const inserts = [];
    for (let i = 0; i < 10; i++) {
      const ts = new Date(now.getTime() - i * 10 * 60 * 1000);
      inserts.push(pool.query(
        'INSERT INTO "sensor_readings" ("sensor_id", "value", "recorded_at") VALUES ($1, $2, $3)',
        ['sensor-a', 100 + i, ts]
      ));
      inserts.push(pool.query(
        'INSERT INTO "sensor_readings" ("sensor_id", "value", "recorded_at") VALUES ($1, $2, $3)',
        ['sensor-b', 200 + i, ts]
      ));
    }
    await Promise.all(inserts);

    const { sql, values } = buildTimeBucket('sensor_readings', 'recorded_at', '1 hour', {
      aggregates: ['AVG("value") AS avg_value'],
      where: { sensor_id: 'sensor-a' },
    });

    const result = await pool.query(sql, values);
    assert.ok(result.rows.length >= 1, 'got bucketed results for sensor-a');

    // All avg_values should be in the 100-range (sensor-a data)
    for (const row of result.rows) {
      const avg = parseFloat(row.avg_value);
      assert.ok(avg >= 100 && avg < 200, `avg_value ${avg} is in sensor-a range`);
    }
  });

  // ── Assertion 6: Continuous aggregate DDL generates valid SQL ──

  QUnit.test('continuous aggregate creates a materialized view', async function (assert) {
    if (!pool) { assert.expect(0); return; }

    const { sql: htSql } = buildCreateHypertable('sensor_readings', 'recorded_at');
    await pool.query(htSql);

    // Drop if exists from previous run
    await pool.query('DROP MATERIALIZED VIEW IF EXISTS "hourly_sensor_avg" CASCADE');

    const { sql } = buildContinuousAggregate(
      'hourly_sensor_avg',
      'sensor_readings',
      'recorded_at',
      '1 hour',
      ['AVG("value") AS avg_value', 'COUNT(*) AS reading_count'],
      { withNoData: true }
    );

    await pool.query(sql);

    // Verify the materialized view exists
    const result = await pool.query(
      `SELECT view_name FROM timescaledb_information.continuous_aggregates WHERE view_name = 'hourly_sensor_avg'`
    );
    assert.strictEqual(result.rows.length, 1, 'continuous aggregate view was created');
  });

  // ── Assertion 7: Compression policy applies ──

  QUnit.test('enable compression and add compression policy', async function (assert) {
    if (!pool) { assert.expect(0); return; }

    const { sql: htSql } = buildCreateHypertable('sensor_readings', 'recorded_at');
    await pool.query(htSql);

    // Enable compression
    const { sql: compressSql } = buildEnableCompression('sensor_readings', 'sensor_id', 'recorded_at');
    await pool.query(compressSql);

    // Add compression policy
    const { sql: policySql } = buildCompressionPolicy('sensor_readings', '7 days');
    await pool.query(policySql);

    // Verify compression is enabled on the hypertable
    const result = await pool.query(
      `SELECT compression_enabled FROM timescaledb_information.hypertables WHERE hypertable_name = 'sensor_readings'`
    );
    assert.ok(result.rows.length === 1, 'hypertable found');
    assert.strictEqual(result.rows[0].compression_enabled, true, 'compression is enabled');

    // Verify compression policy exists
    const policyResult = await pool.query(
      `SELECT * FROM timescaledb_information.jobs WHERE hypertable_name = 'sensor_readings' AND proc_name = 'policy_compression'`
    );
    assert.ok(policyResult.rows.length >= 1, 'compression policy job exists');
  });
});

QUnit.module('[Integration] TimescaleDB — Migration Generation', function (hooks) {
  // ── Assertion 10: Migration generation produces valid TimescaleDB-aware SQL ──

  QUnit.test('query builders produce syntactically correct SQL', function (assert) {
    // buildCreateHypertable
    const ht = buildCreateHypertable('metrics', 'created_at', { chunkInterval: '1 day' });
    assert.ok(ht.sql.includes('create_hypertable'), 'hypertable SQL contains create_hypertable');
    assert.ok(ht.sql.includes("'1 day'"), 'chunk interval included');

    // buildTimeBucket
    const tb = buildTimeBucket('metrics', 'created_at', '5 minutes', {
      aggregates: ['AVG("value") AS avg_val'],
      where: { sensor_id: 's1' },
      limit: 100,
    });
    assert.ok(tb.sql.includes('time_bucket'), 'time_bucket SQL present');
    assert.ok(tb.sql.includes('GROUP BY bucket'), 'GROUP BY bucket present');
    assert.ok(tb.sql.includes('LIMIT'), 'LIMIT clause present');
    assert.strictEqual(tb.values.length, 3, '3 params: bucketSize, sensor_id, limit');

    // buildContinuousAggregate
    const ca = buildContinuousAggregate('hourly_avg', 'metrics', 'created_at', '1 hour', ['AVG("value")']);
    assert.ok(ca.sql.includes('CREATE MATERIALIZED VIEW'), 'continuous aggregate uses MATERIALIZED VIEW');
    assert.ok(ca.sql.includes('timescaledb.continuous'), 'continuous option present');

    // buildContinuousAggregate with withNoData
    const caNoData = buildContinuousAggregate('hourly_avg', 'metrics', 'created_at', '1 hour', ['AVG("value")'], { withNoData: true });
    assert.ok(caNoData.sql.includes('WITH NO DATA'), 'withNoData option generates WITH NO DATA');

    // buildEnableCompression
    const ec = buildEnableCompression('metrics', 'device_id', 'created_at');
    assert.ok(ec.sql.includes('timescaledb.compress'), 'compression ALTER present');
    assert.ok(ec.sql.includes('compress_segmentby'), 'segmentBy option present');
    assert.ok(ec.sql.includes('compress_orderby'), 'orderBy option present');

    // buildCompressionPolicy
    const cp = buildCompressionPolicy('metrics', '30 days');
    assert.ok(cp.sql.includes('add_compression_policy'), 'compression policy SQL present');
    assert.ok(cp.sql.includes("'30 days'"), 'interval included');
  });
});
