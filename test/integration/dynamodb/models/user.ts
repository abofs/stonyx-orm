import { Model, attr, hasMany } from '@stonyx/orm';

export default class UserModel extends Model {
  static memory = true;

  id = attr('string');
  name = attr('string');
  email = attr('string');

  sessions = hasMany('session');
  alerts = hasMany('alert');
}
