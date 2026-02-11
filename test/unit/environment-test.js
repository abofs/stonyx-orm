import QUnit from 'qunit';
import path from 'path';
import { fileURLToPath } from 'url';

const { module, test } = QUnit;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.resolve(__dirname, '../../config/environment.js');

module('[Unit] Environment Config', function(hooks) {
  let savedEnv;

  hooks.beforeEach(function() {
    savedEnv = { ...process.env };
  });

  hooks.afterEach(function() {
    // Restore original env
    for (const key of Object.keys(process.env)) {
      if (!(key in savedEnv)) delete process.env[key];
    }
    for (const [key, value] of Object.entries(savedEnv)) {
      process.env[key] = value;
    }
  });

  async function loadEnv() {
    return (await import(`${envPath}?t=${Date.now()}-${Math.random()}`)).default;
  }

  module('mysql auto-enable', function() {
    test('mysql is undefined when MYSQL_HOST is not set', async function(assert) {
      delete process.env.MYSQL_HOST;
      const env = await loadEnv();
      assert.strictEqual(env.mysql, undefined);
    });

    test('mysql is an object when MYSQL_HOST is set', async function(assert) {
      process.env.MYSQL_HOST = 'localhost';
      const env = await loadEnv();
      assert.equal(typeof env.mysql, 'object');
      assert.notStrictEqual(env.mysql, null);
    });

    test('mysql uses correct defaults', async function(assert) {
      process.env.MYSQL_HOST = '127.0.0.1';
      // Clear optional overrides
      delete process.env.MYSQL_PORT;
      delete process.env.MYSQL_USER;
      delete process.env.MYSQL_PASSWORD;
      delete process.env.MYSQL_DATABASE;
      delete process.env.MYSQL_CONNECTION_LIMIT;
      delete process.env.MYSQL_MIGRATIONS_DIR;

      const env = await loadEnv();

      assert.equal(env.mysql.host, '127.0.0.1');
      assert.equal(env.mysql.port, 3306);
      assert.equal(env.mysql.user, 'root');
      assert.equal(env.mysql.password, '');
      assert.equal(env.mysql.database, 'stonyx');
      assert.equal(env.mysql.connectionLimit, 10);
      assert.equal(env.mysql.migrationsDir, 'migrations');
      assert.equal(env.mysql.migrationsTable, '__migrations');
    });

    test('mysql respects all MYSQL_* env var overrides', async function(assert) {
      process.env.MYSQL_HOST = 'dbhost';
      process.env.MYSQL_PORT = '3307';
      process.env.MYSQL_USER = 'admin';
      process.env.MYSQL_PASSWORD = 'secret';
      process.env.MYSQL_DATABASE = 'mydb';
      process.env.MYSQL_CONNECTION_LIMIT = '20';
      process.env.MYSQL_MIGRATIONS_DIR = 'db/migrations';

      const env = await loadEnv();

      assert.equal(env.mysql.host, 'dbhost');
      assert.equal(env.mysql.port, 3307);
      assert.equal(env.mysql.user, 'admin');
      assert.equal(env.mysql.password, 'secret');
      assert.equal(env.mysql.database, 'mydb');
      assert.equal(env.mysql.connectionLimit, 20);
      assert.equal(env.mysql.migrationsDir, 'db/migrations');
    });

    test('mysql.port and mysql.connectionLimit are parsed as integers', async function(assert) {
      process.env.MYSQL_HOST = 'localhost';
      process.env.MYSQL_PORT = '5432';
      process.env.MYSQL_CONNECTION_LIMIT = '50';

      const env = await loadEnv();

      assert.strictEqual(env.mysql.port, 5432);
      assert.strictEqual(env.mysql.connectionLimit, 50);
      assert.equal(typeof env.mysql.port, 'number');
      assert.equal(typeof env.mysql.connectionLimit, 'number');
    });
  });

  module('db config defaults', function() {
    test('default db config values are correct', async function(assert) {
      delete process.env.DB_AUTO_SAVE;
      delete process.env.DB_FILE;
      delete process.env.DB_MODE;
      delete process.env.DB_DIRECTORY;
      delete process.env.DB_SAVE_INTERVAL;
      delete process.env.DB_SCHEMA_PATH;

      const env = await loadEnv();

      assert.equal(env.db.autosave, 'false');
      assert.equal(env.db.mode, 'file');
      assert.equal(env.db.file, 'db.json');
      assert.equal(env.db.directory, 'db');
      assert.equal(env.db.saveInterval, 3600);
      assert.equal(env.db.schema, './config/db-schema.js');
    });
  });
});
