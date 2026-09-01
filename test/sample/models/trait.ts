import { Model, attr, belongsTo } from '@stonyx/orm';

export default class TraitModel extends Model {
  type = attr('string');
  value = attr('string');
  category = belongsTo('category');
}
