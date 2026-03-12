import { attr } from '@stonyx/orm';

export default class View {
  static memory = false;
  static readOnly = true;
  static pluralName = undefined;
  static source = undefined;
  static resolve = undefined;

  id = attr('number');

  constructor(name) {
    this.__name = name;

    // Enforce readOnly — cannot be overridden to false
    if (this.constructor.readOnly !== true) {
      throw new Error(`View '${name}' cannot override readOnly to false`);
    }
  }
}
