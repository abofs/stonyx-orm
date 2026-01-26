import { Serializer } from '@stonyx/orm';

export default class OwnerSerializer extends Serializer {
  map = {
    id: 'name',
    gender: 'sex',
  }
}
