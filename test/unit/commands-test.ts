import QUnit from 'qunit';

const { module, test } = QUnit;

module('[Unit] ORM Commands', function() {
  test('commands module exports correct structure', async function(assert) {
    const { default: commands } = await import('../../src/commands.js');

    assert.ok(commands['db:migrate-to-directory'], 'has db:migrate-to-directory command');
    assert.ok(commands['db:migrate-to-file'], 'has db:migrate-to-file command');
  });

  test('db:migrate-to-directory has required properties', async function(assert) {
    const { default: commands } = await import('../../src/commands.js');
    const cmd = commands['db:migrate-to-directory'];

    assert.equal(typeof cmd.description, 'string', 'has description');
    assert.ok(cmd.description.length > 0, 'description is not empty');
    assert.equal(cmd.bootstrap, true, 'requires bootstrap');
    assert.equal(typeof cmd.run, 'function', 'has run function');
  });

  test('db:migrate-to-file has required properties', async function(assert) {
    const { default: commands } = await import('../../src/commands.js');
    const cmd = commands['db:migrate-to-file'];

    assert.equal(typeof cmd.description, 'string', 'has description');
    assert.ok(cmd.description.length > 0, 'description is not empty');
    assert.equal(cmd.bootstrap, true, 'requires bootstrap');
    assert.equal(typeof cmd.run, 'function', 'has run function');
  });

  test('db:generate-migration has required properties', async function(assert) {
    const { default: commands } = await import('../../src/commands.js');
    const cmd = commands['db:generate-migration'];

    assert.ok(cmd, 'has db:generate-migration command');
    assert.equal(typeof cmd.description, 'string', 'has description');
    assert.ok(cmd.description.length > 0, 'description is not empty');
    assert.equal(cmd.bootstrap, true, 'requires bootstrap');
    assert.equal(typeof cmd.run, 'function', 'has run function');
  });

  test('db:migrate has required properties', async function(assert) {
    const { default: commands } = await import('../../src/commands.js');
    const cmd = commands['db:migrate'];

    assert.ok(cmd, 'has db:migrate command');
    assert.equal(typeof cmd.description, 'string', 'has description');
    assert.ok(cmd.description.length > 0, 'description is not empty');
    assert.equal(cmd.bootstrap, true, 'requires bootstrap');
    assert.equal(typeof cmd.run, 'function', 'has run function');
  });

  test('db:migrate:rollback has required properties', async function(assert) {
    const { default: commands } = await import('../../src/commands.js');
    const cmd = commands['db:migrate:rollback'];

    assert.ok(cmd, 'has db:migrate:rollback command');
    assert.equal(typeof cmd.description, 'string', 'has description');
    assert.ok(cmd.description.length > 0, 'description is not empty');
    assert.equal(cmd.bootstrap, true, 'requires bootstrap');
    assert.equal(typeof cmd.run, 'function', 'has run function');
  });

  test('db:migrate:status has required properties', async function(assert) {
    const { default: commands } = await import('../../src/commands.js');
    const cmd = commands['db:migrate:status'];

    assert.ok(cmd, 'has db:migrate:status command');
    assert.equal(typeof cmd.description, 'string', 'has description');
    assert.ok(cmd.description.length > 0, 'description is not empty');
    assert.equal(cmd.bootstrap, true, 'requires bootstrap');
    assert.equal(typeof cmd.run, 'function', 'has run function');
  });
});
