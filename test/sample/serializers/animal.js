import { Serializer } from '@stonyx/orm';

const COLOR_TRAIT_MAP = {
  'black': 2,
  'white': 3,
}

export default class AnimalSerializer extends Serializer {
  map = {
    age: 'details.age',
    size: 'details.c',
    color: 'details.x',
    owner: 'details.location.owner',

    // If value is array, serializer supports a custom handler, or a query lookup as the second parameter
    traits: ['details', ({ x:color }) => { // Hardcoding habitat for sample simplicity
      const traits = [{ id: 1, type: 'habitat', value: 'farm', category: 'physical' }];

      // Add color trait if applicable
      const id = COLOR_TRAIT_MAP[color];
      if (id) traits.push({ id, type: 'color', value: color, category: 'appearance' });

      return traits;
    }]
  }
}
