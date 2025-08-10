import DB from "@stonyx/orm/db";

export default class Record {
  __data = {};
  __serialized = false;

  constructor(model, serializer) {
    this.__model = model;
    this.__serializer = serializer;
  }

  serialize(rawData) {
    const { __data:data } = this;
    
    if (this.__serialized)  return data;

    const normalizedData = this.__serializer.normalize(rawData);
    this.__serializer.setProperties(normalizedData, this);

    return data;
  }

  save() {
    const { __name:key } = this.__model;
    
    new DB().data[key] = this.serialize();
  }
}
