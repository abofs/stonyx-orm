import QUnit from 'qunit';
import sinon from 'sinon';

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

  test('db:sync command exists and has required properties', async function(assert) {
    const { default: commands } = await import('../../src/commands.js');
    const cmd = commands['db:sync'];

    assert.ok(cmd, 'has db:sync command');
    assert.equal(typeof cmd.description, 'string', 'has description');
    assert.ok(cmd.description.length > 0, 'description is not empty');
    assert.equal(cmd.bootstrap, true, 'requires bootstrap');
    assert.equal(typeof cmd.run, 'function', 'has run function');
    assert.ok(cmd.description.toLowerCase().includes('dynamodb'), 'description mentions DynamoDB');
  });
});

module('[Unit] ORM Commands — DynamoDB branching', function(hooks) {
  let logStub: sinon.SinonStub;
  let errorStub: sinon.SinonStub;

  hooks.beforeEach(function() {
    logStub = sinon.stub(console, 'log');
    errorStub = sinon.stub(console, 'error');
  });

  hooks.afterEach(function() {
    sinon.restore();
  });

  test('db:generate-migration prints DynamoDB message when dynamodb config present', async function(assert) {
    // Stub stonyx/config to simulate DynamoDB mode
    const configModule = await import('stonyx/config');
    const originalOrm = (configModule.default as Record<string, unknown>).orm;
    (configModule.default as Record<string, unknown>).orm = { dynamodb: { region: 'us-east-1' } };

    try {
      const { default: commands } = await import('../../src/commands.js');
      await commands['db:generate-migration']!.run([]);

      assert.ok(logStub.calledOnce, 'console.log called once');
      assert.ok(logStub.firstCall.args[0].includes('DynamoDB'), 'message mentions DynamoDB');
      assert.ok(logStub.firstCall.args[0].includes('db:sync'), 'message mentions db:sync');
    } finally {
      (configModule.default as Record<string, unknown>).orm = originalOrm;
    }
  });

  test('db:migrate prints DynamoDB message when dynamodb config present', async function(assert) {
    const configModule = await import('stonyx/config');
    const originalOrm = (configModule.default as Record<string, unknown>).orm;
    (configModule.default as Record<string, unknown>).orm = { dynamodb: { region: 'us-east-1' } };

    try {
      const { default: commands } = await import('../../src/commands.js');
      await commands['db:migrate']!.run([]);

      assert.ok(logStub.calledOnce, 'console.log called once');
      assert.ok(logStub.firstCall.args[0].includes('DynamoDB'), 'message mentions DynamoDB');
    } finally {
      (configModule.default as Record<string, unknown>).orm = originalOrm;
    }
  });

  test('db:migrate:rollback prints DynamoDB message when dynamodb config present', async function(assert) {
    const configModule = await import('stonyx/config');
    const originalOrm = (configModule.default as Record<string, unknown>).orm;
    (configModule.default as Record<string, unknown>).orm = { dynamodb: { region: 'us-east-1' } };

    try {
      const { default: commands } = await import('../../src/commands.js');
      await commands['db:migrate:rollback']!.run([]);

      assert.ok(logStub.calledOnce, 'console.log called once');
      assert.ok(logStub.firstCall.args[0].includes('DynamoDB'), 'message mentions DynamoDB');
    } finally {
      (configModule.default as Record<string, unknown>).orm = originalOrm;
    }
  });

  test('db:migrate:status prints DynamoDB message when dynamodb config present', async function(assert) {
    const configModule = await import('stonyx/config');
    const originalOrm = (configModule.default as Record<string, unknown>).orm;
    (configModule.default as Record<string, unknown>).orm = { dynamodb: { region: 'us-east-1' } };

    try {
      const { default: commands } = await import('../../src/commands.js');
      await commands['db:migrate:status']!.run([]);

      assert.ok(logStub.calledOnce, 'console.log called once');
      assert.ok(logStub.firstCall.args[0].includes('DynamoDB'), 'message mentions DynamoDB');
    } finally {
      (configModule.default as Record<string, unknown>).orm = originalOrm;
    }
  });
});
