import { Model, attr } from '@stonyx/orm';

export default class TraitModel extends Model {
  type = attr('string');
  value = attr('string');
}
