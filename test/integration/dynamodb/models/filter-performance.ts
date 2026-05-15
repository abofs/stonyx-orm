import { Model, attr } from '@stonyx/orm';

export default class FilterPerformanceModel extends Model {
  static memory = false;

  id = attr('string');
  filterName = attr('string');
  accuracy = attr('number');
}
