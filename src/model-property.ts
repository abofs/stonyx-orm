import Orm from '@stonyx/orm';

function validType(type: string): boolean {
  return Object.keys(Orm.instance.transforms).includes(type);
}

export default class ModelProperty {
  type: string;
  _value: unknown;
  ignoreFirstTransform?: boolean;

  constructor(type: string = 'passthrough', defaultValue?: unknown) {
    if (!validType(type)) throw new Error(`Invalid model property type: ${type}`);

    this.type = type;
    this.value = defaultValue;
  }

  get value(): unknown {
    return this._value;
  }

  set value(newValue: unknown) {
    if (this.ignoreFirstTransform) {
      delete this.ignoreFirstTransform;
      this._value = newValue;
      return;
    }

    if (newValue === undefined) return;

    this._value = newValue === null ? null : Orm.instance.transforms[this.type](newValue);
  }
}
