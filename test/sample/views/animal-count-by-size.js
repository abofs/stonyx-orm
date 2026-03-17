import { View, attr, count, avg } from '@stonyx/orm';

export default class AnimalCountBySizeView extends View {
  static source = 'animal';
  static groupBy = 'size';

  id = attr('string');
  animalCount = count();
  averageAge = avg('age');
}
