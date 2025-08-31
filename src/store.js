import { relationships } from '@stonyx/orm';
import { TYPES } from './relationships.js';

export default class Store {
  constructor() {
    if (Store.instance) return Store.instance;
    Store.instance = this;

    this.data = new Map();
  }

  get(key, id) {
    if (!id) return this.data.get(key);

    return this.data.get(key)?.get(id);
  }

  set(key, value) {
    this.data.set(key, value);
  }

  remove(key, id) {
    if (id) return this.unloadRecord(key, id);

    this.unloadAllRecords(key);
  }

  unloadRecord(model, id) {
    const modelStore = this.data.get(model);
    const record = modelStore.get(id);

    record.unload();
    modelStore.delete(id);

    // TODO: Add logic to undo record-level relationships
  }

  unloadAllRecords(model) {
    for (const relationshipType of TYPES) relationships.get(relationshipType).delete(model);
    for (const record of this.data.get(model).values()) record.unload();

    this.data.get(model).clear();
  }
}
