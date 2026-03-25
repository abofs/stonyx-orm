import QUnit from 'qunit';
import { buildTableDDL } from '../../../src/postgres/schema-introspector.js';

const { module, test } = QUnit;

function hypertableSchema() {
  return {
    match: {
      table: 'matches', idType: 'string',
      columns: {}, foreignKeys: {},
      relationships: { belongsTo: {}, hasMany: {} },
    },
    'stat-snapshot': {
      table: 'stat_snapshots', idType: 'number',
      columns: { timestamp: 'TIMESTAMPTZ', possession_home: 'DOUBLE PRECISION' },
      foreignKeys: { match_id: { references: 'matches', column: 'id' } },
      relationships: { belongsTo: { match: 'match' }, hasMany: {} },
      timeSeries: 'timestamp',
      compression: { after: '7d' },
    },
  };
}

function multipleFK() {
  return {
    match: {
      table: 'matches', idType: 'string',
      columns: {}, foreignKeys: {},
      relationships: { belongsTo: {}, hasMany: {} },
    },
    player: {
      table: 'players', idType: 'number',
      columns: {}, foreignKeys: {},
      relationships: { belongsTo: {}, hasMany: {} },
    },
    event: {
      table: 'events', idType: 'number',
      columns: { timestamp: 'TIMESTAMPTZ' },
      foreignKeys: {
        match_id: { references: 'matches', column: 'id' },
        player_id: { references: 'players', column: 'id' },
      },
      relationships: { belongsTo: { match: 'match', player: 'player' }, hasMany: {} },
      timeSeries: 'timestamp',
      compression: { after: '7d' },
    },
  };
}

module('[Unit] Postgres Hypertable DDL', function () {
  test('buildTableDDL omits FK constraints for hypertable schemas', function (assert) {
    const schemas = hypertableSchema();
    const ddl = buildTableDDL('stat-snapshot', schemas['stat-snapshot'], schemas);
    assert.true(ddl.includes('"match_id" VARCHAR(255)'), 'FK column is still created');
    assert.false(ddl.includes('FOREIGN KEY'), 'no FK constraint for hypertable');
  });

  test('buildTableDDL returns hypertable DDL statements', function (assert) {
    const schemas = hypertableSchema();
    const ddl = buildTableDDL('stat-snapshot', schemas['stat-snapshot'], schemas);
    assert.true(ddl.includes("SELECT create_hypertable('stat_snapshots', 'timestamp')"), 'includes create_hypertable');
  });

  test('buildTableDDL returns compression DDL when compression is set', function (assert) {
    const schemas = hypertableSchema();
    const ddl = buildTableDDL('stat-snapshot', schemas['stat-snapshot'], schemas);
    assert.true(ddl.includes('timescaledb.compress'), 'includes compression setting');
    assert.true(ddl.includes("timescaledb.compress_segmentby = 'match_id'"), 'segments by FK column');
    assert.true(ddl.includes("add_compression_policy('stat_snapshots', INTERVAL '7 days')"), 'includes compression policy');
  });

  test('compression segmentby includes all FK columns for multiple belongsTo', function (assert) {
    const schemas = multipleFK();
    const ddl = buildTableDDL('event', schemas.event, schemas);
    assert.true(
      ddl.includes("timescaledb.compress_segmentby = 'match_id, player_id'"),
      'segments by all FK columns'
    );
  });

  test('non-hypertable schemas do not include hypertable DDL', function (assert) {
    const schemas = hypertableSchema();
    const ddl = buildTableDDL('match', schemas.match, schemas);
    assert.false(ddl.includes('create_hypertable'), 'no hypertable DDL for regular table');
    assert.false(ddl.includes('compress'), 'no compression for regular table');
  });

  test('timeSeries without compression does not include compression DDL', function (assert) {
    const schemas = {
      event: {
        table: 'events', idType: 'number',
        columns: { timestamp: 'TIMESTAMPTZ' },
        foreignKeys: { match_id: { references: 'matches', column: 'id' } },
        relationships: { belongsTo: { match: 'match' }, hasMany: {} },
        timeSeries: 'timestamp',
      },
    };
    const ddl = buildTableDDL('event', schemas.event, schemas);
    assert.true(ddl.includes('create_hypertable'), 'includes hypertable DDL');
    assert.false(ddl.includes('compress'), 'no compression DDL');
  });
});
