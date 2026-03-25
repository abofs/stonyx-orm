import QUnit from 'qunit';

const { module, test } = QUnit;

module('[Unit] Postgres Connection', function () {
  test('closePool is a function', async function (assert) {
    const { closePool } = await import('../../../src/postgres/connection.js');
    assert.strictEqual(typeof closePool, 'function');
  });

  test('getPool is a function', async function (assert) {
    const { getPool } = await import('../../../src/postgres/connection.js');
    assert.strictEqual(typeof getPool, 'function');
  });
});
