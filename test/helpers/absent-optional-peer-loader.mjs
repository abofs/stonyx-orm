/**
 * Node ESM resolve hook that makes '@stonyx/rest-server' behave as if it were
 * never installed — which is the state a plain default `pnpm install` leaves an
 * ORM-only consumer in, because the package is declared an OPTIONAL peer.
 *
 * Registered by test/helpers/register-absent-optional-peer.mjs. Used by
 * test/unit/lazy-rest-server-import-test.ts (stonyx-orm#280).
 *
 * Node links (resolves) an ES module's entire STATIC import graph before it
 * evaluates any of it. So if anything reachable from dist/index.js statically
 * imports '@stonyx/rest-server', the process dies here with SENTINEL_CODE
 * before a single line of ORM code runs. A dynamic `await import()` behind a
 * runtime guard is never resolved, so it never reaches this hook.
 */
export const SENTINEL_CODE = 'ERR_ABSENT_OPTIONAL_PEER';

export async function resolve(specifier, context, nextResolve) {
  if (specifier === '@stonyx/rest-server' || specifier.startsWith('@stonyx/rest-server/')) {
    const error = new Error(`ABSENT_OPTIONAL_PEER: ${specifier} (from ${context.parentURL})`);
    error.code = SENTINEL_CODE;
    throw error;
  }

  return nextResolve(specifier, context);
}
