import QUnit from 'qunit';
import { buildInsert, buildUpdate, buildDelete, buildSelect, validateIdentifier } from '../../../src/mysql/query-builder.js';

const { module, test } = QUnit;

module('[Unit] Query Builder — validateIdentifier', function() {

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

  test('rejects identifiers with backticks', function(assert) {
    assert.throws(
      () => validateIdentifier('users`; DROP TABLE users; --'),
      /Invalid SQL identifier/,
      'backtick injection rejected'
    );
  });

  test('rejects identifiers with spaces', function(assert) {
    assert.throws(
      () => validateIdentifier('users; DROP TABLE'),
      /Invalid SQL identifier/,
      'space injection rejected'
    );
  });

  test('rejects identifiers with SQL comment syntax in injection attempts', function(assert) {
    assert.throws(
      () => validateIdentifier('users` -- '),
      /Invalid SQL identifier/,
      'backtick + comment injection rejected'
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

module('[Unit] Query Builder — buildInsert', function() {

  test('generates parameterized INSERT with placeholders', function(assert) {
    const { sql, values } = buildInsert('users', { name: 'Alice', age: 30 });

    assert.strictEqual(sql, 'INSERT INTO `users` (`name`, `age`) VALUES (?, ?)');
    assert.deepEqual(values, ['Alice', 30]);
  });

  test('values with SQL injection payloads are safely parameterized', function(assert) {
    const { sql, values } = buildInsert('users', {
      name: "'; DROP TABLE users; --",
      email: '1 OR 1=1',
    });

    assert.true(sql.includes('VALUES (?, ?)'), 'uses placeholders, not interpolated values');
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
      () => buildInsert('users', { 'name`; --': 'test' }),
      /Invalid SQL column name/,
    );
  });
});

module('[Unit] Query Builder — buildUpdate', function() {

  test('generates parameterized UPDATE', function(assert) {
    const { sql, values } = buildUpdate('users', 1, { name: 'Bob' });

    assert.strictEqual(sql, 'UPDATE `users` SET `name` = ? WHERE `id` = ?');
    assert.deepEqual(values, ['Bob', 1]);
  });

  test('values with SQL injection payloads are safely parameterized', function(assert) {
    const { sql, values } = buildUpdate('users', '1 OR 1=1', {
      name: "' OR '1'='1",
    });

    assert.true(sql.includes('SET `name` = ? WHERE `id` = ?'), 'uses placeholders');
    assert.strictEqual(values[0], "' OR '1'='1", 'malicious value is a parameter');
    assert.strictEqual(values[1], '1 OR 1=1', 'malicious id is a parameter');
  });

  test('rejects malicious table names', function(assert) {
    assert.throws(
      () => buildUpdate('users`--', 1, { name: 'test' }),
      /Invalid SQL table name/,
    );
  });
});

module('[Unit] Query Builder — buildDelete', function() {

  test('generates parameterized DELETE', function(assert) {
    const { sql, values } = buildDelete('users', 5);

    assert.strictEqual(sql, 'DELETE FROM `users` WHERE `id` = ?');
    assert.deepEqual(values, [5]);
  });

  test('id values are parameterized, not interpolated', function(assert) {
    const { sql, values } = buildDelete('users', '1; DROP TABLE users');

    assert.strictEqual(sql, 'DELETE FROM `users` WHERE `id` = ?');
    assert.strictEqual(values[0], '1; DROP TABLE users', 'malicious id is a parameter');
  });

  test('rejects malicious table names', function(assert) {
    assert.throws(
      () => buildDelete('users; --', 1),
      /Invalid SQL table name/,
    );
  });
});

module('[Unit] Query Builder — buildSelect', function() {

  test('generates SELECT * with no conditions', function(assert) {
    const { sql, values } = buildSelect('users');

    assert.strictEqual(sql, 'SELECT * FROM `users`');
    assert.deepEqual(values, []);
  });

  test('generates parameterized WHERE clause', function(assert) {
    const { sql, values } = buildSelect('users', { name: 'Alice', active: true });

    assert.strictEqual(sql, 'SELECT * FROM `users` WHERE `name` = ? AND `active` = ?');
    assert.deepEqual(values, ['Alice', true]);
  });

  test('condition values with SQL injection payloads are safely parameterized', function(assert) {
    const { sql, values } = buildSelect('users', { name: "' OR '1'='1" });

    assert.true(sql.includes('WHERE `name` = ?'), 'uses placeholder');
    assert.strictEqual(values[0], "' OR '1'='1", 'malicious value is a parameter');
  });

  test('rejects malicious condition column names', function(assert) {
    assert.throws(
      () => buildSelect('users', { '1=1; --': 'test' }),
      /Invalid SQL column name/,
    );
  });
});
