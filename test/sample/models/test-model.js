import { Model, attr, belongsTo } from '@stonyx/orm';

export default class TestModelModel extends Model {
  id = attr('string');
  label = attr('string');
  owner = belongsTo('owner');
}
