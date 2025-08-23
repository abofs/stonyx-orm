import { BaseModel, attr, belongsTo } from '@stonyx/orm';

export default class AnimalModel extends BaseModel {
  type = attr('animal-code');
  age = attr('number');
  size = attr('string');
  owner = belongsTo('owner');

  get tag() {
    const { owner, size } = this;

    return `${owner.id}'s ${size} ${this.type}`;
  }
}
