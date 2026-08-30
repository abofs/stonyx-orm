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
import { createHash } from 'crypto';
import { fileURLToPath } from 'url';
import { TEST_OVERRIDE_SENTINEL, AMBIENT_VARS } from '../config/environment.js';

const { module, test } = QUnit;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../..');
const childScript = path.join(repoRoot, 'test/helpers/env-isolation-child.mjs');

// A closed loopback port. Connections are refused immediately, so a boot that
// wrongly builds a connection block fails fast instead of reaching a real host.
const DEAD_PORT = '45999';

// Every variable config/environment.js reads that test/config/environment.js
// is responsible for neutralising, set to a value that is unmistakably ours.
// Declared once so assertion 1's deep-equal and the artifact assertions cannot
// drift apart, and checked against a source-derived read list below so it
// cannot fall behind config/environment.js.
//
// All eleven of the *_CONNECTION_LIMIT / *_MIGRATIONS_DIR / PG_USER /
// PG_DATABASE / TIMESCALE_USER / TIMESCALE_DATABASE / DYNAMODB_TABLE_PREFIX
// entries were missing until this commit: the list was 26 names against a read
// set of 37.
const POLLUTION = {
  MYSQL_HOST: '127.0.0.1',
  MYSQL_PORT: DEAD_PORT,
  MYSQL_USER: 'sentinel_user',
  MYSQL_PASSWORD: 'sentinel_mysql_password',
  MYSQL_DATABASE: 'sentinel_db',
  MYSQL_CONNECTION_LIMIT: '3',
  MYSQL_MIGRATIONS_DIR: 'sentinel-mysql-migrations',
  PG_HOST: '127.0.0.1',
  PG_PORT: DEAD_PORT,
  PG_USER: 'sentinel_pg_user',
  PG_PASSWORD: 'sentinel_pg_password',
  PG_DATABASE: 'sentinel_pg_db',
  PG_CONNECTION_LIMIT: '4',
  PG_MIGRATIONS_DIR: 'sentinel-pg-migrations',
  TIMESCALE_HOST: '127.0.0.1',
  TIMESCALE_PORT: DEAD_PORT,
  TIMESCALE_USER: 'sentinel_timescale_user',
  TIMESCALE_PASSWORD: 'sentinel_timescale_password',
  TIMESCALE_DATABASE: 'sentinel_timescale_db',
  TIMESCALE_CONNECTION_LIMIT: '5',
  TIMESCALE_MIGRATIONS_DIR: 'sentinel-timescale-migrations',
  DYNAMODB_REGION: 'us-sentinel-1',
  DYNAMODB_TABLE_PREFIX: 'sentinel_',
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

/**
 * The variables config/environment.js actually reads, derived from its source
 * rather than transcribed.
 *
 * The previous version of this file declared POLLUTION as the authority on the
 * read set. It was a hand-maintained literal of 26 names; the config reads 37.
 * Eleven were never exercised, and -- proven twice by review -- adding a new
 * `DB_ENCODING` read to config/environment.js and leaving it unpinned produced
 * a fully green 859/0 run while the ambient value landed verbatim in the
 * resolved config as `encoding: "LEAKED_FROM_AMBIENT"`. The whole-object
 * deepEqual cannot see that: an unlisted variable is inherited identically by
 * both the polluted child and the clean one, so the two agree and the
 * comparison passes. Only a derived read-list closes it.
 *
 * Deliberately a source parse of the destructuring block, not an import: the
 * point is to observe the variables the file NAMES, which is exactly what a
 * runtime import of its default export throws away.
 */
function deriveReadList() {
  const source = fs.readFileSync(path.join(repoRoot, 'config/environment.js'), 'utf8');
  const block = source.match(/const\s*\{([\s\S]*?)\}\s*=\s*process\.env/);

  if (!block) {
    throw new Error('config/environment.js: could not locate the `const { ... } = process.env` block');
  }

  const destructured = block[1]
    .replace(/\/\/[^\n]*/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split(',')
    // `A: B` renames the binding; the ambient name is the key, on the left.
    .map(part => part.split(':')[0].trim())
    .filter(name => /^[A-Z][A-Z0-9_]*$/.test(name));

  // Also catch reads that never enter the destructuring block. Without this,
  // a later `process.env.FOO` added inline would be invisible to the drift
  // guard AND to the deep-equal (both children inherit it identically), which
  // is the same blind spot in a different shape.
  const inline = [...source.matchAll(/process\.env(?:\.([A-Z][A-Z0-9_]*)|\[\s*['"]([A-Z][A-Z0-9_]*)['"]\s*\])/g)]
    .map(m => m[1] ?? m[2]);

  return [...new Set([...destructured, ...inline])].sort();
}

const READ_LIST = deriveReadList();

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

function listEntries(dir) {
  if (!fs.existsSync(dir)) return { files: [], dirs: [] };

  const entries = fs.readdirSync(dir, { recursive: true, withFileTypes: true })
    .map(entry => ({
      rel: path.relative(dir, path.join(entry.parentPath ?? entry.path, entry.name)),
      isDir: entry.isDirectory(),
    }));

  return {
    files: entries.filter(e => !e.isDir).map(e => e.rel).sort(),
    dirs: entries.filter(e => e.isDir).map(e => e.rel).sort(),
  };
}

function listFiles(dir) {
  return listEntries(dir).files;
}

/**
 * Delete everything under `dir` that was not in `baseline`.
 *
 * Every test in this module boots a child that may write to test/sample/, and
 * a child that writes there is precisely the defect under test. Without this,
 * one assertion's leak becomes the next assertion's baseline: with `mode`
 * removed from the pinned set, assertion 1 correctly goes red AND writes
 * test/sample/db/ with five collection files, after which assertion 3 -- whose
 * `before` snapshot was taken after assertion 1 had already run, and which
 * only looks for the `sentinel-db-dir` name -- reports PASS. Run 2 in the same
 * checkout then aborts at boot with a DB mode mismatch. A guard whose failure
 * mode wedges the checkout is worse than no guard.
 *
 * Directories first: removing a stray directory takes its files with it.
 */
/**
 * The ONE artifact a correctly-isolated boot is allowed to create under
 * test/sample/, because test/config/environment.js pins `db.file` to it. It is
 * named here rather than filtered by a pattern so that the exclusion is a
 * single reviewable line: everything else appearing under test/sample/ after a
 * boot is, by definition, a variable that escaped the pinned set.
 */
const PINNED_DB_ARTIFACT = 'db.json';

/** Files under `dir` that are neither in `baseline` nor the pinned DB target. */
function leakedFiles(dir, baseline) {
  const known = new Set([...baseline.files, PINNED_DB_ARTIFACT]);

  return listFiles(dir).filter(rel => !known.has(rel));
}

function restoreDir(dir, baseline) {
  const removed = [];
  const baselineDirs = new Set(baseline.dirs);
  const baselineFiles = new Set(baseline.files);

  for (const rel of listEntries(dir).dirs) {
    if (baselineDirs.has(rel) || !fs.existsSync(path.join(dir, rel))) continue;

    fs.rmSync(path.join(dir, rel), { recursive: true, force: true });
    removed.push(`${rel}/`);
  }

  for (const rel of listEntries(dir).files) {
    if (baselineFiles.has(rel)) continue;

    fs.rmSync(path.join(dir, rel), { force: true });
    removed.push(rel);
  }

  return removed;
}

/**
 * Spawn a boot child. `pollute` keys are SET in the child's environment;
 * every other POLLUTION key is deliberately REMOVED, so the "clean" baseline
 * is genuinely unpolluted even on a developer machine that exports them.
 */
function bootChild({ root, restPort, pollute = {}, exitAfterConfig = true, watchdogMs = 60000 }) {
  const env = { ...process.env };

  // READ_LIST, not POLLUTION_KEYS: a variable config/environment.js reads but
  // that nobody remembered to pollute would otherwise be inherited IDENTICALLY
  // by both children, so assertion 1's deepEqual would compare a leak against
  // the same leak and pass. Deleting the derived set makes the clean baseline
  // genuinely clean even on a machine that exports the whole lot.
  for (const key of READ_LIST) delete env[key];
  Object.assign(env, pollute);

  env.ISOLATION_CHILD_ROOT = root;
  env.NODE_ENV = 'test';
  // Deliberately NOT REST_PORT: that is @stonyx/rest-server's production
  // variable and the suite must never be steerable by it. See the pin in
  // test/config/environment.js.
  env.ORM_TEST_REST_PORT = restPort;
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

function parseSnapshot({ stdout, stderr, code }) {
  const match = stdout.match(/---CONFIG-START---\n([\s\S]*?)\n---CONFIG-END---/);

  if (!match) {
    throw new Error(`child emitted no config snapshot (exit ${code})\nstdout:\n${stdout}\nstderr:\n${stderr}`);
  }

  return JSON.parse(match[1]);
}

/**
 * Keys whose values identify a real system rather than describe a shape.
 *
 * Passwords were already safe -- they are in POLLUTION and are sentinel-
 * substituted, verified with a canary. The adjacent identifiers were not: with
 * an unpinned read, review reproduced `"user": "CANARY_PGUSER_svcprod"` and
 * `"database": "CANARY_PGDB_prod"` printed verbatim into the TAP stream, which
 * is archived by CI and pasted into review threads.
 */
const IDENTITY_KEYS = new Set([
  'host', 'user', 'password', 'database', 'endpoint', 'region', 'tablePrefix', 'migrationsDir',
]);

/**
 * Values this suite put there itself, so showing them is useful rather than
 * dangerous: the sentinels, plus config/environment.js's own literal defaults.
 */
const SAFE_IDENTITY_VALUES = new Set([
  ...Object.values(POLLUTION),
  'localhost', 'root', 'postgres', 'stonyx', 'migrations', '',
]);

/**
 * Rewrite identity-shaped values that this suite did not author into a stable
 * digest. deepEqual still fails on a mismatch -- two different secrets hash to
 * two different digests -- but the failure diff carries a fingerprint instead
 * of the credential.
 *
 * Defense in depth, not the primary mitigation. bootChild deletes the derived
 * READ_LIST from the child environment, which is what stops ambient values
 * reaching a snapshot in the first place; this is what limits the blast radius
 * when something is read from outside that list.
 */
function redactIdentities(value, key = null) {
  if (Array.isArray(value)) return value.map(entry => redactIdentities(entry));

  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, redactIdentities(v, k)])
    );
  }

  if (key === null || !IDENTITY_KEYS.has(key)) return value;
  if (typeof value !== 'string' || SAFE_IDENTITY_VALUES.has(value)) return value;

  const digest = createHash('sha256').update(value).digest('hex').slice(0, 12);

  return `<redacted ${key} len=${value.length} sha256=${digest}>`;
}

/** The comparable half of a child snapshot: the resolved configuration only. */
function configOf(snapshot) {
  return redactIdentities({ orm: snapshot.orm, restServer: snapshot.restServer });
}

module('[Integration] Ambient environment isolation (#184)', function(hooks) {
  let root;
  let cleanupRoot;
  let restPort;

  // Snapshotted ONCE, before any test in this module has booted a child, so it
  // records the state of test/sample/ that this module inherited rather than
  // the state a previous assertion in this module left behind. Assertion 3
  // used to take its own `before` inside the test body, which meant that when
  // assertion 1 leaked, assertion 3 compared the leak against itself.
  let sampleBaseline;
  let migrationsExistedBefore;

  hooks.before(async function() {
    ({ link: root, cleanup: cleanupRoot } = makeNormalizedRoot());
    restPort = await reserveFreePort();
    sampleBaseline = listEntries(sampleDir);
    migrationsExistedBefore = fs.existsSync(migrationsArtifact);
  });

  // Every test here boots a child that may write to disk, and each one has to
  // hand the next a clean checkout. Runs even when the test threw.
  hooks.afterEach(function() {
    restoreDir(sampleDir, sampleBaseline);
    if (!migrationsExistedBefore) fs.rmSync(migrationsArtifact, { recursive: true, force: true });
  });

  hooks.after(function() {
    cleanupRoot();
  });

  // Assertion 0 — the precondition every other assertion in this file rests on.
  //
  // The whole fix for #184 lives in test/config/environment.js. If that file
  // is not merged, nothing below it is testing anything: the ambient
  // environment wins and the suite still passes, because Stonyx.start()
  // catches `Config not found:` and treats a missing test override as
  // non-fatal. That is not hypothetical — stonyx 4c80c87 (shipped in
  // v0.2.3-beta.63, one commit after the beta.62 tag) made importConfig
  // resolve `.js` ONLY, and this file was `test/config/environment.ts` until
  // this PR. It resolved solely because a `pnpm.overrides` pin holds stonyx at
  // beta.61 while package.json#dependencies declares beta.76.
  //
  // Two independent proofs, because either alone is weak:
  //   1. the sentinel — a key that exists ONLY in the override, so a non-zero
  //      value cannot come from anywhere else;
  //   2. an overridden value — `paths.model`, where the override and the
  //      primary config/environment.js disagree, so this fails if the file is
  //      resolved but loses the merge rather than being skipped outright.
  test('the NODE_ENV=test override at test/config/environment.js is actually merged into a real boot', async function(assert) {
    const snapshot = parseSnapshot(await bootChild({ root, restPort }));

    assert.strictEqual(snapshot.testOverrideSentinel, TEST_OVERRIDE_SENTINEL,
      'the sentinel exported by test/config/environment.js reaches the booted config ' +
      '(null here means importConfig threw Config not found: and Stonyx.start() swallowed it)');

    assert.strictEqual(snapshot.orm.paths.model, './test/sample/models',
      'the override wins over config/environment.js\'s default of ./models');

    assert.notStrictEqual(snapshot.orm.paths.model, './models',
      'the primary config default did not survive the merge');
  });

  // GUARD (pass-by-construction) — the override must stay `.js`.
  //
  // Cannot be shown failing against current head in the same run, because it
  // asserts the state this PR creates. It is a guard, not a defect test, and
  // is labelled one. Assertion 0 above is the executable proof; this exists so
  // that a rename back to `.ts` fails on the filename rather than only in a
  // boot, where the failure mode is silence.
  test('regression guard: the test override is test/config/environment.js, never .ts', function(assert) {
    assert.ok(fs.existsSync(path.join(repoRoot, 'test/config/environment.js')),
      'test/config/environment.js exists (stonyx >= 0.2.3-beta.63 resolves .js only)');

    assert.notOk(fs.existsSync(path.join(repoRoot, 'test/config/environment.ts')),
      'test/config/environment.ts does not exist (it would be silently ignored, not rejected)');
  });

  // The drift guard the file's comments have been claiming all along.
  //
  // Three-way, because each list is maintained by hand in a different place
  // and any one of them going stale re-opens #184:
  //   READ_LIST      derived from config/environment.js's source (the truth)
  //   POLLUTION      what this suite actually exports at the children
  //   AMBIENT_VARS   what test/config/environment.js says it is neutralising
  //
  // A new variable added to config/environment.js and left out of either list
  // turns this red immediately, which is the case the whole-object deepEqual
  // provably cannot detect: an unpolluted variable reaches both children
  // identically, so they agree.
  test('every variable config/environment.js reads is exercised by this suite and declared by the test override', function(assert) {
    assert.deepEqual(POLLUTION_KEYS.slice().sort(), READ_LIST,
      `the polluting set covers all ${READ_LIST.length} variables config/environment.js destructures ` +
      `(polluting set has ${POLLUTION_KEYS.length})`);

    assert.deepEqual(AMBIENT_VARS.slice().sort(), READ_LIST,
      `test/config/environment.js's AMBIENT_VARS matches the same ${READ_LIST.length} variables ` +
      `(it declares ${AMBIENT_VARS.length})`);
  });

  // Assertion 1 — the load-bearing one. A whole-object deep-equal, not a
  // key-by-key check, so the pinned set cannot drift from the read set.
  test('resolved config with the full polluting set exported deep-equals the config resolved with it unset', async function(assert) {
    const pollutedSnapshot = await bootChild({ root, restPort, pollute: POLLUTION });
    const cleanSnapshot = await bootChild({ root, restPort });

    const polluted = configOf(parseSnapshot(pollutedSnapshot));
    const clean = configOf(parseSnapshot(cleanSnapshot));

    assert.deepEqual(polluted, clean,
      'config.orm + config.restServer resolve identically whether or not ambient database variables are exported');

    // Assertion 1 boots two real children. When the pinned set regresses, the
    // polluted child does not merely resolve a wrong config -- it writes one.
    // Fail on the leak here rather than letting it silently become the next
    // assertion's baseline. hooks.afterEach still cleans up either way.
    assert.deepEqual(leakedFiles(sampleDir, sampleBaseline), [],
      'neither boot child wrote anything into test/sample/ beyond the pinned db.json');
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
    // `sampleBaseline`, not a locally re-snapshotted listing: taking the
    // baseline inside this test body is what let an earlier assertion's leak
    // be compared against itself. Cleanup is hooks.afterEach's job, which also
    // covers artifacts written under a name this test does not know about.
    const result = await bootChild({
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

    // Not just the sentinel name: DB_MODE leaking produces a directory named
    // by DB_DIRECTORY, but a partial regression in the pinned set produces one
    // named by the OVERRIDE's db.directory ('db'). Comparing the whole listing
    // catches both; checking for `sentinel-db-dir` alone catches only the first.
    assert.deepEqual(leakedFiles(sampleDir, sampleBaseline), [],
      'test/sample/ gains nothing beyond the pinned db.json from a boot with ambient DB_MODE exported');
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
    const result = await bootChild({ root, restPort, pollute: POLLUTION, exitAfterConfig: false, watchdogMs: 60000 });

    assert.ok(result.stdout.includes('PHASE:booting'),
      'precondition: the spawned child booted');

    assert.strictEqual(fs.existsSync(migrationsArtifact), migrationsExistedBefore,
      'no migrations/ directory is created at the repo root');
  });
});
