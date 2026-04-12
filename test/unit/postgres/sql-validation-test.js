import QUnit from 'qunit';
import { validateInterval, validateAggregate } from '../../../src/timescale/query-builder.js';
import { getVectorType } from '../../../src/postgres/type-map.js';

const { module, test } = QUnit;

module('[Unit] SQL Validation — validateInterval', function () {
  test('accepts valid interval strings', function (assert) {
    assert.strictEqual(validateInterval('7 days'), '7 days');
    assert.strictEqual(validateInterval('1 hour'), '1 hour');
    assert.strictEqual(validateInterval('30 minutes'), '30 minutes');
    assert.strictEqual(validateInterval('1 second'), '1 second');
    assert.strictEqual(validateInterval('12 months'), '12 months');
    assert.strictEqual(validateInterval('1 year'), '1 year');
    assert.strictEqual(validateInterval('500 milliseconds'), '500 milliseconds');
    assert.strictEqual(validateInterval('1 week'), '1 week');
  });

  test('accepts intervals with leading/trailing whitespace', function (assert) {
    assert.strictEqual(validateInterval('  7 days  '), '7 days');
  });

  test('rejects SQL injection in intervals', function (assert) {
    assert.throws(
      () => validateInterval("7 days'; DROP TABLE users; --"),
      /Invalid SQL interval/,
      'SQL injection rejected'
    );
  });

  test('rejects empty or non-string intervals', function (assert) {
    assert.throws(() => validateInterval(''), /Invalid SQL interval/);
    assert.throws(() => validateInterval(null), /Invalid SQL interval/);
    assert.throws(() => validateInterval(undefined), /Invalid SQL interval/);
  });

  test('rejects arbitrary expressions', function (assert) {
    assert.throws(
      () => validateInterval('INTERVAL 7 days'),
      /Invalid SQL interval/,
      'rejects INTERVAL keyword prefix'
    );
    assert.throws(
      () => validateInterval('7'),
      /Invalid SQL interval/,
      'rejects bare number without unit'
    );
  });
});

module('[Unit] SQL Validation — validateAggregate', function () {
  test('accepts valid aggregate expressions', function (assert) {
    assert.strictEqual(validateAggregate('COUNT(value)'), 'COUNT(value)');
    assert.strictEqual(validateAggregate('AVG(temperature) AS avg_temp'), 'AVG(temperature) AS avg_temp');
    assert.strictEqual(validateAggregate('SUM(amount)'), 'SUM(amount)');
    assert.strictEqual(validateAggregate('MIN(price)'), 'MIN(price)');
    assert.strictEqual(validateAggregate('MAX(score)'), 'MAX(score)');
  });

  test('rejects SQL injection in aggregates', function (assert) {
    assert.throws(
      () => validateAggregate('COUNT(*) FROM users; DROP TABLE users; --'),
      /Invalid SQL aggregate/,
      'SQL injection rejected'
    );
  });

  test('rejects arbitrary subqueries', function (assert) {
    assert.throws(
      () => validateAggregate('(SELECT password FROM users LIMIT 1)'),
      /Invalid SQL aggregate/,
      'subquery rejected'
    );
  });

  test('rejects empty or non-string aggregates', function (assert) {
    assert.throws(() => validateAggregate(''), /Invalid SQL aggregate/);
    assert.throws(() => validateAggregate(null), /Invalid SQL aggregate/);
  });
});

module('[Unit] SQL Validation — getVectorType dimensions', function () {
  test('accepts valid dimensions', function (assert) {
    assert.strictEqual(getVectorType(3), 'vector(3)');
    assert.strictEqual(getVectorType(1536), 'vector(1536)');
    assert.strictEqual(getVectorType(1), 'vector(1)');
    assert.strictEqual(getVectorType(16000), 'vector(16000)');
  });

  test('rejects zero dimensions', function (assert) {
    assert.throws(() => getVectorType(0), /Invalid vector dimensions/);
  });

  test('rejects negative dimensions', function (assert) {
    assert.throws(() => getVectorType(-1), /Invalid vector dimensions/);
  });

  test('rejects dimensions exceeding limit', function (assert) {
    assert.throws(() => getVectorType(16001), /Invalid vector dimensions/);
  });

  test('rejects non-integer dimensions', function (assert) {
    assert.throws(() => getVectorType(3.14), /Invalid vector dimensions/);
  });
});
