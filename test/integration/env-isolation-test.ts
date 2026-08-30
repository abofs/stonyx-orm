// @ts-nocheck
// Regression coverage for abofs/stonyx-orm#184 — ambient database environment
// variables leak into the test suite because test/config/environment.ts pins
// only part of the set that config/environment.js reads.
//
// Tier: integration (subprocess-spawning). Config resolves once at boot, so
// mutating process.env inside a hook is too late and would pass against
// unfixed code. Every assertion here spawns a child with the polluting
// variables deliberately SET — no assertion depends on a variable being
// absent from the ambient environment. The sentinel values point at a dead
// loopback port, never at a real host.
import QUnit from 'qunit';
import net from 'net';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';

const { module, test } = QUnit;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../..');
const childScript = path.join(repoRoot, 'test/helpers/env-isolation-child.mjs');

// A closed loopback port. Connections are refused immediately, so a boot that
// wrongly builds a connection block fails fast instead of reaching a real host.
const DEAD_PORT = '45999';

// Every variable config/environment.js reads that test/config/environment.ts
// is responsible for neutralising. Declared once so assertion 1's deep-equal
// and the artifact assertions cannot drift apart.
const POLLUTION = {
  MYSQL_HOST: '127.0.0.1',
  MYSQL_PORT: DEAD_PORT,
  MYSQL_USER: 'sentinel_user',
  MYSQL_PASSWORD: 'sentinel_mysql_password',
  MYSQL_DATABASE: 'sentinel_db',
  PG_HOST: '127.0.0.1',
  PG_PORT: DEAD_PORT,
  PG_PASSWORD: 'sentinel_pg_password',
  TIMESCALE_HOST: '127.0.0.1',
  TIMESCALE_PORT: DEAD_PORT,
  TIMESCALE_PASSWORD: 'sentinel_timescale_password',
  DYNAMODB_REGION: 'us-sentinel-1',
  // Pinned at the dead port too: DYNAMODB_REGION without an endpoint resolves
  // to real AWS, and no test may depend on branch ordering to stay offline.
  DYNAMODB_ENDPOINT: `http://127.0.0.1:${DEAD_PORT}`,
  DB_MODE: 'directory',
  DB_DIRECTORY: 'sentinel-db-dir',
  DB_AUTO_SAVE: 'onUpdate',
  DB_SAVE_INTERVAL: '17',
  DB_FILE: './sentinel-db.json',
  DB_SCHEMA_PATH: './sentinel-schema.js',
  ORM_ACCESS_PATH: './sentinel-access',
  ORM_MODEL_PATH: './sentinel-models',
  ORM_SERIALIZER_PATH: './sentinel-serializers',
  ORM_TRANSFORM_PATH: './sentinel-transforms',
  ORM_VIEW_PATH: './sentinel-views',
  ORM_USE_REST_SERVER: 'false',
  ORM_REST_ROUTE: '/sentinel',
};

const POLLUTION_KEYS = Object.keys(POLLUTION);

// Artifact locations a polluted boot writes to, resolved against the repo root.
const migrationsArtifact = path.join(repoRoot, 'migrations');
const sampleDir = path.join(repoRoot, 'test/sample');
const dbDirArtifact = path.join(sampleDir, POLLUTION.DB_DIRECTORY);

/**
 * Stonyx's standalone-module transform derives the config key from the LAST
 * SEGMENT of rootPath. A checkout whose directory is not named after the
 * package (a git worktree, a CI scratch dir) therefore resolves config under
 * the wrong key. Point the child at a symlink named after the package so the
 * assertions measure the isolation defect rather than the checkout's name.
 */
function makeNormalizedRoot() {
  const { name } = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));
  const dirName = name.startsWith('@stonyx/') ? `stonyx-${name.slice('@stonyx/'.length)}` : name;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'orm-184-'));
  const link = path.join(dir, dirName);

  fs.symlinkSync(repoRoot, link);

  return { link, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

/** An unused port, so children never collide with the suite's own REST server. */
function reserveFreePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();

    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address();
      probe.close(() => resolve(String(port)));
    });
  });
}

function listFiles(dir) {
  if (!fs.existsSync(dir)) return [];

  return fs.readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter(entry => entry.isFile())
    .map(entry => path.relative(dir, path.join(entry.parentPath ?? entry.path, entry.name)))
    .sort();
}

/**
 * Spawn a boot child. `pollute` keys are SET in the child's environment;
 * every other POLLUTION key is deliberately REMOVED, so the "clean" baseline
 * is genuinely unpolluted even on a developer machine that exports them.
 */
function bootChild({ root, restPort, pollute = {}, exitAfterConfig = true, watchdogMs = 60000 }) {
  const env = { ...process.env };

  for (const key of POLLUTION_KEYS) delete env[key];
  Object.assign(env, pollute);

  env.ISOLATION_CHILD_ROOT = root;
  env.NODE_ENV = 'test';
  env.REST_PORT = restPort;
  if (exitAfterConfig) env.ISOLATION_CHILD_EXIT_AFTER_CONFIG = '1';

  return new Promise(resolve => {
    const child = spawn(process.execPath, ['--import', 'tsx/esm', childScript], {
      cwd: repoRoot,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    let timedOut = false;

    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });

    const watchdog = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, watchdogMs);

    child.on('close', code => {
      clearTimeout(watchdog);
      resolve({ stdout, stderr, code, timedOut });
    });
  });
}

function parseConfig({ stdout, stderr, code }) {
  const match = stdout.match(/---CONFIG-START---\n([\s\S]*?)\n---CONFIG-END---/);

  if (!match) {
    throw new Error(`child emitted no config snapshot (exit ${code})\nstdout:\n${stdout}\nstderr:\n${stderr}`);
  }

  return JSON.parse(match[1]);
}

module('[Integration] Ambient environment isolation (#184)', function(hooks) {
  let root;
  let cleanupRoot;
  let restPort;

  hooks.before(async function() {
    ({ link: root, cleanup: cleanupRoot } = makeNormalizedRoot());
    restPort = await reserveFreePort();
  });

  hooks.after(function() {
    cleanupRoot();
  });

  // Assertion 1 — the load-bearing one. A whole-object deep-equal, not a
  // key-by-key check, so the pinned set cannot drift from the read set.
  test('resolved config with the full polluting set exported deep-equals the config resolved with it unset', async function(assert) {
    const polluted = parseConfig(await bootChild({ root, restPort, pollute: POLLUTION }));
    const clean = parseConfig(await bootChild({ root, restPort }));

    assert.deepEqual(polluted, clean,
      'config.orm + config.restServer resolve identically whether or not ambient database variables are exported');
  });

  // Assertion 2 — the connection itself. A decoy listener accepts the socket
  // and then says nothing, so an unfixed boot blocks on a handshake that never
  // completes; the watchdog is what turns that into an assertion rather than a
  // hung suite.
  test('a decoy TCP listener pointed at by MYSQL_HOST/MYSQL_PORT records exactly 0 accepted connections', async function(assert) {
    let connections = 0;

    const decoy = net.createServer(socket => {
      connections += 1;
      // Accept and stay silent: this is a decoy, not a MySQL server.
      socket.on('error', () => {});
    });

    const decoyPort = await new Promise(resolve => {
      decoy.listen(0, '127.0.0.1', () => resolve(String(decoy.address().port)));
    });

    let result;

    try {
      // MySQL only. config.orm's driver selection is an else-if chain ordered
      // timescale, postgres, mysql, so exporting the postgres or timescale host
      // here would shadow the branch this assertion is aiming at.
      result = await bootChild({
        root,
        restPort,
        pollute: {
          MYSQL_HOST: '127.0.0.1',
          MYSQL_PORT: decoyPort,
          MYSQL_USER: POLLUTION.MYSQL_USER,
          MYSQL_PASSWORD: POLLUTION.MYSQL_PASSWORD,
          MYSQL_DATABASE: POLLUTION.MYSQL_DATABASE,
        },
        exitAfterConfig: false,
        watchdogMs: 20000,
      });
    } finally {
      await new Promise(resolve => decoy.close(resolve));
    }

    // Precondition: without this, "zero connections" is also satisfied by a
    // child that never started.
    assert.ok(result.stdout.includes('PHASE:booting'),
      `precondition: the spawned child booted (stdout: ${result.stdout.slice(0, 400)})`);

    assert.strictEqual(connections, 0,
      'no outbound connection is attempted against the host named by ambient MYSQL_HOST');
  });

  // Assertion 3 — the on-disk artifacts. Filesystem comparison, not git:
  // this repo's .gitignore carries a global *.json rule, so every generated
  // file here is invisible to `git status` and to `git ls-files --others`.
  //
  // Split deliberately. config.orm's driver selection is an else-if chain
  // ordered timescale, postgres, mysql, dynamodb, file-DB — so exporting the
  // FULL polluting set takes the timescale branch and the file DB never
  // initialises at all. A single full-set run therefore reports "no collection
  // directory" against unfixed code and proves nothing. The DB_MODE artifact
  // only appears when no connection block shadows the file DB.
  test('a boot with DB_MODE/DB_DIRECTORY exported writes no collection directory and leaves test/sample/ byte-identical', async function(assert) {
    const before = listFiles(sampleDir);

    let result;

    try {
      result = await bootChild({
        root,
        restPort,
        pollute: {
          DB_MODE: POLLUTION.DB_MODE,
          DB_DIRECTORY: POLLUTION.DB_DIRECTORY,
          DB_AUTO_SAVE: POLLUTION.DB_AUTO_SAVE,
        },
        exitAfterConfig: false,
        watchdogMs: 60000,
      });

      assert.ok(result.stdout.includes('PHASE:booting'),
        'precondition: the spawned child booted');

      assert.notOk(fs.existsSync(dbDirArtifact),
        `no collection directory is written at ${path.relative(repoRoot, dbDirArtifact)}`);

      assert.deepEqual(listFiles(sampleDir), before,
        'test/sample/ file listing is unchanged by a boot with ambient DB_MODE exported');
    } finally {
      fs.rmSync(dbDirArtifact, { recursive: true, force: true });
    }
  });

  // REGRESSION GUARD — not a defect test, and labelled as one deliberately.
  //
  // The migrations artifact recorded on #184 is emitted by the suite's
  // command-level tests (src/commands.ts resolves config.orm.<driver>
  // .migrationsDir against config.rootPath), not by boot: a boot against a
  // refusing port rejects in the driver handshake before any migration is
  // generated. This assertion therefore holds both before and after the fix at
  // boot scope, and cannot be shown failing here. It is kept because it pins a
  // real filesystem postcondition that a future change could break, and
  // because assertion 1 is what actually forecloses the artifact: with
  // config.orm.mysql pinned to null there is no migrationsDir to resolve.
  test('regression guard: a boot with the full polluting set exported creates no migrations/ directory at the repo root', async function(assert) {
    const existedBefore = fs.existsSync(migrationsArtifact);

    let result;

    try {
      result = await bootChild({ root, restPort, pollute: POLLUTION, exitAfterConfig: false, watchdogMs: 60000 });

      assert.ok(result.stdout.includes('PHASE:booting'),
        'precondition: the spawned child booted');

      assert.strictEqual(fs.existsSync(migrationsArtifact), existedBefore,
        'no migrations/ directory is created at the repo root');
    } finally {
      fs.rmSync(dbDirArtifact, { recursive: true, force: true });
      if (!existedBefore) fs.rmSync(migrationsArtifact, { recursive: true, force: true });
    }
  });
});
