import { Model, attr, belongsTo } from '@stonyx/orm';

export default class TelegramLinkModel extends Model {
  static memory = true;

  id = attr('string');
  chatId = attr('string');

  user = belongsTo('user');
}
