import { attr } from '@stonyx/orm';

export default class Model {
  /**
   * Controls whether records of this model are loaded into memory on startup.
   *
   * - true  → loaded on boot, kept in store
   * - false → never cached; find() always queries MySQL (default)
   *
   * Override in subclass: static memory = true;
   */
  static memory = false;
  static pluralName = undefined;

  id = attr('number');

  constructor(name) {
    this.__name = name;
  }
}
