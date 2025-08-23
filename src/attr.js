import ModelProperty from './model-property.js';

export default function attr() {
  const modelProp = new ModelProperty(...arguments);

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
