import { Model, attr, belongsTo } from '@stonyx/orm';

export default class TraitModel extends Model {
  type = attr('string');
  value = attr('string');
  category = belongsTo('category');

  // abofs/stonyx-orm#240, fixture 2. `tag` is claimed by NO access class, so it
  // has no route of its own — this relationship is the ONLY way to reach it.
  // Attached here rather than to `animal` because three assertions in
  // test/unit/linkage-verdict-test.ts pin an animal document byte-for-byte.
  tag = belongsTo('tag');
}
