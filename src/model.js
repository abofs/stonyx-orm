import { attr } from '@stonyx/orm';

export default class BaseModel {
  id = attr('number');

  constructor(name) {
    this.__name = name;
  }
}
