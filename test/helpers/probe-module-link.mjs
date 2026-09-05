/**
 * Probe: dynamically import argv[2] and report, as one line of JSON, whether the
 * failure (if any) came from the LINKING phase or the EVALUATION phase.
 *
 * Run under --import ./test/helpers/register-absent-optional-peer.mjs so that
 * '@stonyx/rest-server' resolves to a sentinel failure. See
 * test/unit/lazy-rest-server-import-test.ts (stonyx-orm#280).
 */
try {
  await import(process.argv[2]);
  console.log(JSON.stringify({ outcome: 'evaluated' }));
} catch (error) {
  console.log(JSON.stringify({
    outcome: 'threw',
    code: error?.code ?? null,
    message: String(error?.message ?? error).split('\n')[0],
  }));
}
