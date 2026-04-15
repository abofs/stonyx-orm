import QUnit from 'qunit';
import View from '../../src/view.js';

const { module, test } = QUnit;

module('[Unit] View base class', function() {
  test('readOnly is true by default', function(assert) {
    assert.strictEqual(View.readOnly, true);
  });

  test('readOnly cannot be overridden to false on a subclass', function(assert) {
    class BadView extends View {
      static readOnly = false;
    }

    assert.throws(
      () => new BadView('bad-view'),
      /cannot override readOnly to false/,
      'throws when readOnly is set to false'
    );
  });

  test('memory is false by default', function(assert) {
    assert.strictEqual(View.memory, false);
  });

  test('memory can be overridden to true', function(assert) {
    class CachedView extends View {
      static memory = true;
    }

    assert.strictEqual(CachedView.memory, true);
  });

  test('pluralName works the same as Model', function(assert) {
    assert.strictEqual(View.pluralName, undefined, 'default is undefined');

    class CustomPluralView extends View {
      static pluralName = 'custom-views';
    }

    assert.strictEqual(CustomPluralView.pluralName, 'custom-views');
  });

  test('source is undefined by default', function(assert) {
    assert.strictEqual(View.source, undefined);
  });

  test('resolve is undefined by default', function(assert) {
    assert.strictEqual(View.resolve, undefined);
  });

  test('constructor sets __name', function(assert) {
    const view = new View('test-view');
    assert.strictEqual(view.__name, 'test-view');
  });

  test('has id = attr("number") default', function(assert) {
    const view = new View('test-view');
    assert.ok(view.id !== undefined, 'id property exists');
    assert.strictEqual(view.id?.constructor?.name, 'ModelProperty', 'id is a ModelProperty');
    assert.strictEqual(view.id?.type, 'number', 'id type is number');
  });
});
