import ModelProperty from './model-property.js';

// TODO: Change to proxy
export default function attr() {
  return new ModelProperty(...arguments);
}