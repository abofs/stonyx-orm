import { store } from '@stonyx/orm';
import { getComputedProperties } from "./serializer.js";
import { camelCaseToKebabCase } from '@stonyx/utils/string';
import { getPluralName } from './plural-registry.js';
import type Serializer from './serializer.js';

interface ToJSONOptions {
  fields?: Set<string>;
  baseUrl?: string;
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
        // Deduplicate by record ID — keep last occurrence (latest data wins)
        const seen = new Set<unknown>();
        const unique: Record[] = [];

        for (let i = childRecord.length - 1; i >= 0; i--) {
          const r = childRecord[i] as Record;
          if (!seen.has(r.id)) {
            seen.add(r.id);
            unique.push(r);
          }
        }

        unique.reverse();
        records[key] = unique.map((r: Record) => r.serialize());
      } else {
        records[key] = (childRecord as Record)?.serialize() ?? null;
      }
    }

    return { ...data, ...records };
  }

  // Formats record for JSON API output
  toJSON(options: ToJSONOptions = {}): JSONAPIResult {
    if (!this.__serialized) throw new Error('Record must be serialized before being converted to JSON');

    const { fields, baseUrl } = options;
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

      const relationshipData = Array.isArray(childRecord)
        ? childRecord.map((r: Record) => ({ type: r.__model.__name, id: r.id }))
        : childRecord ? { type: (childRecord as Record).__model.__name, id: (childRecord as Record).id } : null;

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
