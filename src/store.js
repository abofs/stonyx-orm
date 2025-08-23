export default class Store {
  constructor() {
    if (Store.instance) return Store.instance;
    Store.instance = this;

    this.data = new Map();
  }

  get(key) {
    return this.data.get(key);
  }

  set(key, value) {
    this.data.set(key, value);
  }
}
