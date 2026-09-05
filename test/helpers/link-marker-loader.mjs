/**
 * Node ESM hooks that let a probe prove POSITIVELY that it exercised a module,
 * instead of inferring it from the absence of complaints.
 *
 * Registered by test/helpers/register-link-marker.mjs, chained with
 * test/helpers/absent-optional-peer-loader.mjs. Used by
 * test/unit/lazy-rest-server-import-test.ts (stonyx-orm#283).
 *
 * Two markers, both written to stderr:
 *
 *   LINKED_MODULE:<url>  — emitted after nextLoad() returns, so Node resolved
 *     <url> to a real module and read its source. An empty, missing, directory
 *     or non-module target never produces one for the target.
 *
 *   RESOLVED_FROM:<parentURL> — emitted when Node asks to resolve a specifier
 *     ON BEHALF OF <parentURL>, which it does only for a module it has already
 *     parsed. It is therefore the marker that says the child reached the STATIC
 *     DEPENDENCY RESOLUTION phase for <parentURL> — the exact phase in which an
 *     absent optional peer throws. Measured: dist/cli.js emits it twice and
 *     dist/setup-rest-server.js three times, while an empty, missing, directory
 *     or unparseable target emits none for the target.
 *
 *     It is emitted BEFORE nextResolve(), so a throw further down the chain
 *     cannot suppress it. Measured with a second `bin` command whose module does
 *     import the peer at module scope: the sentinel assertion reds while both
 *     marker assertions stay green.
 *
 * fs.writeSync(2) rather than process.stderr.write: hooks run on a separate
 * loader thread, and dist/cli.js calls process.exit() (11 sites), so the markers
 * go straight to fd 2 instead of through a stream whose flush ordering across
 * that thread boundary these assertions would then depend on. The
 * process.stderr.write form was not measured; writeSync avoids the question.
 */
import { writeSync } from 'node:fs';

export const LINK_MARKER = 'LINKED_MODULE:';
export const RESOLVE_MARKER = 'RESOLVED_FROM:';

export async function resolve(specifier, context, nextResolve) {
  if (context?.parentURL) writeSync(2, `${RESOLVE_MARKER}${context.parentURL}\n`);
  return nextResolve(specifier, context);
}

export async function load(url, context, nextLoad) {
  const result = await nextLoad(url, context);
  writeSync(2, `${LINK_MARKER}${url}\n`);
  return result;
}
