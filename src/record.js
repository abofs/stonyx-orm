import { store } from './index.js';
import { getComputedProperties } from "./serializer.js";
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
  toJSON() {
    if (!this.__serialized) throw new Error('Record must be serialized before being converted to JSON');
    
    const { __data:data } = this;
    const relationships = {};
    const attributes = { ...data };
    delete attributes.id;

    for (const [key, getter] of getComputedProperties(this.__model)) {
      attributes[key] = getter.call(this);
    }

    for (const [ key, childRecord ] of Object.entries(this.__relationships)) {
      relationships[key] = {
        data: Array.isArray(childRecord) 
        ? childRecord.map(r => ({ type: r.__model.__name, id: r.id }))
        : childRecord ? { type: childRecord.__model.__name, id: childRecord.id } : null
      };
    }

    return {
      attributes,
      relationships,
      id: data.id,
      type: this.__model.__name,
    };
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
