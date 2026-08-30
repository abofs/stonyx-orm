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
import type { AddressInfo } from 'net';
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
const childScript = path.join(repoRoot, 'test/helpers/env-isolation-child.ts');

/**
 * The boot child's own control variables — NOT configuration, and never
 * inheritable. See the scrub in bootChild for why: an inherited
 * ISOLATION_CHILD_TEST_SUITE arms suite mode in a child the caller asked to
 * boot only, and suite mode is what makes children spawn children.
 */
const ISOLATION_CONTROL_VARS = ['ISOLATION_CHILD_TEST_SUITE', 'ISOLATION_CHILD_EXIT_AFTER_CONFIG'];

/** This file, as the child sees it — derived, so a rename cannot stale it. */
const selfRelPath = path.relative(repoRoot, fileURLToPath(import.meta.url)).split(path.sep).join('/');

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
  // The no-connection property for this branch is no longer established only
  // by construction -- see the DynamoDB decoy assertion below, which counts
  // real sockets the way assertion 2 does for mysql.
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
 * Ambient pointers into the AWS credential chain.
 *
 * Outside READ_LIST — config/environment.js never reads them — but they steer
 * the SDK to a real profile, a real credentials file or IMDS. Scrubbed from
 * the DynamoDB decoy child so its client, if one were ever constructed, has
 * nowhere to go but the loopback decoy.
 */
const AWS_CHAIN_VARS = [
  'AWS_PROFILE', 'AWS_DEFAULT_PROFILE', 'AWS_SHARED_CREDENTIALS_FILE', 'AWS_CONFIG_FILE',
  'AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'AWS_SESSION_TOKEN',
  'AWS_REGION', 'AWS_DEFAULT_REGION', 'AWS_ENDPOINT_URL', 'AWS_ENDPOINT_URL_DYNAMODB',
  'AWS_ROLE_ARN', 'AWS_WEB_IDENTITY_TOKEN_FILE', 'AWS_CONTAINER_CREDENTIALS_RELATIVE_URI',
  'AWS_CONTAINER_CREDENTIALS_FULL_URI', 'AWS_CONTAINER_AUTHORIZATION_TOKEN',
];

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

// Every directory a polluted run could emit migrations into. The default name
// is `migrations`, but the polluting set also exports *_MIGRATIONS_DIR, so the
// artifact lands under whichever sentinel name the selected driver carries.
// Checking only `migrations/` would miss exactly the run that proves the point.
const migrationArtifactDirs = [
  migrationsArtifact,
  ...['MYSQL_MIGRATIONS_DIR', 'PG_MIGRATIONS_DIR', 'TIMESCALE_MIGRATIONS_DIR']
    .map(key => path.join(repoRoot, POLLUTION[key])),
];
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
function reserveFreePort(): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const probe = net.createServer();

    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address() as AddressInfo;
      probe.close(() => resolve(String(port)));
    });
  });
}

function listEntries(dir) {
  if (!fs.existsSync(dir)) return { files: [], dirs: [] };

  const entries = fs.readdirSync(dir, { recursive: true, withFileTypes: true })
    .map(entry => ({
      rel: path.relative(dir, path.join(entry.parentPath, entry.name)),
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

/** rel path -> sha256 of contents, for every file under `dir`. */
function hashDir(dir) {
  return new Map(listFiles(dir).map(rel => [
    rel,
    createHash('sha256').update(fs.readFileSync(path.join(dir, rel))).digest('hex'),
  ]));
}

/**
 * Files under `dir` whose CONTENTS changed against `baseline`.
 *
 * Assertion 3's title claims test/sample/ is left byte-identical; a listing
 * comparison only ever checked the names. A regression that rewrites an
 * existing collection file in place -- which is exactly what a leaked DB_MODE
 * does once the directory already exists -- produces an identical listing.
 */
function modifiedFiles(dir, baselineHashes) {
  const now = hashDir(dir);

  return [...baselineHashes.keys()]
    .filter(rel => now.has(rel) && now.get(rel) !== baselineHashes.get(rel))
    .filter(rel => rel !== PINNED_DB_ARTIFACT)
    .sort();
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

interface ChildResult {
  stdout: string;
  stderr: string;
  code: number | null;
  timedOut: boolean;
}

/**
 * Spawn a boot child. `pollute` keys are SET in the child's environment;
 * every other POLLUTION key is deliberately REMOVED, so the "clean" baseline
 * is genuinely unpolluted even on a developer machine that exports them.
 */
function bootChild({ root, restPort, pollute = {}, scrub = [], exitAfterConfig = true, watchdogMs = 60000, runSuite = false }) {
  const env = { ...process.env };

  // READ_LIST, not POLLUTION_KEYS: a variable config/environment.js reads but
  // that nobody remembered to pollute would otherwise be inherited IDENTICALLY
  // by both children, so assertion 1's deepEqual would compare a leak against
  // the same leak and pass. Deleting the derived set makes the clean baseline
  // genuinely clean even on a machine that exports the whole lot.
  for (const key of READ_LIST) delete env[key];

  // Variables outside READ_LIST that a particular assertion needs neutralised
  // — the AWS credential-chain pointers, so far. Scrubbed before `pollute` is
  // merged, so a caller can scrub a name and then set its own value for it.
  for (const key of scrub) delete env[key];

  Object.assign(env, pollute);

  // The child's control variables are SCRUBBED before they are set, never
  // merely set-if-true. `env` starts as a copy of process.env, so an
  // ISOLATION_CHILD_* value already present in the parent's environment would
  // otherwise survive `if (runSuite)` untouched and arm the child anyway.
  //
  // That is the fork bomb, not a hypothetical one. Suite mode makes the child
  // load and run the repo's own test files, this file among them if the
  // child's recursion guard ever stops matching -- and every bootChild call in
  // this file would then inherit the arming and spawn a suite of its own. The
  // watchdog below cannot contain that: child.kill() kills the direct child,
  // and the grandchildren it already spawned are reparented, not killed. One
  // stray child holding a port for the better part of an hour is the observed
  // consequence of the mild version of this.
  //
  // The child scrubs these from its own process.env as well, which bounds
  // depth at one generation; this stops the arming from crossing the boundary
  // at all.
  for (const key of ISOLATION_CONTROL_VARS) delete env[key];

  env.ISOLATION_CHILD_ROOT = root;
  env.NODE_ENV = 'test';
  // Deliberately NOT REST_PORT: that is @stonyx/rest-server's production
  // variable and the suite must never be steerable by it. See the pin in
  // test/config/environment.js.
  env.ORM_TEST_REST_PORT = restPort;
  if (exitAfterConfig) env.ISOLATION_CHILD_EXIT_AFTER_CONFIG = '1';
  if (runSuite) env.ISOLATION_CHILD_TEST_SUITE = '1';

  return new Promise<ChildResult>(resolve => {
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

function parseSnapshot({ stdout, stderr, code }: ChildResult) {
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
  let sampleHashes;
  let sampleBackup;
  let migrationsExistedBefore;

  hooks.before(async function() {
    ({ link: root, cleanup: cleanupRoot } = makeNormalizedRoot());
    restPort = await reserveFreePort();
    sampleBaseline = listEntries(sampleDir);
    sampleHashes = hashDir(sampleDir);
    migrationsExistedBefore = fs.existsSync(migrationsArtifact);

    // A byte copy, not just a listing. The suite-scoped child runs the repo's
    // own integration tests, which create and delete records in
    // test/sample/db.json; test/integration/orm-test.ts runs after this module
    // and reads that file. Without restoring CONTENTS, this module silently
    // reshapes state that 27 later assertions depend on.
    sampleBackup = fs.mkdtempSync(path.join(os.tmpdir(), 'orm-184-sample-'));
    fs.cpSync(sampleDir, path.join(sampleBackup, 'sample'), { recursive: true });
  });

  // Every test here boots a child that may write to disk, and each one has to
  // hand the next a clean checkout. Runs even when the test threw.
  hooks.afterEach(function() {
    // Contents, not just the file list: restore test/sample/ to exactly the
    // bytes this module inherited, so the tests that run after it see the
    // state they would have seen had this module not run at all.
    fs.rmSync(sampleDir, { recursive: true, force: true });
    fs.cpSync(path.join(sampleBackup, 'sample'), sampleDir, { recursive: true });

    restoreDir(sampleDir, sampleBaseline);

    for (const dir of migrationArtifactDirs) {
      if (dir === migrationsArtifact && migrationsExistedBefore) continue;

      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  hooks.after(function() {
    cleanupRoot();
    fs.rmSync(sampleBackup, { recursive: true, force: true });
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
      decoy.listen(0, '127.0.0.1', () => resolve(String((decoy.address() as AddressInfo).port)));
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

    // Precondition: this assertion's non-vacuity rested on undocumented driver
    // chain ordering -- it aims at the mysql branch, and the chain checks
    // timescale and postgres first, so a run in which either of those resolved
    // would never reach mysql and "0 connections" would mean nothing. Pinned
    // rather than assumed: assert from the child's own snapshot that no other
    // connection block existed to shadow it.
    const snapshot = parseSnapshot(result);

    assert.deepEqual(
      { timescale: snapshot.orm.timescale, postgres: snapshot.orm.postgres, dynamodb: snapshot.orm.dynamodb },
      { timescale: null, postgres: null, dynamodb: null },
      'precondition: no earlier branch of the driver chain was populated, so this run targets mysql');

    assert.strictEqual(connections, 0,
      'no outbound connection is attempted against the host named by ambient MYSQL_HOST');
  });

  // Per-branch coverage, and an honest statement of what it is worth.
  //
  // Assertion 2 gives mysql an EXECUTED no-connection proof: a real listener
  // counts real sockets. The other three branches have no equivalent, and
  // until now only DynamoDB's gap was disclosed. This closes the disclosure
  // and the cheap half of the gap: each branch gets its own child, polluted
  // with ONLY that driver's variables, and the resolved connection block must
  // be null -- so src/main.ts's chain never selects it and the driver is never
  // constructed. That is a config-level proof, weaker than assertion 2's
  // socket-level one.
  //
  // DynamoDB now ALSO has an executed socket-level proof (see the decoy test
  // below), so the remaining config-only branches are postgres and timescale.
  // For those two it is still the strongest proof available without standing
  // up real servers, and that limit is stated rather than papered over.
  test('a boot polluted with only one driver\'s variables resolves that driver\'s connection block to null', async function(assert) {
    const branches = {
      mysql: ['MYSQL_HOST', 'MYSQL_PORT', 'MYSQL_USER', 'MYSQL_PASSWORD', 'MYSQL_DATABASE'],
      postgres: ['PG_HOST', 'PG_PORT', 'PG_USER', 'PG_PASSWORD', 'PG_DATABASE'],
      timescale: ['TIMESCALE_HOST', 'TIMESCALE_PORT', 'TIMESCALE_USER', 'TIMESCALE_PASSWORD', 'TIMESCALE_DATABASE'],
      dynamodb: ['DYNAMODB_REGION', 'DYNAMODB_ENDPOINT', 'DYNAMODB_TABLE_PREFIX'],
    };

    for (const [branch, keys] of Object.entries(branches)) {
      const pollute = Object.fromEntries(keys.map(key => [key, POLLUTION[key]]));
      const snapshot = parseSnapshot(await bootChild({ root, restPort, pollute }));

      assert.strictEqual(snapshot.orm[branch], null,
        `config.orm.${branch} is null with only ${keys.join('/')} exported, so the driver chain never selects it`);
    }
  });

  // DynamoDB — the one branch whose no-connection property this file used to
  // only DISCLOSE as unproven. Now executed, at assertion 2's strength.
  //
  // The objection to proving it was that constructing a DynamoDB client makes
  // the AWS SDK's credential chain reach for IMDS at 169.254.169.254, and no
  // test may put a packet on that path. That objection is removed by
  // construction, not argued away: AWS_EC2_METADATA_DISABLED=true takes IMDS
  // out of the chain, static dummy credentials satisfy it without any lookup,
  // and every ambient AWS_* pointer at a real profile or credentials file is
  // scrubbed from the child. The only endpoint left reachable is the decoy on
  // loopback.
  //
  // Non-vacuous: src/main.ts's chain constructs the driver and awaits init(),
  // and DynamoDB's init() calls loadMemoryRecords(), which issues a paginated
  // Scan per model. A leaked config here is a real socket to the decoy, which
  // is exactly what the counter would record.
  test('a decoy TCP listener pointed at by DYNAMODB_ENDPOINT records exactly 0 accepted connections', async function(assert) {
    let connections = 0;

    const decoy = net.createServer(socket => {
      connections += 1;
      // Accept and stay silent. A decoy, not DynamoDB Local.
      socket.on('error', () => {});
    });

    const decoyPort = await new Promise(resolve => {
      decoy.listen(0, '127.0.0.1', () => resolve(String((decoy.address() as AddressInfo).port)));
    });

    let result;

    try {
      result = await bootChild({
        root,
        restPort,
        scrub: AWS_CHAIN_VARS,
        pollute: {
          DYNAMODB_REGION: POLLUTION.DYNAMODB_REGION,
          DYNAMODB_TABLE_PREFIX: POLLUTION.DYNAMODB_TABLE_PREFIX,
          DYNAMODB_ENDPOINT: `http://127.0.0.1:${decoyPort}`,
          // Not credentials. Syntactically valid placeholders that terminate
          // the SDK's credential chain at the first step so it never looks
          // anywhere real.
          AWS_EC2_METADATA_DISABLED: 'true',
          AWS_ACCESS_KEY_ID: 'AKIAORM184NOTAREALKEY',
          AWS_SECRET_ACCESS_KEY: 'orm184-not-a-real-secret-value',
          AWS_REGION: POLLUTION.DYNAMODB_REGION,
          AWS_SHARED_CREDENTIALS_FILE: '/dev/null',
          AWS_CONFIG_FILE: '/dev/null',
        },
        exitAfterConfig: false,
        watchdogMs: 30000,
      });
    } finally {
      await new Promise(resolve => decoy.close(resolve));
    }

    assert.ok(result.stdout.includes('PHASE:booting'),
      `precondition: the spawned child booted (stdout: ${result.stdout.slice(0, 400)})`);

    const snapshot = parseSnapshot(result);

    assert.deepEqual(
      { timescale: snapshot.orm.timescale, postgres: snapshot.orm.postgres, mysql: snapshot.orm.mysql },
      { timescale: null, postgres: null, mysql: null },
      'precondition: no earlier branch of the driver chain was populated, so this run targets dynamodb');

    assert.strictEqual(connections, 0,
      'no outbound connection is attempted against the endpoint named by ambient DYNAMODB_ENDPOINT');
  });

  // GUARD (pass-by-construction) — pins the driver-chain ordering that several
  // comments in this file rely on. It asserts today's source, so it cannot be
  // shown failing here; it is a guard, and labelled one. It exists because the
  // ordering is load-bearing for assertion 2's non-vacuity and is documented
  // nowhere in src/.
  test('regression guard: src/main.ts selects drivers in the order timescale, postgres, mysql, dynamodb', function(assert) {
    const source = fs.readFileSync(path.join(repoRoot, 'src/main.ts'), 'utf8');
    const order = [...source.matchAll(/(?:if|else if)\s*\(\s*config\.orm\.(\w+)\s*\)/g)].map(m => m[1]);

    assert.deepEqual(order, ['timescale', 'postgres', 'mysql', 'dynamodb'],
      'the else-if driver chain order is unchanged; assertion 2 aims at the mysql branch and relies on it');
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

    assert.deepEqual(modifiedFiles(sampleDir, sampleHashes), [],
      'test/sample/ is left byte-identical, not merely name-identical');
  });

  // The fork-bomb guard, at the boundary it actually crosses.
  //
  // bootChild copies process.env and then sets ISOLATION_CHILD_TEST_SUITE only
  // when the caller asked for suite mode. It never used to REMOVE it, so a
  // value already in the parent's environment reached every child untouched.
  // Suite mode is the mode that makes a child load and run the repo's test
  // files -- this file among them, if the child's recursion guard ever stops
  // matching -- so an inherited arming turns each of the eight bootChild calls
  // in this file into another full suite, recursively. The watchdog does not
  // contain it: child.kill() reaches the direct child and nothing below it.
  //
  // Both variables are covered, because inheriting either one silently changes
  // what the caller asked for. They are asserted with SEPARATE children on
  // purpose: an inherited EXIT_AFTER_CONFIG makes the child exit before the
  // suite-mode branch is even reached, so a single child carrying both would
  // report "did not enter suite mode" for the wrong reason and pass vacuously
  // against exactly the code this is meant to catch.
  test('a boot child cannot inherit suite mode or exit-after-config from the parent environment', async function(assert) {
    const saved = ISOLATION_CONTROL_VARS.map(key => [key, process.env[key]] as const);

    try {
      for (const key of ISOLATION_CONTROL_VARS) delete process.env[key];

      // (a) EXIT_AFTER_CONFIG. The caller asked for a child that runs past the
      //     config snapshot; an inherited '1' truncates it there instead.
      process.env.ISOLATION_CHILD_EXIT_AFTER_CONFIG = '1';

      const truncated = await bootChild({ root, restPort, exitAfterConfig: false, watchdogMs: 60000 });

      assert.ok(/PHASE:ready(-error)?\b/.test(truncated.stdout),
        'a child spawned with exitAfterConfig:false runs past the config snapshot even when the ' +
        `parent exports ISOLATION_CHILD_EXIT_AFTER_CONFIG=1 (stdout: ${truncated.stdout.slice(0, 300)})`);

      // (b) TEST_SUITE. The one that forks.
      delete process.env.ISOLATION_CHILD_EXIT_AFTER_CONFIG;
      process.env.ISOLATION_CHILD_TEST_SUITE = '1';

      const armed = await bootChild({ root, restPort, exitAfterConfig: false, watchdogMs: 120000 });

      assert.notOk(armed.stdout.includes('PHASE:suite-loading'),
        'a child spawned with runSuite:false does not enter suite mode even when the parent ' +
        'exports ISOLATION_CHILD_TEST_SUITE=1');

      assert.notOk(armed.timedOut,
        'that child terminated on its own rather than being killed by the watchdog');

      // Non-vacuity: without this, both assertions above are also satisfied by
      // a child that failed to boot and printed nothing at all.
      assert.ok(armed.stdout.includes('PHASE:booting'),
        'precondition: the child that must not enter suite mode did boot');
    } finally {
      for (const [key, value] of saved) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  });

  // Refined AC3, at the scope the criterion actually names: no migrations/
  // directory at the repo root after a full test run with the ambient database
  // variables exported.
  //
  // This was previously filed as structurally untestable. It is not. The
  // earlier harness was boot-scoped, and a boot cannot reach the emitter: it
  // rejects in the driver handshake against a refusing port before any
  // migration is generated. That is a limit of the chosen scope, not a
  // property of the system, and the two are not the same claim.
  //
  // There are TWO emitters, not one. Bisected against this PR's base commit in
  // a normally-named checkout with the full polluting set exported:
  //   whole suite                       -> both sentinel dirs below
  //   commands-test.ts + cli-test.ts    -> nothing
  //   mysql/mysql-db-startup-test.ts    -> sentinel-mysql-migrations/
  //   postgres/postgres-db-startup-test.ts -> sentinel-pg-migrations/
  //
  // The postgres one is INTERMITTENT, and a future reader debugging a flaky
  // guard needs to know the flake is in the emitter and not in the guard. Its
  // "startup() auto-generates initial migration ..." case races the ambient
  // boot in test/setup.ts, which rejects asynchronously with ECONNREFUSED
  // against the sentinel port; depending on when that rejection lands the file
  // reports `not ok 3 (global failure)` or a clean 5/5 followed by `Bail
  // out!`, and the artifact does not always survive the run. An earlier
  // bisection recorded "none" for this file on the strength of a single run.
  //
  // (The much earlier diagnosis naming src/commands.ts is wrong on a different
  // axis: src/commands.ts resolves migrationsDir the same way, but no test in
  // this suite reaches its write path.)
  //
  // The check below enumerates every sentinel directory rather than the
  // emitters, so it is unaffected by which of the two fires on a given run --
  // but it does inherit their raciness in the failing direction, i.e. a red
  // run is trustworthy and a green run at base would not be.
  //
  // Recursion is broken inside the child, which derives the file to exclude by
  // reading which test file references the child script by name -- not from a
  // hardcoded path, and not from a --filter argument the parent passes. Both
  // of those are strings that can silently stop matching, and the failure mode
  // when they do is an unbounded fork bomb.
  test('a full suite run with the full polluting set exported creates no migrations directory at the repo root', async function(assert) {
    const result = await bootChild({
      root,
      restPort,
      pollute: POLLUTION,
      exitAfterConfig: false,
      runSuite: true,
      watchdogMs: 300000,
    });

    // Preconditions. Without them "no migrations directory" is also satisfied
    // by a child that loaded nothing and by one the watchdog killed on entry.
    assert.notOk(result.timedOut, 'precondition: the suite child was not killed by the watchdog');

    // The recursion guard, asserted rather than assumed. The child derives the
    // file to exclude; if that derivation ever matches nothing the child
    // refuses to run at all, and if it matches the wrong thing the exclusion
    // is silently useless. Both are visible here.
    const excluded = result.stdout.match(/PHASE:suite-excluded (\d+) ([^\n]*)/);

    assert.ok(excluded && Number(excluded[1]) > 0,
      `precondition: the child's recursion guard excluded at least one file (${excluded?.[1] ?? 'no'})`);

    assert.ok(excluded ? excluded[2].split(',').includes(selfRelPath) : false,
      `precondition: the derived exclusion names this very file, ${selfRelPath} ` +
      `(excluded: ${excluded?.[2] ?? 'nothing'})`);

    const loaded = result.stdout.match(/PHASE:suite-loading (\d+)/);

    assert.ok(loaded && Number(loaded[1]) > 50,
      `precondition: the child loaded the real test suite (${loaded?.[1] ?? 'no'} files)`);

    const done = result.stdout.match(/PHASE:suite-done files=\d+ pass=(\d+) fail=\d+/);

    assert.ok(done && Number(done[1]) > 500,
      `precondition: the suite actually ran (${done?.[1] ?? 'no'} assertions passed) ` +
      `-- a suite that died on entry writes no artifacts either`);

    const emitted = migrationArtifactDirs.filter(dir => fs.existsSync(dir));

    assert.deepEqual(emitted.map(dir => path.relative(repoRoot, dir)), [],
      'no migration directory is written at the repo root by a full suite run under ambient database variables');
  });
});
