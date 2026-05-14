import { Model, attr, belongsTo } from '@stonyx/orm';

export default class SessionModel extends Model {
  static memory = true;

  id = attr('string');
  token = attr('string');

  user = belongsTo('user');
}
