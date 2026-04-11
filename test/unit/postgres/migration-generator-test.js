import QUnit from 'qunit';
import { diffSnapshots, extractViewsFromSnapshot, diffViewSnapshots } from '../../../src/postgres/migration-generator.js';

const { module, test } = QUnit;

module('[Unit] Postgres Migration Generator — diffSnapshots', function() {

  test('detects added models', function(assert) {
    const previous = {};
    const current = {
      user: { table: 'users', idType: 'string', columns: { name: 'VARCHAR(255)' }, foreignKeys: {} },
    };

    const diff = diffSnapshots(previous, current);

    assert.true(diff.hasChanges, 'has changes');
    assert.strictEqual(diff.addedModels.length, 1, 'one added model');
    assert.strictEqual(diff.addedModels[0], 'user', 'correct model name');
  });

  test('detects removed models', function(assert) {
    const previous = {
      user: { table: 'users', idType: 'string', columns: {}, foreignKeys: {} },
    };
    const current = {};

    const diff = diffSnapshots(previous, current);

    assert.true(diff.hasChanges, 'has changes');
    assert.strictEqual(diff.removedModels.length, 1, 'one removed model');
    assert.strictEqual(diff.removedModels[0], 'user', 'correct model name');
  });

  test('detects added columns', function(assert) {
    const previous = {
      user: { table: 'users', idType: 'string', columns: { name: 'VARCHAR(255)' }, foreignKeys: {} },
    };
    const current = {
      user: { table: 'users', idType: 'string', columns: { name: 'VARCHAR(255)', email: 'VARCHAR(255)' }, foreignKeys: {} },
    };

    const diff = diffSnapshots(previous, current);

    assert.true(diff.hasChanges, 'has changes');
    assert.strictEqual(diff.addedColumns.length, 1, 'one added column');
    assert.strictEqual(diff.addedColumns[0].column, 'email', 'correct column name');
    assert.strictEqual(diff.addedColumns[0].type, 'VARCHAR(255)', 'correct column type');
  });

  test('detects removed columns', function(assert) {
    const previous = {
      user: { table: 'users', idType: 'string', columns: { name: 'VARCHAR(255)', email: 'VARCHAR(255)' }, foreignKeys: {} },
    };
    const current = {
      user: { table: 'users', idType: 'string', columns: { name: 'VARCHAR(255)' }, foreignKeys: {} },
    };

    const diff = diffSnapshots(previous, current);

    assert.true(diff.hasChanges, 'has changes');
    assert.strictEqual(diff.removedColumns.length, 1, 'one removed column');
    assert.strictEqual(diff.removedColumns[0].column, 'email', 'correct column name');
  });

  test('detects changed column types', function(assert) {
    const previous = {
      user: { table: 'users', idType: 'string', columns: { age: 'INTEGER' }, foreignKeys: {} },
    };
    const current = {
      user: { table: 'users', idType: 'string', columns: { age: 'BIGINT' }, foreignKeys: {} },
    };

    const diff = diffSnapshots(previous, current);

    assert.true(diff.hasChanges, 'has changes');
    assert.strictEqual(diff.changedColumns.length, 1, 'one changed column');
    assert.strictEqual(diff.changedColumns[0].from, 'INTEGER', 'correct from type');
    assert.strictEqual(diff.changedColumns[0].to, 'BIGINT', 'correct to type');
  });

  test('detects added foreign keys', function(assert) {
    const previous = {
      book: { table: 'books', idType: 'number', columns: { title: 'VARCHAR(255)' }, foreignKeys: {} },
    };
    const current = {
      book: { table: 'books', idType: 'number', columns: { title: 'VARCHAR(255)' }, foreignKeys: { author_id: { references: 'authors', column: 'id' } } },
    };

    const diff = diffSnapshots(previous, current);

    assert.true(diff.hasChanges, 'has changes');
    assert.strictEqual(diff.addedForeignKeys.length, 1, 'one added FK');
    assert.strictEqual(diff.addedForeignKeys[0].column, 'author_id', 'correct FK column');
  });

  test('detects removed foreign keys', function(assert) {
    const previous = {
      book: { table: 'books', idType: 'number', columns: {}, foreignKeys: { author_id: { references: 'authors', column: 'id' } } },
    };
    const current = {
      book: { table: 'books', idType: 'number', columns: {}, foreignKeys: {} },
    };

    const diff = diffSnapshots(previous, current);

    assert.true(diff.hasChanges, 'has changes');
    assert.strictEqual(diff.removedForeignKeys.length, 1, 'one removed FK');
    assert.strictEqual(diff.removedForeignKeys[0].column, 'author_id', 'correct FK column');
  });

  test('no changes when snapshots match', function(assert) {
    const snapshot = {
      user: { table: 'users', idType: 'string', columns: { name: 'VARCHAR(255)' }, foreignKeys: {} },
    };

    const diff = diffSnapshots(snapshot, { ...snapshot });

    assert.false(diff.hasChanges, 'no changes');
    assert.strictEqual(diff.addedModels.length, 0);
    assert.strictEqual(diff.removedModels.length, 0);
    assert.strictEqual(diff.addedColumns.length, 0);
    assert.strictEqual(diff.removedColumns.length, 0);
    assert.strictEqual(diff.changedColumns.length, 0);
  });
});

module('[Unit] Postgres Migration Generator — extractViewsFromSnapshot', function() {

  test('extracts only view entries from a combined snapshot', function(assert) {
    const snapshot = {
      owner: { table: 'owners', idType: 'string', columns: {}, foreignKeys: {} },
      'owner-stats': { viewName: 'owner_stats', isView: true, source: 'owner' },
      animal: { table: 'animals', idType: 'number', columns: {}, foreignKeys: {} },
    };

    const views = extractViewsFromSnapshot(snapshot);

    assert.strictEqual(Object.keys(views).length, 1, 'only one view extracted');
    assert.ok(views['owner-stats'], 'view entry exists');
    assert.notOk(views['owner'], 'model not included');
    assert.notOk(views['animal'], 'model not included');
  });

  test('returns empty object when no views in snapshot', function(assert) {
    const snapshot = {
      owner: { table: 'owners', idType: 'string', columns: {}, foreignKeys: {} },
    };

    const views = extractViewsFromSnapshot(snapshot);
    assert.strictEqual(Object.keys(views).length, 0, 'no views extracted');
  });
});

module('[Unit] Postgres Migration Generator — diffViewSnapshots', function() {

  test('detects added views', function(assert) {
    const previous = {};
    const current = {
      'owner-stats': {
        viewName: 'owner_stats',
        source: 'owner',
        isView: true,
        viewQuery: 'CREATE OR REPLACE VIEW ...',
      },
    };

    const diff = diffViewSnapshots(previous, current);

    assert.true(diff.hasChanges, 'has changes');
    assert.strictEqual(diff.addedViews.length, 1, 'one added view');
    assert.strictEqual(diff.addedViews[0], 'owner-stats', 'correct view name');
  });

  test('detects removed views', function(assert) {
    const previous = {
      'owner-stats': {
        viewName: 'owner_stats',
        source: 'owner',
        isView: true,
        viewQuery: 'CREATE OR REPLACE VIEW ...',
      },
    };
    const current = {};

    const diff = diffViewSnapshots(previous, current);

    assert.true(diff.hasChanges, 'has changes');
    assert.strictEqual(diff.removedViews.length, 1, 'one removed view');
    assert.strictEqual(diff.removedViews[0], 'owner-stats', 'correct view name');
  });

  test('detects changed views (viewQuery changed)', function(assert) {
    const previous = {
      'owner-stats': {
        viewName: 'owner_stats',
        source: 'owner',
        isView: true,
        viewQuery: 'CREATE OR REPLACE VIEW "owner_stats" AS SELECT COUNT(*) ...',
      },
    };
    const current = {
      'owner-stats': {
        viewName: 'owner_stats',
        source: 'owner',
        isView: true,
        viewQuery: 'CREATE OR REPLACE VIEW "owner_stats" AS SELECT COUNT(*), AVG(*) ...',
      },
    };

    const diff = diffViewSnapshots(previous, current);

    assert.true(diff.hasChanges, 'has changes');
    assert.strictEqual(diff.changedViews.length, 1, 'one changed view');
    assert.strictEqual(diff.changedViews[0], 'owner-stats', 'correct view name');
  });

  test('detects changed views (source changed)', function(assert) {
    const previous = {
      'owner-stats': {
        viewName: 'owner_stats',
        source: 'owner',
        isView: true,
        viewQuery: 'CREATE OR REPLACE VIEW ...',
      },
    };
    const current = {
      'owner-stats': {
        viewName: 'owner_stats',
        source: 'user',
        isView: true,
        viewQuery: 'CREATE OR REPLACE VIEW ...',
      },
    };

    const diff = diffViewSnapshots(previous, current);

    assert.true(diff.hasChanges, 'has changes');
    assert.strictEqual(diff.changedViews.length, 1, 'one changed view');
  });

  test('no changes when snapshots match', function(assert) {
    const snapshot = {
      'owner-stats': {
        viewName: 'owner_stats',
        source: 'owner',
        isView: true,
        viewQuery: 'CREATE OR REPLACE VIEW ...',
      },
    };

    const diff = diffViewSnapshots(snapshot, { ...snapshot });

    assert.false(diff.hasChanges, 'no changes');
  });
});
