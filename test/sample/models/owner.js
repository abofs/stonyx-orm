
import { BaseModel, attr, hasMany } from '@stonyx/orm';

export default class OwnerModel extends BaseModel {
  id = attr('string');
  gender = attr('string');
  age = attr('number');
  pets = hasMany('animal');

  get totalPets() {
    return this.pets.length;
  }
}
