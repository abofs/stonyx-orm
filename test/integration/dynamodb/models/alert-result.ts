import { Model, attr, belongsTo } from '@stonyx/orm';

export default class AlertResultModel extends Model {
  static memory = false;

  // numeric id — tests ULID generation
  id = attr('number');
  outcome = attr('string');

  alert = belongsTo('alert');
}
