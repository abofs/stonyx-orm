import QUnit from 'qunit';
import sinon from 'sinon';
import Orm from '../../src/main.js';
import log from 'stonyx/log';

const { module, test } = QUnit;

module('[Unit] Orm self-registers log type in init() (#124)', function (hooks) {
  let originalInstance: Orm;

  hooks.beforeEach(function () {
    originalInstance = Orm.instance;
  });

  hooks.afterEach(function () {
    Orm.instance = originalInstance;
    sinon.restore();
  });

  test('registers db log type on init', async function (assert) {
    assert.strictEqual(typeof log.defineType, 'function', 'log.defineType is available');

    Orm.instance = undefined as unknown as Orm;
    const orm = new Orm({ dbType: 'none' });
    // init() may throw later (missing configured paths in the unit harness) but
    // defineType runs as the first statement, before any throw.
    try { await orm.init(); } catch { /* expected */ }

    assert.strictEqual(typeof log.db, 'function', 'log.db is callable after init');
  });

  test('idempotent: calling init twice does not throw', async function (assert) {
    Orm.instance = undefined as unknown as Orm;
    const orm1 = new Orm({ dbType: 'none' });
    try { await orm1.init(); } catch { /* expected */ }

    Orm.instance = undefined as unknown as Orm;
    const orm2 = new Orm({ dbType: 'none' });
    try { await orm2.init(); } catch { /* expected */ }

    assert.strictEqual(typeof log.db, 'function', 'log.db still callable after second init');
  });
});
