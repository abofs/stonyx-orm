// @ts-nocheck
/**
 * Boots Stonyx with the access class taken verbatim out of README.md —
 * abofs/stonyx-orm#265.
 *
 * Modelled on test/integration/mounted-route/setup.ts, this repo's template for
 * "boot Stonyx with a bespoke raw ORM config".
 *
 * Why a separate process, rather than a module inside the main suite:
 * `paths.access` is read once during Orm.init(), and Stonyx is a singleton, so a
 * second app cannot be booted against a different access directory inside one
 * QUnit process. The main suite's access directory is test/sample/access; this
 * process's is generated from README.md.
 *
 * Like the mounted-route harness this must NOT run under NODE_ENV=test, or
 * test/config/environment.ts clobbers the paths.
 */
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { extractReadmeAccessSamples } from '../../helpers/readme-sample-helper.js';

const cwd = process.cwd();

const GENERATED_DIR = './test/integration/readme-access/generated';

// Write EVERY README access() sample to disk unmodified, and make them the only
// access classes the server can load. Nothing between README.md and the running
// server gets to edit these bytes.
//
// All of them, not just the first: a documented sample that nothing boots is
// the exact defect #265 closes, and until this PR a second sample was silently
// unmeasured. Each sample declares its own `models`, so they mount side by side.
const samples = await extractReadmeAccessSamples(`${cwd}/README.md`);

await rm(GENERATED_DIR, { recursive: true, force: true });
await mkdir(GENERATED_DIR, { recursive: true });

for (const { code, index } of samples) {
  await writeFile(`${GENERATED_DIR}/readme-access-${index}.js`, code, 'utf8');
}

const { default: Stonyx } = await import('stonyx');

// Raw ORM config — the Stonyx standalone transform wraps this as { orm: config }
const config = {
  logColor: 'white',
  logMethod: 'db',
  paths: {
    access: GENERATED_DIR,
    model: './test/sample/models',
    serializer: './test/sample/serializers',
    transform: './test/sample/transforms',
    view: './test/sample/views',
  },
  db: {
    autosave: 'false',
    mode: 'file',
    directory: 'db',
    saveInterval: 60 * 60,
    // Distinct from every other harness's db so this run cannot step on them
    file: './test/sample/readme-access-db.json',
    schema: './test/sample/db-schema.js',
  },
  restServer: {
    enabled: 'true',
    route: '/',
  },
  modules: {
    restServer: {
      // Distinct from the main suite (2666) and the mounted-route suite (2777)
      port: process.env.README_REST_PORT ?? '2888',
      dir: './test/sample/requests',
    },
  },
};

new Stonyx(config, cwd);
