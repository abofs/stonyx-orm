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
    test('calls sqlDb.startup() when sqlDb exists', async function(assert) {
      const orm = Object.create(Orm.prototype);
      orm.sqlDb = { startup: sinon.stub().resolves() };

      await orm.startup();

      assert.ok(orm.sqlDb.startup.calledOnce, 'sqlDb.startup was called');
    });

    test('is a no-op when sqlDb is not set', async function(assert) {
      const orm = Object.create(Orm.prototype);
      orm.sqlDb = undefined;

      await orm.startup();
      assert.ok(true, 'did not throw');
    });
  });

  module('shutdown', function() {
    test('calls sqlDb.shutdown() when sqlDb exists', async function(assert) {
      const orm = Object.create(Orm.prototype);
      orm.sqlDb = { shutdown: sinon.stub().resolves() };

      await orm.shutdown();

      assert.ok(orm.sqlDb.shutdown.calledOnce, 'sqlDb.shutdown was called');
    });

    test('is a no-op when sqlDb is not set', async function(assert) {
      const orm = Object.create(Orm.prototype);
      orm.sqlDb = undefined;

      await orm.shutdown();
      assert.ok(true, 'did not throw');
    });
  });
});
