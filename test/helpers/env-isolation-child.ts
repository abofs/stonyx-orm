// Boot child for the ambient-environment isolation regression tests (#184).
//
// Spawned by test/integration/env-isolation-test.ts with the polluting
// database variables deliberately SET in its environment. Reproduces the
// real boot path -- config/environment.js is read, Stonyx applies the
// standalone-module transform, then merges test/config/environment.js
// because NODE_ENV=test -- and prints the resolved config so the parent
// can compare a polluted boot against a clean one.
//
// The snapshot carries `testOverrideSentinel` verbatim from the merged
// config. Stonyx.start() swallows `Config not found:` when the test override
// cannot be resolved, so a boot that never merged the override is otherwise
// indistinguishable from a boot that did: both print a plausible config and
// both exit 0. The sentinel is the only thing that separates them.
//
// Config resolves once, at boot. That is why this has to be a subprocess:
// mutating process.env inside a QUnit hook happens long after the values
// that matter have already been read.
import { pathToFileURL, fileURLToPath } from 'url';
import fs from 'fs';
import path from 'path';
import { setTimeout as delay } from 'timers/promises';

const ROOT = process.env.ISOLATION_CHILD_ROOT;

if (!ROOT) {
  console.error('env-isolation-child: ISOLATION_CHILD_ROOT is required');
  process.exit(2);
}

process.env.NODE_ENV = 'test';

// The two control variables are read ONCE here and then removed from
// process.env, so that nothing descended from this process can inherit an
// armed suite mode. Suite mode spawns nothing directly, but it loads and runs
// the repo's own test files in-process, and those files spawn children of
// their own; without this, depth is unbounded and the failure mode is a fork
// bomb. With it, an inherited arming can survive at most one generation.
//
// The parent scrubs these too (see bootChild in
// test/integration/env-isolation-test.ts). Both halves are deliberate: the
// parent's scrub stops an armed value reaching a child at all, and this one
// bounds the blast radius if some other caller spawns this script directly.
const EXIT_AFTER_CONFIG = process.env.ISOLATION_CHILD_EXIT_AFTER_CONFIG === '1';
const RUN_SUITE = process.env.ISOLATION_CHILD_TEST_SUITE === '1';

delete process.env.ISOLATION_CHILD_EXIT_AFTER_CONFIG;
delete process.env.ISOLATION_CHILD_TEST_SUITE;

// Against unfixed code the boot dials a database and the driver rejects
// asynchronously (ECONNREFUSED from a dead sentinel port). Node would kill the
// child on that unhandled rejection before the config snapshot is printed,
// which would look to the parent like "the child never booted" rather than
// like the defect it is. Keep the process alive and let the parent decide.
process.on('unhandledRejection', (err: any) => {
  console.log(`PHASE:unhandled-rejection ${err?.message ?? err}`);
});
process.on('uncaughtException', (err: any) => {
  console.log(`PHASE:uncaught-exception ${err?.message ?? err}`);
});

// stonyx's published types do not survive a dynamic `import('stonyx')` under
// moduleResolution NodeNext: the default export resolves to the module
// namespace, so `new Stonyx(...)`, `Stonyx.config` and `Stonyx.ready` all fail
// to typecheck. test/setup.ts and test/integration/dynamodb/setup.ts hit the
// same thing. Narrowed here rather than suppressed with @ts-nocheck, so the
// rest of this file is genuinely checked.
type StonyxStatic = (new (config: unknown, rootPath: string) => unknown) & {
  config: Record<string, any>;
  ready: Promise<unknown>;
};

const { default: StonyxModule } = await import('stonyx');
const Stonyx = StonyxModule as unknown as StonyxStatic;
const { default: config } = await import(pathToFileURL(`${ROOT}/config/environment.js`).href);

new Stonyx(config, ROOT);

// Printed before anything can block. This is the parent's precondition that
// the child genuinely booted -- without it, "zero connections" would also be
// satisfied by a child that crashed on startup and never dialled anything.
console.log('PHASE:booting');

// Stonyx.start() sets `initialized` synchronously but awaits the
// NODE_ENV=test override merge afterwards, so give that a tick budget to
// land before snapshotting. Deliberately snapshotted BEFORE awaiting
// Stonyx.ready: against unfixed code the module load blocks on a database
// handshake that never completes, and the snapshot still has to come out.
await delay(Number(process.env.ISOLATION_CHILD_MERGE_WAIT_MS ?? 800));

console.log('PHASE:config-merged');
console.log('---CONFIG-START---');
console.log(JSON.stringify({
  orm: Stonyx.config.orm,
  restServer: Stonyx.config.restServer,
  testOverrideSentinel: Stonyx.config.testOverrideSentinel ?? null,
}));
console.log('---CONFIG-END---');

if (EXIT_AFTER_CONFIG) process.exit(0);

// SUITE MODE.
//
// The migrations/ artifact recorded on #184 is not emitted by boot. A boot
// against a refusing port rejects in the driver handshake before any migration
// is generated, so a boot-scoped child can never reach it -- which is a
// property of that harness scope, not of the system. The emitters are
// suite-level tests: test/unit/mysql/mysql-db-startup-test.ts, which drives
// MysqlDB.init() directly, and test/unit/postgres/postgres-db-startup-test.ts,
// whose initial-migration case emits INTERMITTENTLY because it races the
// ambient boot's asynchronous ECONNREFUSED. Both resolve their driver's
// migrationsDir against config.rootPath and write
// <root>/<migrationsDir>/<ts>_initial_setup.sql.
//
// So the postcondition has to be checked at suite scope, and this mode does
// that: boot against the normalized ROOT exactly as above, then load and run
// the repo's test files in-process.
//
// RECURSION is the real hazard, and the exclusion below is what breaks it. It
// is excluded here, in the child, rather than by a QUnit --filter the parent
// passes, because a filter is a runtime argument that a future caller can
// forget and the failure mode is an unbounded fork bomb.
//
// The exclusion is DERIVED, never transcribed. A hardcoded path is exactly the
// failure mode being guarded against: this file was `env-isolation-child.mjs`
// one fix round ago, and either side of the relationship can be renamed or
// moved. A guard keyed on a string that silently stops matching keeps
// reporting success while it protects nothing -- and the thing it stops
// protecting against is the fork bomb.
//
// So: the spawner is whichever test file references this script by name, found
// by reading the sources. If that derivation matches NOTHING, the guard is
// stale by definition and this refuses to run the suite rather than forking.
if (RUN_SUITE) {
  const SELF_MARKER = path.basename(fileURLToPath(import.meta.url)).replace(/\.[^.]+$/, '');

  const allTestFiles = fs.readdirSync(path.join(ROOT, 'test'), { recursive: true, encoding: 'utf8' })
    .filter(rel => rel.endsWith('-test.ts'))
    .map(rel => `test/${rel.split(path.sep).join('/')}`)
    .sort();

  const excluded = allTestFiles
    .filter(rel => fs.readFileSync(path.join(ROOT, rel), 'utf8').includes(SELF_MARKER));

  // Startup assertion: the guard's target must actually exist. Zero matches
  // means the derivation has gone stale (this script renamed, the spawner
  // rewritten to build the path dynamically), and running the suite from here
  // would re-enter the spawner and fork without bound. Fail loudly instead.
  if (!excluded.length) {
    console.error(
      `env-isolation-child: RECURSION GUARD IS STALE -- no test file under ${ROOT}/test ` +
      `references "${SELF_MARKER}", so the file that spawns this child cannot be identified. ` +
      `Running the suite here would re-enter it and fork without bound. Refusing.`
    );
    process.exit(3);
  }

  const testFiles = allTestFiles.filter(rel => !excluded.includes(rel));

  // Printed so the parent can assert the guard was non-vacuous: a derivation
  // that excluded nothing, or excluded the wrong file, is visible here rather
  // than only in a fork bomb.
  console.log(`PHASE:suite-excluded ${excluded.length} ${excluded.join(',')}`);

  const { default: QUnit } = await import('qunit');

  QUnit.config.autostart = false;

  // Registered BEFORE the test files are imported, so it runs ahead of
  // test/zz-exit-test.ts's own runEnd hook, which force-exits the process.
  QUnit.on('runEnd', (details: any) => {
    console.log(`PHASE:suite-done files=${testFiles.length} pass=${details.testCounts.passed} fail=${details.testCounts.failed}`);
  });

  console.log(`PHASE:suite-loading ${testFiles.length}`);

  for (const rel of testFiles) {
    await import(pathToFileURL(path.join(ROOT, rel)).href);
  }

  QUnit.start();
} else {

  try {
    await Stonyx.ready;
    console.log('PHASE:ready');
  } catch (err: any) {
    console.log(`PHASE:ready-error ${err.message}`);
  }

  process.exit(0);
}
