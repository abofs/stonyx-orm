import QUnit from 'qunit';
import { buildInsert, buildUpdate, buildDelete, buildSelect, buildVectorSearch, buildHybridSearch, validateIdentifier } from '../../../src/postgres/query-builder.js';

const { module, test } = QUnit;

module('[Unit] Postgres Query Builder — validateIdentifier', function() {

  test('accepts valid simple identifiers', function(assert) {
    assert.strictEqual(validateIdentifier('users'), 'users');
    assert.strictEqual(validateIdentifier('user_id'), 'user_id');
    assert.strictEqual(validateIdentifier('_private'), '_private');
    assert.strictEqual(validateIdentifier('Table1'), 'Table1');
  });

  test('accepts hyphenated identifiers (e.g. access-links)', function(assert) {
    assert.strictEqual(validateIdentifier('access-links'), 'access-links');
    assert.strictEqual(validateIdentifier('phone-numbers'), 'phone-numbers');
  });

  test('rejects identifiers with double quotes', function(assert) {
    assert.throws(
      () => validateIdentifier('users"; DROP TABLE users; --'),
      /Invalid SQL identifier/,
      'double-quote injection rejected'
    );
  });

  test('rejects identifiers with spaces', function(assert) {
    assert.throws(
      () => validateIdentifier('users; DROP TABLE'),
      /Invalid SQL identifier/,
      'space injection rejected'
    );
  });

  test('rejects identifiers with SQL comment syntax', function(assert) {
    assert.throws(
      () => validateIdentifier('users" -- '),
      /Invalid SQL identifier/,
      'double-quote + comment injection rejected'
    );
    assert.throws(
      () => validateIdentifier('users/* */'),
      /Invalid SQL identifier/,
      'block comment injection rejected'
    );
  });

  test('rejects identifiers starting with numbers', function(assert) {
    assert.throws(
      () => validateIdentifier('1users'),
      /Invalid SQL identifier/,
      'leading number rejected'
    );
  });

  test('rejects empty and non-string identifiers', function(assert) {
    assert.throws(() => validateIdentifier(''), /Invalid SQL identifier/);
    assert.throws(() => validateIdentifier(null), /Invalid SQL identifier/);
    assert.throws(() => validateIdentifier(undefined), /Invalid SQL identifier/);
    assert.throws(() => validateIdentifier(123), /Invalid SQL identifier/);
  });

  test('rejects identifiers with parentheses', function(assert) {
    assert.throws(
      () => validateIdentifier('users()'),
      /Invalid SQL identifier/,
      'parentheses rejected'
    );
  });

  test('rejects identifiers with semicolons', function(assert) {
    assert.throws(
      () => validateIdentifier('users;'),
      /Invalid SQL identifier/,
      'semicolon rejected'
    );
  });
});

module('[Unit] Postgres Query Builder — buildInsert', function() {

  test('generates parameterized INSERT with $N placeholders and RETURNING', function(assert) {
    const { sql, values } = buildInsert('users', { name: 'Alice', age: 30 });

    assert.strictEqual(sql, 'INSERT INTO "users" ("name", "age") VALUES ($1, $2) RETURNING "id"');
    assert.deepEqual(values, ['Alice', 30]);
  });

  test('values with SQL injection payloads are safely parameterized', function(assert) {
    const { sql, values } = buildInsert('users', {
      name: "'; DROP TABLE users; --",
      email: '1 OR 1=1',
    });

    assert.true(sql.includes('VALUES ($1, $2)'), 'uses placeholders, not interpolated values');
    assert.strictEqual(values[0], "'; DROP TABLE users; --", 'malicious value is passed as parameter');
    assert.strictEqual(values[1], '1 OR 1=1', 'tautology value is passed as parameter');
  });

  test('rejects malicious table names', function(assert) {
    assert.throws(
      () => buildInsert('users; DROP TABLE users', { name: 'test' }),
      /Invalid SQL table name/,
    );
  });

  test('rejects malicious column names', function(assert) {
    assert.throws(
      () => buildInsert('users', { 'name"; --': 'test' }),
      /Invalid SQL column name/,
    );
  });
});

module('[Unit] Postgres Query Builder — buildUpdate', function() {

  test('generates parameterized UPDATE with $N placeholders', function(assert) {
    const { sql, values } = buildUpdate('users', 1, { name: 'Bob' });

    assert.strictEqual(sql, 'UPDATE "users" SET "name" = $1 WHERE "id" = $2');
    assert.deepEqual(values, ['Bob', 1]);
  });

  test('values with SQL injection payloads are safely parameterized', function(assert) {
    const { sql, values } = buildUpdate('users', '1 OR 1=1', {
      name: "' OR '1'='1",
    });

    assert.true(sql.includes('SET "name" = $1 WHERE "id" = $2'), 'uses placeholders');
    assert.strictEqual(values[0], "' OR '1'='1", 'malicious value is a parameter');
    assert.strictEqual(values[1], '1 OR 1=1', 'malicious id is a parameter');
  });

  test('rejects malicious table names', function(assert) {
    assert.throws(
      () => buildUpdate('users"--', 1, { name: 'test' }),
      /Invalid SQL table name/,
    );
  });
});

module('[Unit] Postgres Query Builder — buildDelete', function() {

  test('generates parameterized DELETE with $1', function(assert) {
    const { sql, values } = buildDelete('users', 5);

    assert.strictEqual(sql, 'DELETE FROM "users" WHERE "id" = $1');
    assert.deepEqual(values, [5]);
  });

  test('id values are parameterized, not interpolated', function(assert) {
    const { sql, values } = buildDelete('users', '1; DROP TABLE users');

    assert.strictEqual(sql, 'DELETE FROM "users" WHERE "id" = $1');
    assert.strictEqual(values[0], '1; DROP TABLE users', 'malicious id is a parameter');
  });

  test('rejects malicious table names', function(assert) {
    assert.throws(
      () => buildDelete('users; --', 1),
      /Invalid SQL table name/,
    );
  });
});

module('[Unit] Postgres Query Builder — buildSelect', function() {

  test('generates SELECT * with no conditions', function(assert) {
    const { sql, values } = buildSelect('users');

    assert.strictEqual(sql, 'SELECT * FROM "users"');
    assert.deepEqual(values, []);
  });

  test('generates parameterized WHERE clause with $N', function(assert) {
    const { sql, values } = buildSelect('users', { name: 'Alice', active: true });

    assert.strictEqual(sql, 'SELECT * FROM "users" WHERE "name" = $1 AND "active" = $2');
    assert.deepEqual(values, ['Alice', true]);
  });

  test('condition values with SQL injection payloads are safely parameterized', function(assert) {
    const { sql, values } = buildSelect('users', { name: "' OR '1'='1" });

    assert.true(sql.includes('WHERE "name" = $1'), 'uses placeholder');
    assert.strictEqual(values[0], "' OR '1'='1", 'malicious value is a parameter');
  });

  test('rejects malicious condition column names', function(assert) {
    assert.throws(
      () => buildSelect('users', { '1=1; --': 'test' }),
      /Invalid SQL column name/,
    );
  });
});

module('[Unit] Postgres Query Builder — buildVectorSearch', function() {

  test('generates vector similarity search with cosine distance', function(assert) {
    const queryVector = [0.1, 0.2, 0.3];
    const { sql, values } = buildVectorSearch('documents', 'embedding', queryVector);

    assert.true(sql.includes('FROM "documents"'), 'targets correct table');
    assert.true(sql.includes('"embedding" <=>'), 'uses cosine distance operator');
    assert.true(sql.includes('AS distance'), 'aliases distance column');
    assert.true(sql.includes('ORDER BY'), 'orders by distance');
    assert.true(sql.includes('LIMIT'), 'includes limit');
    assert.strictEqual(values[0], '[0.1,0.2,0.3]', 'vector formatted as string array');
  });

  test('applies default limit of 10', function(assert) {
    const { values } = buildVectorSearch('documents', 'embedding', [0.1]);

    assert.strictEqual(values[values.length - 1], 10, 'default limit is 10');
  });

  test('respects custom limit', function(assert) {
    const { values } = buildVectorSearch('documents', 'embedding', [0.1], { limit: 5 });

    assert.strictEqual(values[values.length - 1], 5, 'custom limit applied');
  });

  test('includes WHERE conditions', function(assert) {
    const { sql, values } = buildVectorSearch('documents', 'embedding', [0.1], {
      where: { category: 'tech' }
    });

    assert.true(sql.includes('WHERE "category" = $2'), 'includes WHERE clause');
    assert.true(values.includes('tech'), 'condition value parameterized');
  });

  test('validates table and column identifiers', function(assert) {
    assert.throws(
      () => buildVectorSearch('users; --', 'embedding', [0.1]),
      /Invalid SQL table name/,
    );
    assert.throws(
      () => buildVectorSearch('documents', 'col; --', [0.1]),
      /Invalid SQL column name/,
    );
  });
});

module('[Unit] Postgres Query Builder — buildHybridSearch', function() {

  test('generates hybrid search with vector + text filtering', function(assert) {
    const queryVector = [0.1, 0.2, 0.3];
    const { sql, values } = buildHybridSearch('documents', 'embedding', queryVector, 'title', 'search term');

    assert.true(sql.includes('FROM "documents"'), 'targets correct table');
    assert.true(sql.includes('"embedding" <=>'), 'uses cosine distance operator');
    assert.true(sql.includes('"title" ILIKE'), 'includes ILIKE text filter');
    assert.true(sql.includes('ORDER BY'), 'orders by distance');
    assert.strictEqual(values[0], '[0.1,0.2,0.3]', 'vector formatted as string');
    assert.strictEqual(values[1], '%search term%', 'text query wrapped in % wildcards');
  });

  test('applies default limit of 10', function(assert) {
    const { values } = buildHybridSearch('documents', 'embedding', [0.1], 'title', 'test');

    assert.strictEqual(values[values.length - 1], 10, 'default limit is 10');
  });

  test('respects custom limit', function(assert) {
    const { values } = buildHybridSearch('documents', 'embedding', [0.1], 'title', 'test', { limit: 3 });

    assert.strictEqual(values[values.length - 1], 3, 'custom limit applied');
  });

  test('includes additional WHERE conditions', function(assert) {
    const { sql, values } = buildHybridSearch('documents', 'embedding', [0.1], 'title', 'test', {
      where: { status: 'published' }
    });

    assert.true(sql.includes('"status" = $3'), 'includes extra WHERE condition');
    assert.true(values.includes('published'), 'extra condition value parameterized');
  });

  test('validates all identifiers', function(assert) {
    assert.throws(
      () => buildHybridSearch('bad table', 'embedding', [0.1], 'title', 'test'),
      /Invalid SQL table name/,
    );
    assert.throws(
      () => buildHybridSearch('docs', 'bad col', [0.1], 'title', 'test'),
      /Invalid SQL column name/,
    );
    assert.throws(
      () => buildHybridSearch('docs', 'embedding', [0.1], 'bad col', 'test'),
      /Invalid SQL column name/,
    );
  });
});
