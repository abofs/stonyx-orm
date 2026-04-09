import QUnit from 'qunit';
import sinon from 'sinon';
import Orm from '@stonyx/orm';
import OrmRequest from '../../src/orm-request.js';

const { module, test } = QUnit;

module('[Unit] View REST endpoints', function(hooks) {
  let originalInstance;

  hooks.beforeEach(function() {
    originalInstance = Orm.instance;

    Orm.instance = {
      getRecordClasses: sinon.stub().returns({ modelClass: null, serializerClass: null }),
      isView: sinon.stub(),
      sqlDb: null,
      transforms: {
        number: (v) => parseInt(v),
        passthrough: (v) => v,
        string: (v) => String(v),
      },
    };
  });

  hooks.afterEach(function() {
    Orm.instance = originalInstance;
    sinon.restore();
  });

  test('view handlers only include get (no patch, post, delete)', function(assert) {
    Orm.instance.isView.returns(true);

    const request = new OrmRequest({
      model: 'owner-stats',
      access: () => true,
    });

    assert.ok(request.handlers.get, 'GET handlers exist');
    assert.notOk(request.handlers.patch, 'PATCH handlers do not exist');
    assert.notOk(request.handlers.post, 'POST handlers do not exist');
    assert.notOk(request.handlers.delete, 'DELETE handlers do not exist');
  });

  test('model handlers include all HTTP methods', function(assert) {
    Orm.instance.isView.returns(false);

    const request = new OrmRequest({
      model: 'owner',
      access: () => true,
    });

    assert.ok(request.handlers.get, 'GET handlers exist');
    assert.ok(request.handlers.patch, 'PATCH handlers exist');
    assert.ok(request.handlers.post, 'POST handlers exist');
    assert.ok(request.handlers.delete, 'DELETE handlers exist');
  });

  test('view GET / handler exists', function(assert) {
    Orm.instance.isView.returns(true);

    const request = new OrmRequest({
      model: 'owner-stats',
      access: () => true,
    });

    assert.ok(request.handlers.get['/'], 'collection handler exists');
  });

  test('view GET /:id handler exists', function(assert) {
    Orm.instance.isView.returns(true);

    const request = new OrmRequest({
      model: 'owner-stats',
      access: () => true,
    });

    assert.ok(request.handlers.get['/:id'], 'single record handler exists');
  });
});
