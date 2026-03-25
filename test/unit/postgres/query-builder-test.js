import QUnit from 'qunit';
import { buildInsert, buildUpdate, buildDelete, buildSelect, validateIdentifier } from '../../../src/postgres/query-builder.js';

const { module, test } = QUnit;

module('[Unit] Postgres Query Builder — validateIdentifier', function () {
  test('accepts valid identifiers', function (assert) {
    assert.strictEqual(validateIdentifier('users'), 'users');
    assert.strictEqual(validateIdentifier('user_id'), 'user_id');
    assert.strictEqual(validateIdentifier('access-links'), 'access-links');
  });

  test('rejects invalid identifiers', function (assert) {
    assert.throws(() => validateIdentifier('users; DROP TABLE'), /Invalid SQL identifier/);
    assert.throws(() => validateIdentifier(''), /Invalid SQL identifier/);
    assert.throws(() => validateIdentifier(null), /Invalid SQL identifier/);
    assert.throws(() => validateIdentifier('1users'), /Invalid SQL identifier/);
  });
});

module('[Unit] Postgres Query Builder — buildInsert', function () {
  test('generates parameterized INSERT with $N placeholders and double-quoted identifiers', function (assert) {
    const { sql, values } = buildInsert('users', { name: 'Alice', age: 30 });
    assert.strictEqual(sql, 'INSERT INTO "users" ("name", "age") VALUES ($1, $2)');
    assert.deepEqual(values, ['Alice', 30]);
  });

  test('SQL injection payloads are safely parameterized', function (assert) {
    const { sql, values } = buildInsert('users', { name: "'; DROP TABLE users; --" });
    assert.true(sql.includes('VALUES ($1)'));
    assert.strictEqual(values[0], "'; DROP TABLE users; --");
  });

  test('rejects malicious table names', function (assert) {
    assert.throws(() => buildInsert('users; DROP TABLE users', { name: 'test' }), /Invalid SQL table name/);
  });

  test('rejects malicious column names', function (assert) {
    assert.throws(() => buildInsert('users', { 'name"; --': 'test' }), /Invalid SQL column name/);
  });
});

module('[Unit] Postgres Query Builder — buildUpdate', function () {
  test('generates parameterized UPDATE with $N placeholders', function (assert) {
    const { sql, values } = buildUpdate('users', 1, { name: 'Bob' });
    assert.strictEqual(sql, 'UPDATE "users" SET "name" = $1 WHERE "id" = $2');
    assert.deepEqual(values, ['Bob', 1]);
  });

  test('handles multiple columns', function (assert) {
    const { sql, values } = buildUpdate('users', 5, { name: 'Eve', age: 25 });
    assert.strictEqual(sql, 'UPDATE "users" SET "name" = $1, "age" = $2 WHERE "id" = $3');
    assert.deepEqual(values, ['Eve', 25, 5]);
  });
});

module('[Unit] Postgres Query Builder — buildDelete', function () {
  test('generates parameterized DELETE', function (assert) {
    const { sql, values } = buildDelete('users', 5);
    assert.strictEqual(sql, 'DELETE FROM "users" WHERE "id" = $1');
    assert.deepEqual(values, [5]);
  });
});

module('[Unit] Postgres Query Builder — buildSelect', function () {
  test('generates SELECT * with no conditions', function (assert) {
    const { sql, values } = buildSelect('users');
    assert.strictEqual(sql, 'SELECT * FROM "users"');
    assert.deepEqual(values, []);
  });

  test('generates parameterized WHERE clause with $N placeholders', function (assert) {
    const { sql, values } = buildSelect('users', { name: 'Alice', active: true });
    assert.strictEqual(sql, 'SELECT * FROM "users" WHERE "name" = $1 AND "active" = $2');
    assert.deepEqual(values, ['Alice', true]);
  });
});
