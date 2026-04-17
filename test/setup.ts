// Minimal test setup - match stonyx's cli/test-setup.js exactly.
// This is the canonical init pattern; awaiting Stonyx.ready surfaces
// a pre-existing construct-order race in Orm.init() that never bit
// under `stonyx test` because that CLI did not await.
import { pathToFileURL } from 'url';

const cwd = process.cwd();

const { default: Stonyx } = await import('stonyx');
const { default: config } = await import(pathToFileURL(`${cwd}/config/environment.js`).href);

new Stonyx(config, cwd);
