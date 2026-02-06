import { Model, attr, belongsTo } from '@stonyx/orm';

export default class PhoneNumberModel extends Model {
  id = attr('string');
  areaCode = attr('number');
  owner = belongsTo('owner');
}
