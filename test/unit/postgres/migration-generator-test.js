import QUnit from 'qunit';
import { diffSnapshots } from '../../../src/postgres/migration-generator.js';

const { module, test } = QUnit;

module('[Unit] Postgres Migration Generator — diffSnapshots', function () {
  test('detects added models', function (assert) {
    const current = {
      user: { table: 'users', idType: 'string', columns: { name: 'VARCHAR(255)' }, foreignKeys: {} },
    };
    const diff = diffSnapshots({}, current);
    assert.true(diff.hasChanges);
    assert.deepEqual(diff.addedModels, ['user']);
  });

  test('detects removed models', function (assert) {
    const previous = {
      user: { table: 'users', idType: 'string', columns: {}, foreignKeys: {} },
    };
    const diff = diffSnapshots(previous, {});
    assert.true(diff.hasChanges);
    assert.deepEqual(diff.removedModels, ['user']);
  });

  test('detects added columns', function (assert) {
    const previous = { user: { table: 'users', columns: { name: 'VARCHAR(255)' }, foreignKeys: {} } };
    const current = { user: { table: 'users', columns: { name: 'VARCHAR(255)', email: 'VARCHAR(255)' }, foreignKeys: {} } };
    const diff = diffSnapshots(previous, current);
    assert.true(diff.hasChanges);
    assert.strictEqual(diff.addedColumns.length, 1);
    assert.strictEqual(diff.addedColumns[0].column, 'email');
  });

  test('detects changed column types', function (assert) {
    const previous = { user: { table: 'users', columns: { score: 'INTEGER' }, foreignKeys: {} } };
    const current = { user: { table: 'users', columns: { score: 'DOUBLE PRECISION' }, foreignKeys: {} } };
    const diff = diffSnapshots(previous, current);
    assert.true(diff.hasChanges);
    assert.strictEqual(diff.changedColumns[0].from, 'INTEGER');
    assert.strictEqual(diff.changedColumns[0].to, 'DOUBLE PRECISION');
  });

  test('no changes returns hasChanges: false', function (assert) {
    const snapshot = { user: { table: 'users', columns: { name: 'VARCHAR(255)' }, foreignKeys: {} } };
    const diff = diffSnapshots(snapshot, snapshot);
    assert.false(diff.hasChanges);
  });

  test('snapshot includes timeSeries and compression fields', function (assert) {
    const current = {
      event: {
        table: 'events', idType: 'number',
        columns: { timestamp: 'TIMESTAMPTZ' }, foreignKeys: {},
        timeSeries: 'timestamp', compression: { after: '7d' },
      },
    };
    const diff = diffSnapshots({}, current);
    assert.true(diff.hasChanges);
    assert.deepEqual(diff.addedModels, ['event']);
  });
});
