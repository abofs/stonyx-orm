import DB from "@stonyx/orm/db";

export default class Record {
  __data = {};
  __relationships = {};
  __serialized = false;

  constructor(model, serializer) {
    this.__model = model;
    this.__serializer = serializer;
  }

  serialize(rawData) {
    const { __data:data } = this;
    
    if (this.__serialized) {
      const relatedIds = {};

      for (const [ key, childRecord ] of Object.entries(this.__relationships)) {
        relatedIds[key] = Array.isArray(childRecord) 
        ? childRecord.map(r => r.id._value)
        : childRecord?.id?._value ?? null;
      }

      return { ...data, ...relatedIds };
    }

    const normalizedData = this.__serializer.normalize(rawData);
    this.__serializer.setProperties(normalizedData, this);

    return data;
  }

  save() {
    const { __name:key } = this.__model;
    
    new DB().data[key] = this.serialize();
  }
}
