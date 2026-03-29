import QUnit from 'qunit';
import commands from '../../src/commands.js';

const { module, test } = QUnit;

module('[Unit] Commands — Adapter Dispatch', function () {
  test('db:migrate command object exists', function (assert) {
    assert.ok(commands['db:migrate'], 'db:migrate command exists');
    assert.strictEqual(typeof commands['db:migrate'].run, 'function', 'has run function');
  });

  test('db:generate-migration command object exists', function (assert) {
    assert.ok(commands['db:generate-migration'], 'command exists');
    assert.strictEqual(typeof commands['db:generate-migration'].run, 'function', 'has run function');
  });

  test('db:migrate:rollback command object exists', function (assert) {
    assert.ok(commands['db:migrate:rollback'], 'command exists');
    assert.strictEqual(typeof commands['db:migrate:rollback'].run, 'function', 'has run function');
  });

  test('db:migrate:status command object exists', function (assert) {
    assert.ok(commands['db:migrate:status'], 'command exists');
    assert.strictEqual(typeof commands['db:migrate:status'].run, 'function', 'has run function');
  });

  test('command descriptions do not reference MySQL specifically', function (assert) {
    for (const [name, cmd] of Object.entries(commands)) {
      if (name.startsWith('db:') && name !== 'db:migrate-to-directory' && name !== 'db:migrate-to-file') {
        assert.false(
          cmd.description.includes('MySQL'),
          `${name} description should not reference MySQL: "${cmd.description}"`
        );
      }
    }
  });
});
