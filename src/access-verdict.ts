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
import type { AccessMethod, AccessOperation, LinkageFilter } from './types/orm-types.js';

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
 * NOTE ON CROSS-MODEL ASKS -- READ THIS BEFORE REBASING #232 OR #233 ONTO IT.
 * The predicate is asked about `type` while the request in hand was dispatched
 * to a DIFFERENT model's route. This function makes another model's class
 * REACHABLE and asks it the model-correct question (`{ model: type }`); whether
 * the ANSWER is model-correct is the CONSUMER's, because only a predicate that
 * READS `context.model` can give one. Since #222 this repo's fixture does. A
 * consumer's arity-1 predicate does not, and there is no supported way to tell
 * which kind was resolved (the boot-time arity warning is
 * abofs/stonyx-orm#213/#221, unshipped).
 *
 * BOTH DEGRADATION DIRECTIONS ARE REACHABLE, AND THE SECOND ONE GRANTS. This is
 * measured, not reasoned:
 *
 *   - CLOSED. The migrated fixture's surviving `request.path` read means asking
 *     the OWNER predicate on a request dispatched to `GET /animals/archived`
 *     returns a bare `false` -- a whole-request deny bleeding across models,
 *     treated here as "deny this linkage", not as an error. That over-denies a
 *     PERMITTED record.
 *   - OPEN. An arity-1 predicate -- the shape `setup-rest-server.ts:15-18`
 *     still declares valid and the README calls the default in every consumer
 *     tree -- identifies its collection from the request, so asked about
 *     `owner` on a request dispatched to `/animals` it answers about ANIMALS.
 *     Measured against this repo's own fixture with `reg.owner` replaced by an
 *     arity-1 predicate that hides angela on `/owners`:
 *
 *       GET /owners     -> ["gina","michael","bob"]   angela hidden, correctly
 *       GET /animals    -> owners named: [angela, ...]              LEAK
 *       GET /animals/1  -> owner.data {"type":"owner","id":"angela"}
 *
 *     That is byte-for-byte the abofs/stonyx-orm#234 defect, on the surface
 *     #234 was filed for, AFTER this fix. It is not a regression -- dev
 *     published the same id unconditionally -- and this file cannot close it,
 *     because the arity signal is #213/#221. Do NOT write, here or anywhere
 *     else, that the cross-model ask degrades closed. The standing rule this
 *     paragraph is held to is in docs/project-structure.md.
 */
function resolveVerdict(request: unknown, type: string): AccessVerdict {
  const predicate = Orm.instance?.getAccess?.(type);
  if (typeof predicate !== 'function') return DENIED;

  let access: AccessMethod;

  try {
    // `recordId: null`, AND NOT `request.params.id`. THE TEMPTING WRONG ANSWER
    // IS RIGHT THERE, so this is pinned by assertion as well as by comment --
    // test/unit/linkage-verdict-test.ts, `#234 + #241 -- recordId is null`.
    //
    // `AccessContext.recordId` (src/types/orm-types.ts, abofs/stonyx-orm#236 /
    // #241) means "the record THIS ROUTE WAS ADDRESSED TO, as the store key of
    // the model being authorised", and `null` means "addressed to no record".
    // The id sitting on the request in hand names the PRIMARY record, which
    // belongs to a DIFFERENT model -- `GET /owners/gina` carries
    // `params.id === 'gina'`, and the ask being made HERE is about `animal` or
    // `trait`. Filling this in from the request would hand the related model's
    // predicate an id belonging to another model, which is byte-for-byte the
    // cross-model confusion abofs/stonyx-orm#202 introduced this context to
    // eliminate: the predicate would compare an owner's id against its own
    // records and answer a question nobody asked. There is no record of THIS
    // model addressed by this request, so `null` is the honest value -- the
    // same spelling `auth()` uses for a collection route.
    //
    // NOR ANY RECORD'S OWN ID, WHICH IS THE SECOND-MOST TEMPTING ANSWER. This
    // verdict is resolved ONCE PER TYPE and cached in `byType` below, before
    // any record has been looked at; there is no per-record `AccessContext`
    // built anywhere on this path. Seeding it from the first record of a type
    // would let that record's identity answer for every later record of the
    // same type -- the same "one record's verdict answers for another" defect
    // the `decisions` raw-key argument below exists to prevent, just one level
    // coarser. And it is unnecessary: `AccessContext` deliberately carries no
    // `record` because auth-time and record-time are separate decision points,
    // and the per-record point already receives the WHOLE record, id included,
    // through `verdict.filter(record)`. A predicate that wants a record's id
    // has the contract's own channel for it.
    access = predicate(request, { model: type, operation: 'read', recordId: null });
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
 * template-string composite. `Map` compares with SameValueZero, so the numeric
 * id `1` and the string id `'1'` stay DISTINCT, where `` `${type}:${id}` `` --
 * or a bare `String(id)` -- collapses them onto one entry and answers the second
 * record with the first record's verdict.
 *
 * WHAT THAT DOES AND DOES NOT PROTECT. It cannot cross MODELS. `decisions` is
 * already partitioned per type by `byType`, so a composite key inside a per-type
 * map is one-to-one with the raw one and no owner's verdict could ever answer
 * for an animal -- the claim that once stood here. The real exposure is narrower
 * and entirely WITHIN one model: two records of the same type whose ids differ
 * only by JavaScript type, which a per-record predicate may legitimately answer
 * differently about (an id read off a JSON body is a string; the same id
 * assigned by the server is a number). Pinned by unit assertion, because this
 * fixture cannot produce the collision on its own -- `owner` ids are strings and
 * `animal` ids are numbers.
 *
 * SCOPE IS ONE REQUEST. The filter closes over the request and must not outlive
 * it -- a verdict cached across requests would answer a second caller with the
 * first caller's authorization.
 *
 * A REQUEST IS REQUIRED, AND ITS ABSENCE IS CHECKED HERE RATHER THAN DELEGATED.
 * This function is EXPORTED (src/index.ts), and the README's Consumer Contracts
 * section points consumers at exactly the contexts that have no live request --
 * a queue payload, a websocket frame, a custom route. Without one there is no
 * caller to authorise against, and this file's header already says so: the
 * shipped sample reads `request.path` and fail-closes when it is absent, so
 * `getAccess('owner')(undefined, ...)` is `false`, while
 * `getAccess('animal')(undefined, ...)` returns a per-record predicate and
 * GRANTS. Measured on this repo's own fixture before this guard existed:
 *
 *   createLinkageFilter(undefined | null | {} | 'x' | 0)
 *     -> owner=false animal=TRUE trait=TRUE category=TRUE phone-number=TRUE
 *
 * Four of five claimed models granted, with no log, because whether an absent
 * request fails closed was left ENTIRELY to consumer predicates -- and a
 * predicate that ignores its request cannot fail closed on one that is missing.
 * A nullish or primitive `request` therefore denies every model outright and
 * says so once, at construction, so the signal exists even for a caller that
 * goes on to serialize nothing.
 *
 * WHAT THIS CANNOT CHECK: `{}` is an object and passes. There is no request
 * contract this module owns -- `auth()` reads `.method`, the shipped sample
 * reads `.path`, a consumer's reads whatever it likes -- so anything past
 * "is it an object" would be this module inventing a shape for someone else's
 * framework. The residual is documented in the README under Consumer Contracts.
 */
export function createLinkageFilter(request: unknown): LinkageFilter {
  if (typeof request !== 'object' || request === null) {
    log.error?.(`[@stonyx/orm] createLinkageFilter() was called with no request (received ${request === null ? 'null' : typeof request}) -- there is no caller to authorise against, so ALL relationship linkage it is asked about is denied.`);

    return function isLinkable(_type: string, _record: unknown): boolean {
      return false;
    };
  }

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
