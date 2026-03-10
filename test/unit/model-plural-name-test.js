import QUnit from 'qunit';
import Model from '../../src/model.js';
import { pluralize } from '../../src/utils.js';
import { registerPluralName, getPluralName } from '../../src/plural-registry.js';

const { module, test } = QUnit;

module('[Unit] Model.pluralName — Static Property', function() {

  test('Model base class has pluralName: undefined by default', function(assert) {
    assert.strictEqual(Model.pluralName, undefined, 'default is undefined');
  });

  test('subclass inherits pluralName: undefined', function(assert) {
    class Animal extends Model {}

    assert.strictEqual(Animal.pluralName, undefined, 'subclass inherits undefined');
  });

  test('subclass can override pluralName', function(assert) {
    class Person extends Model {
      static pluralName = 'people';
    }

    assert.strictEqual(Person.pluralName, 'people', 'subclass overrides pluralName');
  });

  test('overriding one subclass does not affect base or other subclasses', function(assert) {
    class Animal extends Model {}
    class Person extends Model {
      static pluralName = 'people';
    }

    assert.strictEqual(Model.pluralName, undefined, 'base class unchanged');
    assert.strictEqual(Animal.pluralName, undefined, 'other subclass unchanged');
    assert.strictEqual(Person.pluralName, 'people', 'override only affects its own class');
  });
});

module('[Unit] Plural Registry', function() {

  test('registerPluralName uses pluralName when set on model class', function(assert) {
    class Person extends Model {
      static pluralName = 'people';
    }

    registerPluralName('person', Person);
    assert.strictEqual(getPluralName('person'), 'people', 'returns overridden plural');
  });

  test('registerPluralName falls back to pluralize when pluralName is not set', function(assert) {
    class Animal extends Model {}

    registerPluralName('animal', Animal);
    assert.strictEqual(getPluralName('animal'), 'animals', 'returns auto-pluralized name');
  });

  test('registerPluralName handles dasherized model names', function(assert) {
    class AccessLink extends Model {}

    registerPluralName('access-link', AccessLink);
    assert.strictEqual(getPluralName('access-link'), 'access-links', 'pluralizes last segment');
  });

  test('getPluralName falls back to pluralize for unregistered models', function(assert) {
    assert.strictEqual(getPluralName('widget'), pluralize('widget'), 'falls back to pluralize');
  });
});
