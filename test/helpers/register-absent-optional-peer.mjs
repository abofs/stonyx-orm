// --import target that installs the absent-optional-peer resolve hook.
// See test/helpers/absent-optional-peer-loader.mjs (stonyx-orm#280).
import { register } from 'node:module';

register('./absent-optional-peer-loader.mjs', import.meta.url);
