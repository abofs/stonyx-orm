import ModelProperty from './model-property.js';

export default function attr(type?: string, defaultValue?: unknown): ModelProperty {
  const modelProp = new ModelProperty(type, defaultValue);

  return new Proxy(modelProp, {
    get(target, prop, receiver) {
      if (prop === 'valueOf' || prop === 'toString') {
        return () => target.value;
      }

      if (prop in target) {
        return Reflect.get(target, prop, receiver);
      }

      return target.value;
    },

    set(target, prop, value, receiver) {
      if (prop === 'value') {
        target.value = value;
        return true;
      }

      return Reflect.set(target, prop, value, receiver);
    }
  });
}
