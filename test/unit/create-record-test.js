import QUnit from 'qunit';
import { createRecord, store } from '@stonyx/orm';

const { module, test } = QUnit;

module('[Unit] createRecord | default values', function(hooks) {
  hooks.afterEach(function() {
    store.get('owner')?.clear();
  });

  test('undefined attributes should not be transformed', function(assert) {
    const record = createRecord('owner', { name: 'testOwner' });

    assert.strictEqual(record.gender, undefined, 'nickname should be undefined (not the string "undefined")');
  });
});
