// @ts-nocheck
// Route-tier coverage for abofs/stonyx-orm#203 (AC1).
//
// The defect is reachable over 100% public REST surface: seed a descending tail via
// POST/DELETE, then POST with no id — dev assigns the last-INSERTED id + 1 and silently
// overwrites an unrelated record while answering 200.
import QUnit from 'qunit';

const { module, test } = QUnit;

module('[Integration] assignRecordId over the REST route | AC1', function() {
  test('TODO (AC1.1): a no-id POST assigns an id strictly greater than every numeric key', function(assert) {
    assert.ok(false, 'TODO');
  });

  test('TODO (AC1.2): the animal store grew by exactly 1', function(assert) {
    assert.ok(false, 'TODO');
  });

  test('TODO (AC1.3): the previously-highest record is unchanged', function(assert) {
    assert.ok(false, 'TODO');
  });

  test('TODO (AC1.5): the route answers a defined status for the chosen collision policy', function(assert) {
    assert.ok(false, 'TODO');
  });
});
