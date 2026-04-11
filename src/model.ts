import attr from './attr.js';

export default class Model {
  /**
   * Controls whether records of this model are loaded into memory on startup.
   *
   * - true  → loaded on boot, kept in store
   * - false → never cached; find() always queries MySQL (default)
   *
   * Override in subclass: static memory = true;
   */
  static memory: boolean = false;
  static pluralName: string | undefined = undefined;

  id = attr('number');
  __name: string;

  constructor(name: string) {
    this.__name = name;
  }
}
