import { Model, attr } from '@stonyx/orm';

export default class CategoryModel extends Model {
  id = attr('string'); // Override default number id to allow string ids
  name = attr('string');
}
