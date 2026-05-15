import { Model, attr, belongsTo, hasMany } from '@stonyx/orm';

export default class AlertModel extends Model {
  static memory = true;

  // numeric id — tests ULID generation
  id = attr('number');
  message = attr('string');
  status = attr('string');

  user = belongsTo('user');
  alertResults = hasMany('alert-result');
}
