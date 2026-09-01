import { store } from '@stonyx/orm';
import log from 'stonyx/log';
import { getComputedProperties } from "./serializer.js";
import { camelCaseToKebabCase } from '@stonyx/utils/string';
import { getPluralName } from './plural-registry.js';
import type Serializer from './serializer.js';
import type { LinkageFilter } from './types/orm-types.js';

interface ToJSONOptions {
  fields?: Set<string>;
  baseUrl?: string;
  /**
   * An ALREADY-RESOLVED linkage decision, supplied by a caller that holds the
   * request (abofs/stonyx-orm#234). Returning `false` for a related record
   * drops that record's `{ type, id }` from `relationships.*.data`.
   *
   * This method APPLIES a verdict; it never RESOLVES one -- see
   * `src/access-verdict.ts` for the two measured reasons it cannot. ABSENT is
   * the default and the default is TODAY'S DOCUMENT, unchanged, because
   * `toJSON` is also the `JSON.stringify` hook and an implicit caller has no
   * syntactic place to pass this (abofs/stonyx-orm#230).
   *
   * ABSENT and UNUSABLE are read differently, and the difference is a security
   * decision -- see the three-way reading at the call site below.
   */
  linkage?: LinkageFilter;
}

interface SerializeOptions {
  update?: boolean;
  serialize?: boolean;
  transform?: boolean;
  [key: string]: unknown;
}

interface UnloadOptions {
  [key: string]: unknown;
}

interface RelationshipLinks {
  self: string;
  related: string;
}

interface RelationshipEntry {
  data: { type: string; id: unknown } | { type: string; id: unknown }[] | null;
  links?: RelationshipLinks;
}

interface JSONAPIResult {
  attributes: { [key: string]: unknown };
  relationships: { [key: string]: RelationshipEntry };
  id: unknown;
  type: string;
  links?: { self: string };
}


/**
 * Name a non-boolean `linkage` return for the one log line that reports it.
 *
 * A thenable is called out BY NAME because it is the shape a consumer produces
 * by accident -- an `async` resolver, or one that returns the promise of an
 * authorization lookup -- and the one whose truthiness silently GRANTED every
 * relationship before the ANSWER was checked (abofs/stonyx-orm#234).
 */
function describeNonVerdict(verdict: unknown): string {
  if (verdict === null) return 'null';
  if (Array.isArray(verdict)) return 'an array';

  if ((typeof verdict === 'object' || typeof verdict === 'function')
    && typeof (verdict as { then?: unknown }).then === 'function') return 'a Promise (or other thenable)';

  return `a value of type ${typeof verdict}`;
}

export default class Record {
  /** @private */
  __data: { [key: string]: unknown } = {};
  /** @private */
  __relationships: { [key: string]: unknown } = {};
  /** @private */
  __serialized = false;
  /** @private */
  __model: { __name: string; [key: string]: unknown };
  /** @private */
  __serializer: Serializer;

  [key: string]: unknown;

  constructor(model: { __name: string; [key: string]: unknown }, serializer: Serializer) {
    this.__model = model;
    this.__serializer = serializer;
  }

  serialize(rawData?: unknown, options: SerializeOptions = {}): { [key: string]: unknown } {
    const { __data: data } = this;

    if (this.__serialized && !options.update) {
      const relatedIds: { [key: string]: unknown } = {};

      for (const [key, childRecord] of Object.entries(this.__relationships)) {
        relatedIds[key] = Array.isArray(childRecord)
          ? childRecord.map((r: Record) => r.id)
          : (childRecord as Record)?.id ?? null;
      }

      return { ...data, ...relatedIds };
    }

    const normalizedData = this.__serializer.normalize(rawData);
    this.__serializer.setProperties(normalizedData, this, options);

    return data;
  }

  // Similar to serialize, but preserves top level relationship records
  format(): { [key: string]: unknown } {
    if (!this.__serialized) throw new Error('Record must be serialized before being converted to JSON');

    const { __data: data } = this;
    const records: { [key: string]: unknown } = {};

    for (const [key, childRecord] of Object.entries(this.__relationships)) {
      if (Array.isArray(childRecord)) {
        // Filter out cleaned records (those with no __model)
        const live = childRecord.filter((r: Record) => r?.__model);

        // Deduplicate by record ID — keep last occurrence (latest data wins)
        const seen = new Set<unknown>();
        const unique: Record[] = [];

        for (let i = live.length - 1; i >= 0; i--) {
          const r = live[i] as Record;
          if (!seen.has(r.id)) {
            seen.add(r.id);
            unique.push(r);
          }
        }

        unique.reverse();
        records[key] = unique.map((r: Record) => r.serialize());
      } else {
        records[key] = (childRecord as Record)?.__model ? (childRecord as Record).serialize() : null;
      }
    }

    return { ...data, ...records };
  }

  // Formats record for JSON API output
  toJSON(options: ToJSONOptions = {}): JSONAPIResult {
    if (!this.__serialized) throw new Error('Record must be serialized before being converted to JSON');

    // DESTRUCTURED FROM A VALUE THAT IS NOT ALWAYS AN OBJECT. `toJSON` is the
    // ECMAScript serialization hook, so `JSON.stringify({ data: record })`
    // arrives here as `toJSON('data')` -- a STRING in the options slot.
    // Destructuring a string yields `undefined` for every key, which is exactly
    // the no-argument default, so the implicit path keeps working and keeps
    // emitting today's document (abofs/stonyx-orm#230).
    const { fields, baseUrl, linkage } = options;
    const { __data: data } = this;
    const modelName = this.__model.__name;
    const pluralizedModelName = getPluralName(modelName);
    const recordId = data.id;
    const relationships: { [key: string]: RelationshipEntry } = {};
    const attributes: { [key: string]: unknown } = {};

    for (const [key, value] of Object.entries(data)) {
      if (key === 'id') continue;
      if (fields && !fields.has(key)) continue;
      attributes[key] = value;
    }

    for (const [key, getter] of getComputedProperties(this.__model)) {
      if (fields && !fields.has(key)) continue;
      attributes[key] = (getter as () => unknown).call(this);
    }

    // `linkage` is a PUBLIC option -- it is on `OrmRecord.toJSON`
    // (src/types/orm-types.ts) and the README tells consumers to pass one -- so
    // it arrives from outside this package, may be ANY value, and whatever it
    // is, it gets INVOKED here. That makes this the trust boundary, and it was
    // the LAX side of one: the internal `createLinkageFilter` coerces and
    // try/catches the consumer predicate it wraps, while this -- the site that
    // consumes the PUBLIC option -- did neither.
    //
    // THREE QUESTIONS. Every wrong answer below was measured, on a two-
    // relationship record, emitting the full pre-#234 document or throwing out
    // of `JSON.stringify`.
    //
    //   1. IS IT SUPPLIED? ABSENT (`undefined`) means no verdict was supplied:
    //      emit today's document. Load-bearing and asserted (AC5/AC5b) --
    //      `toJSON` is also the `JSON.stringify` hook, so the implicit caller
    //      arrives as `toJSON('data')`, a STRING, which destructures to
    //      `undefined` here (abofs/stonyx-orm#230).
    //
    //   2. IS ITS SHAPE USABLE? `[object Function]` only, because
    //      `typeof x === 'function'` is NOT the question "can this answer a
    //      synchronous boolean".
    //
    //      A NON-FUNCTION denies. Reading it as absent is what `!linkage ||`
    //      did, and a resolver returning `null` because it could not resolve a
    //      session is the natural shape of that value and the fail-closed
    //      INTENT -- measured, `toJSON({ linkage: null })` emitted the full
    //      pre-#234 linkage with no signal, byte-identical to unpatched dev.
    //
    //      AN `AsyncFunction`, `GeneratorFunction` or `AsyncGeneratorFunction`
    //      denies for that SAME reason, one branch over -- and a `typeof`-only
    //      check left the whole defect standing there. `async (type, r) =>
    //      false` returns a PROMISE, a promise is TRUTHY, so every relationship
    //      was emitted in full with ZERO log, again byte-identical to unpatched
    //      dev. An awaited authorization lookup is at least as natural a
    //      resolver as a nullish one -- the README's own Consumer Contracts
    //      section points consumers at queue payloads and websocket frames,
    //      where lookups are routinely awaited -- and it landed on the GRANT
    //      side of the same branch the `null` reading closed.
    //
    //   3. IS ITS ANSWER A VERDICT? It must BE a boolean, not merely coerce to
    //      one. `Boolean(...)` -- the coercion `createLinkageFilter` applies to
    //      a consumer `access()` predicate, whose truthy contract predates this
    //      option and is deliberately NOT changed -- is not enough here, and
    //      was measured not to be: with `Boolean(...)` plus a try/catch in
    //      place, `async () => false`, `function* () {}`,
    //      `() => Promise.resolve(false)`, `() => ({})` and `() => 'no'` ALL
    //      still emitted the full pre-#234 linkage with no log, because
    //      truthiness is what they already had. A non-boolean is a resolver
    //      that did not answer, and the only safe reading of a non-answer is a
    //      denial.
    //
    // AND IT NEVER THROWS -- which is now true rather than only written down.
    // A throw here escapes the enclosing `JSON.stringify` and takes
    // `console.log` and `Orm.db.save()`'s neighbours with it, a far worse
    // failure mode than a status. `class Klass {}`, `Klass.bind(null)` and any
    // predicate that dereferences something undefined were all measured raising
    // out of the `stringify`; all three are caught and denied.
    //
    // Logged once per DOCUMENT, not once per relationship key or per related
    // record: an emptied relationship is deliberately indistinguishable from a
    // genuinely empty one on the wire, so the log is the ONLY signal a consumer
    // whose resolver quietly returned `null`, or a promise, will ever get.
    const linkageSupplied = linkage !== undefined;

    // Read the tag DEFENSIVELY. `Object.prototype.toString` consults
    // `Symbol.toStringTag`, so a Proxy with a throwing `get` trap would throw
    // out of the validation whose entire job is that nothing throws.
    let linkageShape = 'a non-function';

    if (typeof linkage === 'function') {
      try {
        linkageShape = Object.prototype.toString.call(linkage);
      } catch {
        linkageShape = '[object Unreadable]';
      }
    }

    const linkageUsable = linkageShape === '[object Function]';

    let linkageReported = false;

    const denyAllLinkage = (reason: string) => {
      if (linkageReported) return;
      linkageReported = true;

      log.error?.(`[@stonyx/orm] toJSON() received an unusable \`linkage\` option -- ${reason}, so ALL relationship linkage on this \`${modelName}\` document is denied.`);
    };

    if (linkageSupplied && !linkageUsable) {
      denyAllLinkage(typeof linkage !== 'function'
        ? `it is of type ${linkage === null ? 'null' : typeof linkage} and it must be a function`
        : `it is ${linkageShape} and it must be a SYNCHRONOUS function -- \`toJSON\` is the \`JSON.stringify\` hook and cannot await a verdict`);
    }

    const linkageVerdict: LinkageFilter | undefined = !linkageSupplied
      ? undefined
      : linkageUsable ? linkage as LinkageFilter : () => false;

    // Applied per related record, alongside the existing `__model` liveness
    // check, and producing exactly the shapes that check already produces: a
    // dropped hasMany member leaves `data: []`, a dropped belongsTo leaves
    // `data: null`. Both already ship -- a genuinely-empty hasMany emits
    // `data: []` with links, and a cleaned belongsTo emits `data: null` -- so a
    // filtered relationship is BYTE-IDENTICAL to an empty one and there is no
    // new wire shape and no oracle.
    const isLinkable = (r: Record): boolean => {
      if (!linkageVerdict) return true;

      try {
        const verdict = linkageVerdict(r.__model.__name, r);

        if (typeof verdict === 'boolean') return verdict;

        denyAllLinkage(`it answered with ${describeNonVerdict(verdict)} rather than a boolean`);
      } catch (error) {
        // Building the report is itself a throw site -- `throw Symbol('x')`
        // makes `String(error)` throw, and a getter on `.message` can throw --
        // and a throw from the reporter would escape the catch that exists so
        // that nothing escapes.
        let detail = 'a value that could not be described';

        try {
          detail = error instanceof Error ? error.message : String(error);
        } catch { /* keep the fallback -- the denial matters, the text does not */ }

        denyAllLinkage(`it threw (${detail})`);
      }

      return false;
    };

    for (const [key, childRecord] of Object.entries(this.__relationships)) {
      if (fields && !fields.has(key)) continue;

      const relationshipData = Array.isArray(childRecord)
        ? childRecord.filter((r: Record) => r?.__model).filter(isLinkable).map((r: Record) => ({ type: r.__model.__name, id: r.id }))
        : (childRecord && (childRecord as Record).__model && isLinkable(childRecord as Record)) ? { type: (childRecord as Record).__model.__name, id: (childRecord as Record).id } : null;

      // Dasherize the key for URL paths (e.g., accessLinks -> access-links)
      const dasherizedKey = camelCaseToKebabCase(key);

      relationships[dasherizedKey] = { data: relationshipData };

      // Add links to relationship if baseUrl provided
      if (baseUrl) {
        relationships[dasherizedKey].links = {
          self: `${baseUrl}/${pluralizedModelName}/${recordId}/relationships/${dasherizedKey}`,
          related: `${baseUrl}/${pluralizedModelName}/${recordId}/${dasherizedKey}`
        };
      }
    }

    const result: JSONAPIResult = {
      attributes,
      relationships,
      id: recordId,
      type: modelName,
    };

    // Add resource links if baseUrl provided
    if (baseUrl) {
      result.links = {
        self: `${baseUrl}/${pluralizedModelName}/${recordId}`
      };
    }

    return result;
  }

  unload(options: UnloadOptions = {}): void {
    store.unloadRecord(this.__model.__name, this.id, options);
  }

  clean(): void {
    try {
      for (const key of Object.keys(this)) {
        delete this[key];
      }
    } catch {
      // Ignore errors during cleanup, as some keys may not be deletable
    }
  }
}
