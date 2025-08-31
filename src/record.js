export default class Record {
  __data = {};
  __relationships = {};
  __serialized = false;

  constructor(model, serializer) {
    this.__model = model;
    this.__serializer = serializer;
  }

  serialize(rawData, options) {
    const { __data:data } = this;
    
    if (this.__serialized) {
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

  // Delete every key to prevent memory leaks from loose references
  unload() {
    try {
      for (const key of Object.keys(this)) delete this[key];
    } catch {
      // Ignore errors during unload, as some keys may not be deletable
    }
  }
}
