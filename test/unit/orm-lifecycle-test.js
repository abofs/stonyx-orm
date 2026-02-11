import QUnit from 'qunit';
import sinon from 'sinon';
import Orm from '../../src/main.js';

const { module, test } = QUnit;

module('[Unit] Orm Lifecycle', function(hooks) {
  let originalInstance;

  hooks.beforeEach(function() {
    originalInstance = Orm.instance;
  });

  hooks.afterEach(function() {
    Orm.instance = originalInstance;
    sinon.restore();
  });

  module('startup', function() {
    test('calls mysqlDb.startup() when mysqlDb exists', async function(assert) {
      const orm = Object.create(Orm.prototype);
      orm.mysqlDb = { startup: sinon.stub().resolves() };

      await orm.startup();

      assert.ok(orm.mysqlDb.startup.calledOnce, 'mysqlDb.startup was called');
    });

    test('is a no-op when mysqlDb is not set', async function(assert) {
      const orm = Object.create(Orm.prototype);
      orm.mysqlDb = undefined;

      await orm.startup();
      assert.ok(true, 'did not throw');
    });
  });

  module('shutdown', function() {
    test('calls mysqlDb.shutdown() when mysqlDb exists', async function(assert) {
      const orm = Object.create(Orm.prototype);
      orm.mysqlDb = { shutdown: sinon.stub().resolves() };

      await orm.shutdown();

      assert.ok(orm.mysqlDb.shutdown.calledOnce, 'mysqlDb.shutdown was called');
    });

    test('is a no-op when mysqlDb is not set', async function(assert) {
      const orm = Object.create(Orm.prototype);
      orm.mysqlDb = undefined;

      await orm.shutdown();
      assert.ok(true, 'did not throw');
    });
  });
});
