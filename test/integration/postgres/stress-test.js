import QUnit from 'qunit';
import pg from 'pg';
import { TEST_PG_CONFIG } from '../../helpers/pg-test-helper.js';

// Stress test configuration
const VECTOR_DIM = 128;    // Smaller dims for speed — 768d validated in beatrix-shared#55 benchmark
const SCALES = [10_000, 50_000, 100_000];
const CONCURRENT_CONNECTIONS = 50;
const CONCURRENT_OPS = 10_000;
const POOL_SIZE = 10;       // Smaller than CONCURRENT_CONNECTIONS to test exhaustion
const RECALL_K = 10;
const SOAK_DURATION_MS = 2 * 60 * 1000; // 2 minutes (full 30min soak should be run manually)

let pool = null;

function randomVector(dim) {
  const vec = new Float32Array(dim);
  for (let i = 0; i < dim; i++) vec[i] = Math.random() * 2 - 1;
  return vec;
}

/**
 * Generate clustered vectors that mimic real embedding distributions.
 * Uniform random vectors have degenerate distance distributions in high-d,
 * making HNSW recall artificially low. Clustered vectors are realistic.
 */
const NUM_CLUSTERS = 50;
const clusterCenters = Array.from({ length: NUM_CLUSTERS }, (_, c) => {
  const center = new Float32Array(VECTOR_DIM);
  for (let i = 0; i < VECTOR_DIM; i++) center[i] = Math.sin(c * 17 + i * 7) * 0.8;
  return center;
});

function clusteredVector(dim) {
  const center = clusterCenters[Math.floor(Math.random() * NUM_CLUSTERS)];
  const vec = new Float32Array(dim);
  for (let i = 0; i < dim; i++) vec[i] = center[i] + (Math.random() - 0.5) * 0.3;
  return vec;
}

function vectorToString(vec) {
  return `[${Array.from(vec).join(',')}]`;
}

function cosineDistance(a, b) {
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  return 1 - dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

QUnit.module('[Stress] PostgreSQL + pgvector', function (hooks) {
  hooks.before(async function () {
    try {
      const client = new pg.Client(TEST_PG_CONFIG);
      await client.connect();
      await client.query('CREATE EXTENSION IF NOT EXISTS vector');
      await client.end();
    } catch {
      return; // PG unavailable — tests will skip
    }

    pool = new pg.Pool({ ...TEST_PG_CONFIG, max: POOL_SIZE });
  });

  hooks.after(async function () {
    if (!pool) return;
    // Clean up all stress test tables
    try {
      await pool.query('DROP TABLE IF EXISTS stress_vectors CASCADE');
      await pool.query('DROP TABLE IF EXISTS stress_rw CASCADE');
      await pool.query('DROP TABLE IF EXISTS stress_pool CASCADE');
    } catch { /* ignore */ }
    await pool.end();
    pool = null;
  });

  // ── Concurrent Read/Write ───────────────────────────────────────────

  QUnit.test('concurrent read/write: 50 connections, 10K operations', async function (assert) {
    if (!pool) { assert.expect(0); return; }

    await pool.query(`
      CREATE TABLE IF NOT EXISTS stress_rw (
        id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        value VARCHAR(255),
        counter INTEGER DEFAULT 0
      )
    `);

    // Seed 100 rows
    for (let i = 0; i < 100; i++) {
      await pool.query('INSERT INTO stress_rw (value) VALUES ($1)', [`row-${i}`]);
    }

    // Create separate pool with higher connection limit for concurrency test
    const concurrentPool = new pg.Pool({ ...TEST_PG_CONFIG, max: CONCURRENT_CONNECTIONS });

    let writeCount = 0;
    let readCount = 0;
    let errorCount = 0;
    const opsPerWorker = Math.ceil(CONCURRENT_OPS / CONCURRENT_CONNECTIONS);

    const workers = Array.from({ length: CONCURRENT_CONNECTIONS }, (_, workerId) =>
      (async () => {
        for (let i = 0; i < opsPerWorker; i++) {
          try {
            if (Math.random() < 0.5) {
              // Write: increment a random row's counter
              const id = Math.floor(Math.random() * 100) + 1;
              await concurrentPool.query(
                'UPDATE stress_rw SET counter = counter + 1 WHERE id = $1',
                [id]
              );
              writeCount++;
            } else {
              // Read: select a random row
              const id = Math.floor(Math.random() * 100) + 1;
              await concurrentPool.query('SELECT * FROM stress_rw WHERE id = $1', [id]);
              readCount++;
            }
          } catch {
            errorCount++;
          }
        }
      })()
    );

    const start = Date.now();
    await Promise.all(workers);
    const elapsed = Date.now() - start;

    await concurrentPool.end();
    await pool.query('DROP TABLE stress_rw');

    const totalOps = writeCount + readCount;
    const qps = Math.round(totalOps / (elapsed / 1000));

    assert.ok(totalOps >= CONCURRENT_OPS * 0.95, `completed ${totalOps}/${CONCURRENT_OPS} ops`);
    assert.ok(errorCount < totalOps * 0.01, `error rate ${errorCount}/${totalOps} < 1%`);
    assert.ok(qps > 0, `throughput: ${qps} ops/sec (${elapsed}ms)`);
  });

  // ── Vector Search Accuracy ──────────────────────────────────────────

  for (const scale of SCALES) {
    QUnit.test(`vector search accuracy: recall@${RECALL_K} at ${(scale / 1000)}K scale (${VECTOR_DIM}d)`, async function (assert) {
      if (!pool) { assert.expect(0); return; }

      await pool.query(`
        CREATE TABLE IF NOT EXISTS stress_vectors (
          id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
          embedding vector(${VECTOR_DIM})
        )
      `);

      // Batch insert clustered vectors (realistic embedding distribution)
      const BATCH_SIZE = 1000;
      const allVectors = []; // Store for brute-force comparison (Float32Arrays are compact)

      for (let batch = 0; batch < scale / BATCH_SIZE; batch++) {
        const values = [];
        const params = [];

        for (let i = 0; i < BATCH_SIZE; i++) {
          const vec = clusteredVector(VECTOR_DIM);
          allVectors.push(vec);
          params.push(`($${i + 1}::vector)`);
          values.push(vectorToString(vec));
        }

        await pool.query(
          `INSERT INTO stress_vectors (embedding) VALUES ${params.join(', ')}`,
          values
        );
      }

      // Create HNSW index
      const indexStart = Date.now();
      await pool.query(`
        CREATE INDEX IF NOT EXISTS idx_stress_hnsw
        ON stress_vectors USING hnsw (embedding vector_cosine_ops)
        WITH (m = 16, ef_construction = 200)
      `);
      const indexTime = Date.now() - indexStart;

      // Use a dedicated client so SET hnsw.ef_search persists across queries
      // (pool rotates connections, losing session-level settings)
      const client = await pool.connect();
      await client.query('SET hnsw.ef_search = 400');

      // Run 10 random query vectors and measure recall
      const NUM_QUERIES = 10;
      let totalRecall = 0;

      for (let q = 0; q < NUM_QUERIES; q++) {
        const queryVec = clusteredVector(VECTOR_DIM);
        const queryStr = vectorToString(queryVec);

        // HNSW search
        const result = await client.query(
          `SELECT id, (embedding <=> $1::vector) AS distance
           FROM stress_vectors
           ORDER BY embedding <=> $1::vector
           LIMIT $2`,
          [queryStr, RECALL_K]
        );
        const hnswIds = new Set(result.rows.map(r => r.id));

        // Brute-force ground truth
        const distances = allVectors.map((vec, idx) => ({
          id: idx + 1, // 1-indexed to match PG IDENTITY
          distance: cosineDistance(queryVec, vec),
        }));
        distances.sort((a, b) => a.distance - b.distance);
        const truthIds = new Set(distances.slice(0, RECALL_K).map(d => d.id));

        // Recall = intersection / k
        let hits = 0;
        for (const id of hnswIds) {
          if (truthIds.has(id)) hits++;
        }
        totalRecall += hits / RECALL_K;
      }

      client.release();
      const avgRecall = totalRecall / NUM_QUERIES;

      // Clean up table for next scale
      await pool.query('DROP TABLE stress_vectors');

      assert.ok(avgRecall >= 0.90, `recall@${RECALL_K} = ${(avgRecall * 100).toFixed(1)}% (>= 90% required)`);
      assert.ok(indexTime > 0, `HNSW index built in ${indexTime}ms for ${scale} vectors`);
    });
  }

  // ── HNSW Index Rebuild Performance ──────────────────────────────────

  QUnit.test('HNSW index rebuild performance', async function (assert) {
    if (!pool) { assert.expect(0); return; }

    const REBUILD_SCALE = 50_000;

    await pool.query(`
      CREATE TABLE IF NOT EXISTS stress_vectors (
        id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        embedding vector(${VECTOR_DIM})
      )
    `);

    // Insert vectors
    const BATCH_SIZE = 1000;
    for (let batch = 0; batch < REBUILD_SCALE / BATCH_SIZE; batch++) {
      const values = [];
      const params = [];
      for (let i = 0; i < BATCH_SIZE; i++) {
        params.push(`($${i + 1}::vector)`);
        values.push(vectorToString(randomVector(VECTOR_DIM)));
      }
      await pool.query(
        `INSERT INTO stress_vectors (embedding) VALUES ${params.join(', ')}`,
        values
      );
    }

    // Build index
    const buildStart = Date.now();
    await pool.query(`
      CREATE INDEX idx_stress_rebuild_hnsw
      ON stress_vectors USING hnsw (embedding vector_cosine_ops)
      WITH (m = 16, ef_construction = 200)
    `);
    const buildTime = Date.now() - buildStart;

    // Drop and rebuild
    await pool.query('DROP INDEX idx_stress_rebuild_hnsw');

    const rebuildStart = Date.now();
    await pool.query(`
      CREATE INDEX idx_stress_rebuild_hnsw
      ON stress_vectors USING hnsw (embedding vector_cosine_ops)
      WITH (m = 16, ef_construction = 200)
    `);
    const rebuildTime = Date.now() - rebuildStart;

    await pool.query('DROP TABLE stress_vectors');

    assert.ok(buildTime > 0, `initial build: ${buildTime}ms for ${REBUILD_SCALE} vectors`);
    assert.ok(rebuildTime > 0, `rebuild: ${rebuildTime}ms for ${REBUILD_SCALE} vectors`);
    // Rebuild should be roughly comparable to initial build (±50%)
    const ratio = rebuildTime / buildTime;
    assert.ok(ratio < 2.0, `rebuild/build ratio: ${ratio.toFixed(2)}x (< 2.0x)`);
  });

  // ── Connection Pool Exhaustion/Recovery ─────────────────────────────

  QUnit.test('connection pool exhaustion and recovery', async function (assert) {
    if (!pool) { assert.expect(0); return; }

    // Create a pool with very limited connections
    const smallPool = new pg.Pool({ ...TEST_PG_CONFIG, max: 3, connectionTimeoutMillis: 5000 });

    await smallPool.query(`
      CREATE TABLE IF NOT EXISTS stress_pool (
        id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        value TEXT
      )
    `);

    // Exhaust pool with long-running queries
    const longQueries = Array.from({ length: 3 }, () =>
      smallPool.query('SELECT pg_sleep(1)')
    );

    // While pool is exhausted, try more queries — they should queue, not fail
    let queuedSucceeded = 0;
    let queuedFailed = 0;

    const queuedQueries = Array.from({ length: 5 }, () =>
      smallPool.query("INSERT INTO stress_pool (value) VALUES ('queued')")
        .then(() => { queuedSucceeded++; })
        .catch(() => { queuedFailed++; })
    );

    // Wait for everything to complete
    await Promise.all([...longQueries, ...queuedQueries]);

    // Verify pool recovered — run a simple query
    const result = await smallPool.query('SELECT COUNT(*) as cnt FROM stress_pool');
    const count = parseInt(result.rows[0].cnt);

    await smallPool.query('DROP TABLE stress_pool');
    await smallPool.end();

    assert.strictEqual(queuedSucceeded, 5, 'all queued queries succeeded after pool freed');
    assert.strictEqual(queuedFailed, 0, 'no queued queries failed');
    assert.strictEqual(count, 5, 'all queued inserts persisted');
  });

  // ── Memory Usage Under Sustained Load ───────────────────────────────

  QUnit.test('memory stability under sustained vector operations (2min soak)', async function (assert) {
    if (!pool) { assert.expect(0); return; }

    await pool.query(`
      CREATE TABLE IF NOT EXISTS stress_vectors (
        id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        embedding vector(${VECTOR_DIM}),
        label VARCHAR(255)
      )
    `);

    // Create HNSW index
    await pool.query(`
      CREATE INDEX idx_stress_soak_hnsw
      ON stress_vectors USING hnsw (embedding vector_cosine_ops)
      WITH (m = 16, ef_construction = 200)
    `);

    const startMemory = process.memoryUsage().heapUsed;
    const startTime = Date.now();
    let insertCount = 0;
    let searchCount = 0;
    let peakMemory = startMemory;

    // Sustained mixed workload: insert + search
    while (Date.now() - startTime < SOAK_DURATION_MS) {
      // Batch insert 100 vectors
      const values = [];
      const params = [];
      for (let i = 0; i < 100; i++) {
        const paramBase = i * 2;
        params.push(`($${paramBase + 1}::vector, $${paramBase + 2})`);
        values.push(vectorToString(randomVector(VECTOR_DIM)), `label-${insertCount + i}`);
      }
      await pool.query(
        `INSERT INTO stress_vectors (embedding, label) VALUES ${params.join(', ')}`,
        values
      );
      insertCount += 100;

      // Run 10 vector searches
      for (let s = 0; s < 10; s++) {
        const queryStr = vectorToString(randomVector(VECTOR_DIM));
        await pool.query(
          `SELECT id, (embedding <=> $1::vector) AS distance
           FROM stress_vectors
           ORDER BY embedding <=> $1::vector
           LIMIT 10`,
          [queryStr]
        );
        searchCount++;
      }

      // Track peak memory
      const currentMemory = process.memoryUsage().heapUsed;
      if (currentMemory > peakMemory) peakMemory = currentMemory;
    }

    const endMemory = process.memoryUsage().heapUsed;
    const memoryGrowthMB = (peakMemory - startMemory) / (1024 * 1024);
    const elapsed = Date.now() - startTime;

    await pool.query('DROP TABLE stress_vectors');

    assert.ok(insertCount > 0, `inserted ${insertCount} vectors in ${(elapsed / 1000).toFixed(0)}s`);
    assert.ok(searchCount > 0, `ran ${searchCount} vector searches`);
    // Memory growth should be bounded — not leaking. Allow up to 200MB growth
    // (Node GC is non-deterministic, so we're generous)
    assert.ok(memoryGrowthMB < 200, `memory growth: ${memoryGrowthMB.toFixed(1)}MB (< 200MB limit)`);
  });
});
