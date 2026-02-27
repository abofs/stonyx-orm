import { attr } from '@stonyx/orm';

export default class Model {
  /**
   * Controls whether records of this model are loaded into memory on startup.
   *
   * - true  → loaded on boot, kept in store (default for backward compatibility)
   * - false → never cached; find() always queries MySQL
   *
   * Override in subclass: static memory = false;
   */
  static memory = true;

  id = attr('number');

  constructor(name) {
    this.__name = name;
  }
}
