import attr from './attr.js';

export default class View {
  static memory: boolean = false;
  static readOnly: boolean = true;
  static pluralName: string | undefined = undefined;
  static source: string | undefined = undefined;
  static groupBy: string | undefined = undefined;
  static resolve: ((record: unknown) => unknown) | undefined = undefined;

  id = attr('number');
  __name: string;

  constructor(name: string) {
    this.__name = name;

    // Enforce readOnly — cannot be overridden to false
    if ((this.constructor as typeof View).readOnly !== true) {
      throw new Error(`View '${name}' cannot override readOnly to false`);
    }
  }
}
