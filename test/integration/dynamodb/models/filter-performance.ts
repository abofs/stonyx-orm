import { Model, attr } from '@stonyx/orm';

export default class FilterPerformanceModel extends Model {
  static memory = false;

  // numeric id — tests ULID generation
  id = attr('number');
  filterName = attr('string');
  accuracy = attr('number');
}
