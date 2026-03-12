import { View, attr, belongsTo, count } from '@stonyx/orm';

export default class OwnerAnimalCountView extends View {
  static source = 'owner';

  id = attr('string');
  animalCount = count('pets');
  owner = belongsTo('owner');
}
