/**
 * Sample db schema for storage
 * Note: Schema definitions follow the same convention as the models as under the hood it is basically a model
 */

import { Model, hasMany } from '@stonyx/orm';

export default class DBModel extends Model {
  owners = hasMany('owner');
  animals = hasMany('animal');
  traits = hasMany('trait');
  categories = hasMany('category');
  phoneNumbers = hasMany('phone-number');
}
