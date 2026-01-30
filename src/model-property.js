import Orm from '@stonyx/orm';

function validType(type) {
  return Object.keys(Orm.instance.transforms).includes(type);
}

export default class ModelProperty {
  constructor(type='passthrough', defaultValue) {
    if (!validType(type)) throw new Error(`Invalid model property type: ${type}`);
    
    this.type = type;
    this.value = defaultValue;
  }

  get value() {
    return this._value;
  }

  set value(newValue) {
    if (this.ignoreFirstTransform) {
      delete this.ignoreFirstTransform;
      return this._value = newValue;
    }

    if (newValue === undefined || newValue === null) return;

    this._value = Orm.instance.transforms[this.type](newValue);
  }
}
