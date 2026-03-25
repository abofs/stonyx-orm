import QUnit from 'qunit';
import { parseMigrationFile, splitStatements } from '../../../src/postgres/migration-runner.js';

const { module, test } = QUnit;

module('[Unit] Postgres Migration Runner — parseMigrationFile', function () {
  test('parses UP and DOWN sections', function (assert) {
    const content = '-- UP\nCREATE TABLE "t" ("id" INTEGER);\n\n-- DOWN\nDROP TABLE "t";';
    const { up, down } = parseMigrationFile(content);
    assert.strictEqual(up, 'CREATE TABLE "t" ("id" INTEGER);');
    assert.strictEqual(down, 'DROP TABLE "t";');
  });

  test('handles missing DOWN section', function (assert) {
    const content = '-- UP\nCREATE TABLE "t" ("id" INTEGER);';
    const { up, down } = parseMigrationFile(content);
    assert.strictEqual(up, 'CREATE TABLE "t" ("id" INTEGER);');
    assert.strictEqual(down, '');
  });

  test('handles content without markers', function (assert) {
    const content = 'CREATE TABLE "t" ("id" INTEGER);';
    const { up, down } = parseMigrationFile(content);
    assert.strictEqual(up, 'CREATE TABLE "t" ("id" INTEGER);');
    assert.strictEqual(down, '');
  });
});

module('[Unit] Postgres Migration Runner — splitStatements', function () {
  test('splits on semicolons and filters empty/comments', function (assert) {
    const sql = 'CREATE TABLE "t" ("id" INTEGER);\n-- comment\nINSERT INTO "t" VALUES (1);';
    const stmts = splitStatements(sql);
    assert.strictEqual(stmts.length, 2);
    assert.strictEqual(stmts[0], 'CREATE TABLE "t" ("id" INTEGER)');
    assert.strictEqual(stmts[1], 'INSERT INTO "t" VALUES (1)');
  });

  test('handles hypertable DDL statements', function (assert) {
    const sql = "CREATE TABLE \"t\" (\"id\" INTEGER);\nSELECT create_hypertable('t', 'ts');\nSELECT add_compression_policy('t', INTERVAL '7 days');";
    const stmts = splitStatements(sql);
    assert.strictEqual(stmts.length, 3);
    assert.true(stmts[1].includes('create_hypertable'));
    assert.true(stmts[2].includes('add_compression_policy'));
  });
});
