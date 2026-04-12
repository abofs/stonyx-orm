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

module('[Unit] createRecord | duplicate ID handling', function(hooks) {
  hooks.afterEach(function() {
    store.get('owner')?.clear();
  });

  test('createRecord with duplicate ID updates the existing record', function(assert) {
    const first = createRecord('owner', { id: 'dup-test', gender: 'female', age: 30 }, { serialize: false });

    assert.strictEqual(first.gender, 'female', 'first record has original gender');
    assert.strictEqual(first.age, 30, 'first record has original age');

    const second = createRecord('owner', { id: 'dup-test', gender: 'male', age: 35 }, { serialize: false });

    assert.strictEqual(first, second, 'returns the same record object');
    assert.strictEqual(second.gender, 'male', 'gender was updated to latest value');
    assert.strictEqual(second.age, 35, 'age was updated to latest value');
  });

  test('createRecord with duplicate ID does not create a second store entry', function(assert) {
    createRecord('owner', { id: 'dup-store', gender: 'female' }, { serialize: false });
    createRecord('owner', { id: 'dup-store', gender: 'male' }, { serialize: false });

    assert.strictEqual(store.get('owner').size, 1, 'store still has exactly one record');
  });

  test('last entry wins when loading multiple duplicates', function(assert) {
    createRecord('owner', { id: 'dup-multi', gender: 'female', age: 20 }, { serialize: false });
    createRecord('owner', { id: 'dup-multi', gender: 'male', age: 30 }, { serialize: false });
    createRecord('owner', { id: 'dup-multi', gender: 'other', age: 40 }, { serialize: false });

    const record = store.get('owner').get('dup-multi');

    assert.strictEqual(record.gender, 'other', 'final createRecord value wins');
    assert.strictEqual(record.age, 40, 'final createRecord age wins');
    assert.strictEqual(store.get('owner').size, 1, 'store has exactly one record');
  });
});
