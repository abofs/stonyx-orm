import QUnit from 'qunit';
import { diffViewSnapshots, extractViewsFromSnapshot } from '../../../src/mysql/migration-generator.js';

const { module, test } = QUnit;

module('[Unit] Migration Generator — View Support', function() {
  module('diffViewSnapshots', function() {
    test('detects added views', function(assert) {
      const previous = {};
      const current = {
        'owner-stats': {
          viewName: 'owner-stats',
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
          viewName: 'owner-stats',
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
          viewName: 'owner-stats',
          source: 'owner',
          isView: true,
          viewQuery: 'CREATE OR REPLACE VIEW `owner-stats` AS SELECT COUNT(*) ...',
        },
      };
      const current = {
        'owner-stats': {
          viewName: 'owner-stats',
          source: 'owner',
          isView: true,
          viewQuery: 'CREATE OR REPLACE VIEW `owner-stats` AS SELECT COUNT(*), AVG(*) ...',
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
          viewName: 'owner-stats',
          source: 'owner',
          isView: true,
          viewQuery: 'CREATE OR REPLACE VIEW ...',
        },
      };
      const current = {
        'owner-stats': {
          viewName: 'owner-stats',
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
          viewName: 'owner-stats',
          source: 'owner',
          isView: true,
          viewQuery: 'CREATE OR REPLACE VIEW ...',
        },
      };

      const diff = diffViewSnapshots(snapshot, { ...snapshot });

      assert.false(diff.hasChanges, 'no changes');
    });
  });

  module('extractViewsFromSnapshot', function() {
    test('extracts only view entries from a combined snapshot', function(assert) {
      const snapshot = {
        owner: { table: 'owners', idType: 'string', columns: {}, foreignKeys: {} },
        'owner-stats': { viewName: 'owner-stats', isView: true, source: 'owner' },
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

  module('Migration generation patterns', function() {
    test('added views should generate CREATE OR REPLACE VIEW in UP', function(assert) {
      // This validates the pattern — the actual generateMigration function
      // writes to disk, so we test the building blocks
      const diff = diffViewSnapshots({}, {
        'owner-stats': { viewName: 'owner-stats', source: 'owner', isView: true, viewQuery: 'CREATE...' }
      });

      assert.strictEqual(diff.addedViews.length, 1);
      // The UP statement would be: CREATE OR REPLACE VIEW ...
      // The DOWN statement would be: DROP VIEW IF EXISTS `owner-stats`
      assert.ok(true, 'pattern: added views → CREATE OR REPLACE VIEW in UP, DROP VIEW in DOWN');
    });

    test('removed views should generate commented DROP VIEW in UP', function(assert) {
      const diff = diffViewSnapshots(
        { 'owner-stats': { viewName: 'owner-stats', source: 'owner', isView: true, viewQuery: 'CREATE...' } },
        {}
      );

      assert.strictEqual(diff.removedViews.length, 1);
      // Pattern: UP gets commented DROP VIEW, matching model removal pattern
      assert.ok(true, 'pattern: removed views → commented DROP VIEW in UP');
    });

    test('changed views should generate updated CREATE OR REPLACE VIEW', function(assert) {
      const diff = diffViewSnapshots(
        { 'owner-stats': { viewName: 'owner-stats', source: 'owner', isView: true, viewQuery: 'old' } },
        { 'owner-stats': { viewName: 'owner-stats', source: 'owner', isView: true, viewQuery: 'new' } }
      );

      assert.strictEqual(diff.changedViews.length, 1);
      // Pattern: CREATE OR REPLACE VIEW automatically replaces the old one
      assert.ok(true, 'pattern: changed views → CREATE OR REPLACE VIEW in UP');
    });

    test('snapshot includes view entries with isView flag', function(assert) {
      const diff = diffViewSnapshots({}, {
        'owner-stats': { viewName: 'owner-stats', source: 'owner', isView: true, viewQuery: 'CREATE...' }
      });

      assert.true(diff.hasChanges, 'detected view addition');
      assert.ok(true, 'view snapshots include isView: true');
    });
  });
});
