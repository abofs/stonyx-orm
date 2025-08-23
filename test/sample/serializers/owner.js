import { BaseSerializer } from '@stonyx/orm';

export default class OwnerSerializer extends BaseSerializer {
  map = {
    id: 'name',
    gender: 'sex',
  }
}
