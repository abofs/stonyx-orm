import QUnit from 'qunit';
import { pool } from '../../helpers/postgres-test-helper.js';

const { module, test } = QUnit;

module('[Integration] Postgres CRUD', function () {
  test('INSERT with RETURNING id works', async function (assert) {
    if (!pool) { assert.expect(0); return; }

    await pool.query(`
      CREATE TABLE IF NOT EXISTS "__pg_test_crud" (
        "id" INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        "name" VARCHAR(255)
      )
    `);

    try {
      const result = await pool.query(
        'INSERT INTO "__pg_test_crud" ("name") VALUES ($1) RETURNING id',
        ['Alice']
      );
      assert.strictEqual(typeof result.rows[0].id, 'number', 'RETURNING id returns a number');
      assert.true(result.rows[0].id > 0, 'auto-generated ID is positive');

      const selectResult = await pool.query('SELECT * FROM "__pg_test_crud" WHERE "id" = $1', [result.rows[0].id]);
      assert.strictEqual(selectResult.rows[0].name, 'Alice');
    } finally {
      await pool.query('DROP TABLE IF EXISTS "__pg_test_crud"');
    }
  });

  test('UPDATE works', async function (assert) {
    if (!pool) { assert.expect(0); return; }

    await pool.query(`
      CREATE TABLE IF NOT EXISTS "__pg_test_crud" (
        "id" INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        "name" VARCHAR(255)
      )
    `);

    try {
      const ins = await pool.query('INSERT INTO "__pg_test_crud" ("name") VALUES ($1) RETURNING id', ['Bob']);
      const id = ins.rows[0].id;

      await pool.query('UPDATE "__pg_test_crud" SET "name" = $1 WHERE "id" = $2', ['Charlie', id]);

      const result = await pool.query('SELECT * FROM "__pg_test_crud" WHERE "id" = $1', [id]);
      assert.strictEqual(result.rows[0].name, 'Charlie');
    } finally {
      await pool.query('DROP TABLE IF EXISTS "__pg_test_crud"');
    }
  });

  test('DELETE works', async function (assert) {
    if (!pool) { assert.expect(0); return; }

    await pool.query(`
      CREATE TABLE IF NOT EXISTS "__pg_test_crud" (
        "id" INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        "name" VARCHAR(255)
      )
    `);

    try {
      const ins = await pool.query('INSERT INTO "__pg_test_crud" ("name") VALUES ($1) RETURNING id', ['Dave']);
      const id = ins.rows[0].id;

      await pool.query('DELETE FROM "__pg_test_crud" WHERE "id" = $1', [id]);

      const result = await pool.query('SELECT * FROM "__pg_test_crud" WHERE "id" = $1', [id]);
      assert.strictEqual(result.rows.length, 0);
    } finally {
      await pool.query('DROP TABLE IF EXISTS "__pg_test_crud"');
    }
  });
});
