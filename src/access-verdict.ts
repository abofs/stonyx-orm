/**
 * The shared access-verdict primitive (abofs/stonyx-orm#234).
 *
 * ---------------------------------------------------------------------------
 * WHY THIS FILE EXISTS: ONE INTERPRETER, NOT TWO
 * ---------------------------------------------------------------------------
 * A consumer `access()` may return six differently-shaped things -- `false`, a
 * bare permission string, a permission array, `true`, a per-record function, or
 * something the contract does not define at all -- and the reading of each one
 * is a security decision. `auth()` has held that reading inline since #190.
 * Every surface that needs to ask "may this caller see model X's record?" needs
 * the SAME reading, or the second copy becomes an unreviewed second
 * authorization vocabulary that answers differently about the same value.
 *
 * So `interpretAccess` is extracted here and `auth()` now calls it. It is the
 * only place a return shape is classified, and abofs/stonyx-orm#232 and #233
 * rebase onto it rather than re-deriving it.
 *
 * ---------------------------------------------------------------------------
 * WHAT A LINKAGE FILTER IS, AND WHY THE CALLER BUILDS IT
 * ---------------------------------------------------------------------------
 * `Record.toJSON()` APPLIES a verdict; it never RESOLVES one. That is not a
 * style choice, it is forced, and it was measured before it was decided:
 *
 *   INPUT: origin/dev @ c5f7907, unpatched                  -> 967 pass / 0 fail
 *   INPUT: same + fail-closed resolution INSIDE toJSON()    -> 964 pass / 3 fail
 *
 * and all three reds were over-denial of PERMITTED records, not the leak. Two
 * independent reasons:
 *
 *   1. `toJSON()` has no request. The shipped, documented sample reads
 *      `request.path` for its `/archived` sub-path rule -- the one read of
 *      argument one the README sanctions -- and fail-closes when it is absent.
 *      Measured against the live registry:
 *
 *        getAccess('owner')(undefined, { model:'owner',  operation:'read' }) -> false
 *        getAccess('animal')(undefined,{ model:'animal', operation:'read' }) -> [Function]
 *
 *      Same predicate object, two models, two different degradation modes,
 *      chosen by the consumer. Without a request there is no trustworthy
 *      answer to get.
 *
 *   2. `toJSON` is also the `JSON.stringify` hook, so `JSON.stringify({data:
 *      record})` calls `record.toJSON('data')` -- a STRING in the options slot.
 *      An implicit caller has no syntactic place to pass anything
 *      (abofs/stonyx-orm#230). The no-argument document must therefore stay
 *      byte-identical to what shipped, which also rules out fail-closed by
 *      default: `Orm.instance.accessFunctions` is `{}` in any process that
 *      never ran `setup-rest-server` (CLI, SQL-only, unit tests), so a
 *      fail-closed default would empty every relationship on every document in
 *      processes that have no REST surface to protect.
 *
 * The caller -- which still holds the request -- resolves the predicate,
 * interprets it here, caches the answer, and hands `toJSON()` an already-decided
 * `(type, record) => boolean`.
 */
import Orm from '@stonyx/orm';
import log from 'stonyx/log';
import type { AccessMethod, AccessOperation } from './types/orm-types.js';

/**
 * The classified reading of one `access()` return value.
 *
 * `granted: false` is a total denial. `granted: true` with no `filter` is an
 * unconditional grant. `granted: true` WITH a filter means "grant, subject to
 * this per-record predicate" -- the function return shape, which is the
 * per-record hook `AccessContext` deliberately does not provide.
 */
export interface AccessVerdict {
  granted: boolean;
  filter?: (record: unknown) => boolean;
}

/**
 * A resolved, request-scoped linkage decision: may `record` of model `type` be
 * NAMED, by id, inside another model's document?
 *
 * Arity is `(type, record)` and not `(type, id)` because the per-record filter
 * the consumer returns is handed the RECORD -- this repo's own fixture reads
 * `record.owner?.id`, not just `record.id`. The `(type, id)` pair is the CACHE
 * key, not the input.
 */
export type LinkageFilter = (type: string, record: unknown) => boolean;

const DENIED: AccessVerdict = Object.freeze({ granted: false });
const GRANTED: AccessVerdict = Object.freeze({ granted: true });

/**
 * Classify one `access()` return value. Extracted verbatim from `auth()`, which
 * now calls this; the branch ORDER is load-bearing and is preserved exactly.
 *
 * `operation` is the verb being authorised. `undefined` -- reachable, because
 * express delivers HEAD to the GET handler and `methodAccessMap` has no entry
 * for it -- falls through `permitted.includes(undefined)` to a denial, which is
 * the same answer `auth()` gave before the extraction.
 */
export function interpretAccess(access: AccessMethod, operation: AccessOperation | undefined): AccessVerdict {
  if (!access) return DENIED;

  // The function return shape IS the per-record hook. Grant the request and
  // carry the predicate; the caller applies it per record.
  if (typeof access === 'function') return { granted: true, filter: access as (record: unknown) => boolean };

  if (access === true) return GRANTED;

  // `AccessMethod` declares `string` legal and it fell through every branch
  // above. A bare string is ONE permission, not a grant of all four -- reading
  // it as a full grant is what once let `return 'read'` authorise DELETE.
  const permitted = typeof access === 'string' ? [access] : access;

  // Anything that is not a permission array by this point -- an object, a
  // number, a Symbol -- is a consumer mistake, and the only safe reading of a
  // shape the contract does not define is a denial. Fail CLOSED.
  if (!Array.isArray(permitted)) return DENIED;
  if (!permitted.includes(operation as string)) return DENIED;

  return GRANTED;
}

/**
 * Resolve model `type`'s verdict for a read, against the live `request`.
 *
 * Fails closed on both ambiguous inputs:
 *
 *   - `getAccess(type)` -> `undefined`. That is NOT "this model is
 *     unrestricted". `setup-rest-server` catches an access-class load failure,
 *     warns, and publishes whatever PARTIAL map it had, so `undefined` covers
 *     both "no access class claims this model" and "the class that claims it
 *     failed to load" -- and the caller cannot tell them apart. Deny.
 *   - the predicate THROWS. Same reading `auth()` and `isDenied` already use:
 *     a throw is a denial, logged, never a 500 and never a grant.
 *
 * NOTE ON CROSS-MODEL ASKS. The predicate is asked about `type` while the
 * request in hand was dispatched to a DIFFERENT model's route. Since #222 this
 * repo's fixture reads `context.model` and answers correctly; a consumer's
 * arity-1 predicate does not, and there is no supported way to tell which kind
 * was resolved (the boot-time arity warning is abofs/stonyx-orm#213). A
 * consequence to expect rather than debug: the fixture's surviving `request.path`
 * read means asking the OWNER predicate on a request dispatched to
 * `GET /animals/archived` returns a bare `false`. That is a whole-request deny
 * bleeding across models -- harmless, because it is the fail-closed direction,
 * and it is treated as "deny this linkage", not as an error.
 */
function resolveVerdict(request: unknown, type: string): AccessVerdict {
  const predicate = Orm.instance?.getAccess?.(type);
  if (typeof predicate !== 'function') return DENIED;

  let access: AccessMethod;

  try {
    access = predicate(request, { model: type, operation: 'read' });
  } catch (error) {
    log.error?.(`[@stonyx/orm] access() threw while resolving linkage for model "${type}" -- denying. ${error instanceof Error ? error.message : String(error)}`);

    return DENIED;
  }

  return interpretAccess(access, 'read');
}

/**
 * Build a request-scoped linkage filter.
 *
 * TWO CACHES, AND BOTH ARE LOAD-BEARING RATHER THAN AN OPTIMISATION:
 *
 *   - one verdict per TYPE. Resolving means CALLING the consumer's `access()`,
 *     which is arbitrary code with arbitrary cost and which the module has
 *     already had to guard for throwing.
 *   - one decision per `(type, id)`. `included` is deduplicated by
 *     `buildResponse`; LINKAGE is not deduplicated at all, so it re-asks once
 *     per record. Measured on a bare `GET /animals` with no `include=`:
 *     48 linkage entries -> 7 distinct `(type, id)` pairs (owner 20, trait 28),
 *     a 6.9x reduction and 41 predicate calls saved.
 *
 * The `(type, id)` cache is a `Map` per type keyed on the RAW id, not on a
 * template-string composite: `Map` compares with SameValueZero, so the numeric
 * id `1` and the string id `'1'` stay distinct, where `` `${type}:${id}` ``
 * would collapse them and let one model's verdict answer for another record.
 *
 * SCOPE IS ONE REQUEST. The filter closes over the request and must not outlive
 * it -- a verdict cached across requests would answer a second caller with the
 * first caller's authorization.
 */
export function createLinkageFilter(request: unknown): LinkageFilter {
  const byType = new Map<string, { verdict: AccessVerdict; decisions: Map<unknown, boolean> }>();

  return function isLinkable(type: string, record: unknown): boolean {
    let entry = byType.get(type);

    if (!entry) {
      entry = { verdict: resolveVerdict(request, type), decisions: new Map() };
      byType.set(type, entry);
    }

    const { verdict, decisions } = entry;

    if (!verdict.granted) return false;
    if (!verdict.filter) return true;

    const id = (record as { id?: unknown } | null)?.id;
    const cached = decisions.get(id);
    if (cached !== undefined) return cached;

    let allowed: boolean;

    try {
      allowed = Boolean(verdict.filter(record));
    } catch (error) {
      // A predicate that throws is a denial -- the same reading `isDenied` uses
      // one layer down. Logged, because a predicate that throws on every record
      // empties every relationship and, silently, that is indistinguishable
      // from a database with no relationships in it.
      log.error?.(`[@stonyx/orm] access filter threw while filtering linkage for model "${type}" -- denying. ${error instanceof Error ? error.message : String(error)}`);

      allowed = false;
    }

    decisions.set(id, allowed);

    return allowed;
  };
}
