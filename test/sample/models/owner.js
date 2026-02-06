import { Model, attr, hasMany } from '@stonyx/orm';

export default class OwnerModel extends Model {
  id = attr('string');
  gender = attr('string');
  age = attr('number');
  pets = hasMany('animal');
  phoneNumbers = hasMany('phone-number');

  get totalPets() {
    return this.pets.length;
  }
}
