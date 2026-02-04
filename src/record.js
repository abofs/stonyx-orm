import { store } from './index.js';
import { getComputedProperties } from "./serializer.js";
import { pluralize, camelCaseToKebabCase } from '@stonyx/utils/string';
export default class Record {
  __data = {};
  __relationships = {};
  __serialized = false;

  constructor(model, serializer) {
    this.__model = model;
    this.__serializer = serializer;
  }

  serialize(rawData, options={}) {
    const { __data:data } = this;
    
    if (this.__serialized && !options.update) {
      const relatedIds = {};

      for (const [ key, childRecord ] of Object.entries(this.__relationships)) {
        relatedIds[key] = Array.isArray(childRecord) 
        ? childRecord.map(r => r.id)
        : childRecord?.id ?? null;
      }

      return { ...data, ...relatedIds };
    }

    const normalizedData = this.__serializer.normalize(rawData);
    this.__serializer.setProperties(normalizedData, this, options);

    return data;
  }

  // Similar to serialize, but preserves top level relationship records
  format() {
    if (!this.__serialized) throw new Error('Record must be serialized before being converted to JSON');
    
    const { __data:data } = this;
    const records = {};

    for (const [ key, childRecord ] of Object.entries(this.__relationships)) {
      records[key] = Array.isArray(childRecord) 
      ? childRecord.map(r => r.serialize())
      : childRecord?.serialize() ?? null;
    }

    return { ...data, ...records };
  }

  // Formats record for JSON API output
  toJSON(options = {}) {
    if (!this.__serialized) throw new Error('Record must be serialized before being converted to JSON');

    const { fields, baseUrl } = options;
    const { __data:data } = this;
    const modelName = this.__model.__name;
    const pluralizedModelName = pluralize(modelName);
    const recordId = data.id;
    const relationships = {};
    const attributes = {};

    for (const [key, value] of Object.entries(data)) {
      if (key === 'id') continue;
      if (fields && !fields.has(key)) continue;
      attributes[key] = value;
    }

    for (const [key, getter] of getComputedProperties(this.__model)) {
      if (fields && !fields.has(key)) continue;
      attributes[key] = getter.call(this);
    }

    for (const [key, childRecord] of Object.entries(this.__relationships)) {
      if (fields && !fields.has(key)) continue;
      const relationshipData = Array.isArray(childRecord)
        ? childRecord.map(r => ({ type: r.__model.__name, id: r.id }))
        : childRecord ? { type: childRecord.__model.__name, id: childRecord.id } : null;

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

    const result = {
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

  unload(options={}) {
    store.unloadRecord(this.__model.__name, this.id, options);
  }

  clean() {
    try {
      for (const key of Object.keys(this)) {
        delete this[key];
      }
    } catch {
      // Ignore errors during cleanup, as some keys may not be deletable
    }
  }
}
