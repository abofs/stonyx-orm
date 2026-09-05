// --import target that installs the load-marker hook.
// See test/helpers/link-marker-loader.mjs (stonyx-orm#283).
import { register } from 'node:module';

register('./link-marker-loader.mjs', import.meta.url);
