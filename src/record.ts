import { store } from '@stonyx/orm';
import { getComputedProperties } from "./serializer.js";
import { camelCaseToKebabCase } from '@stonyx/utils/string';
import { getPluralName } from './plural-registry.js';
import type Serializer from './serializer.js';

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
   */
  linkage?: (type: string, record: unknown) => boolean;
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

    for (const [key, childRecord] of Object.entries(this.__relationships)) {
      if (fields && !fields.has(key)) continue;

      // The linkage decision is applied HERE, alongside the existing
      // `__model` liveness check, and it produces exactly the shapes that
      // check already produces: a dropped hasMany member leaves `data: []`,
      // a dropped belongsTo leaves `data: null`. Both already ship -- a
      // genuinely-empty hasMany emits `data: []` with links, and a cleaned
      // belongsTo emits `data: null` -- so a filtered relationship is
      // BYTE-IDENTICAL to an empty one and there is no new wire shape and no
      // oracle. It never throws: a throw here escapes the enclosing
      // `JSON.stringify` and takes `console.log` and `Orm.db.save()`'s
      // neighbours with it, which is a far worse failure mode than a status.
      const isLinkable = (r: Record) => !linkage || linkage(r.__model.__name, r);

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
