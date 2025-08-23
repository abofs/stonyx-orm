import { BaseModel, attr, belongsTo } from '@stonyx/orm';
import { ANIMAL_CODES } from '../constants.js';

export default class AnimalModel extends BaseModel {
  type = attr('animal-code');
  age = attr('number');
  size = attr('string');
  owner = belongsTo('owner');

  get tag() {
    const { owner, size } = this;

    return `${owner.id}'s ${size} ${ANIMAL_CODES[this.type]}`;
  }
}
