import { attr } from '@stonyx/orm';

export default class Model {
  id = attr('number');

  constructor(name) {
    this.__name = name;
  }
}
