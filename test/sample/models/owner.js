import { Model, attr, hasMany } from '@stonyx/orm';

export default class OwnerModel extends Model {
  id = attr('string');
  gender = attr('string');
  age = attr('number');
  pets = hasMany('animal');
  testModels = hasMany('test-model');

  get totalPets() {
    return this.pets.length;
  }
}
