import { Model, attr, belongsTo } from '@stonyx/orm';

export default class AuthProviderModel extends Model {
  static memory = true;

  id = attr('string');
  provider = attr('string');

  user = belongsTo('user');
}
