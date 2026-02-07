import { Model, attr, belongsTo, hasMany } from '@stonyx/orm';
import { ANIMALS } from '../constants.js';

export default class AnimalModel extends Model {
  type = attr('animal');
  age = attr('number');
  size = attr('string');

  owner = belongsTo('owner');
  traits = hasMany('trait');

  get tag() {
    const { owner, size } = this;

    if (!owner) {
      return `Unowned ${size} ${ANIMALS[this.type]}`;
    }

    return `${owner.id}'s ${size} ${ANIMALS[this.type]}`;
  }
}
