import QUnit from 'qunit';
import Model from '../../src/model.js';

const { module, test } = QUnit;

module('[Unit] Model.memory — Static Flag', function() {

  test('Model base class has memory: true by default', function(assert) {
    assert.strictEqual(Model.memory, true, 'default is memory: true for backward compat');
  });

  test('subclass inherits memory: true', function(assert) {
    class Session extends Model {}

    assert.strictEqual(Session.memory, true, 'subclass inherits memory: true');
  });

  test('subclass can override memory to false', function(assert) {
    class Alert extends Model {
      static memory = false;
    }

    assert.strictEqual(Alert.memory, false, 'subclass overrides to memory: false');
  });

  test('overriding one subclass does not affect base or other subclasses', function(assert) {
    class MemoryModel extends Model {}
    class NoMemoryModel extends Model {
      static memory = false;
    }

    assert.strictEqual(Model.memory, true, 'base class unchanged');
    assert.strictEqual(MemoryModel.memory, true, 'other subclass unchanged');
    assert.strictEqual(NoMemoryModel.memory, false, 'override only affects its own class');
  });
});
