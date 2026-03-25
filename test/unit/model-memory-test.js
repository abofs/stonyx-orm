import QUnit from 'qunit';
import Model from '../../src/model.js';

const { module, test } = QUnit;

module('[Unit] Model.memory — Static Flag', function() {

  test('Model base class has memory: false by default', function(assert) {
    assert.strictEqual(Model.memory, false, 'default is memory: false');
  });

  test('subclass inherits memory: false', function(assert) {
    class Alert extends Model {}

    assert.strictEqual(Alert.memory, false, 'subclass inherits memory: false');
  });

  test('subclass can override memory to true', function(assert) {
    class Session extends Model {
      static memory = true;
    }

    assert.strictEqual(Session.memory, true, 'subclass overrides to memory: true');
  });

  test('overriding one subclass does not affect base or other subclasses', function(assert) {
    class NoMemoryModel extends Model {}
    class MemoryModel extends Model {
      static memory = true;
    }

    assert.strictEqual(Model.memory, false, 'base class unchanged');
    assert.strictEqual(NoMemoryModel.memory, false, 'other subclass unchanged');
    assert.strictEqual(MemoryModel.memory, true, 'override only affects its own class');
  });
});
