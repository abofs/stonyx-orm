import { Model, attr } from '@stonyx/orm';

export default class UserProfileModel extends Model {
  id = attr('number');
  name = attr('string');
  email = attr('string');
}
