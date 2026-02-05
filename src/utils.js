import { pluralize as basePluralize } from '@stonyx/utils/string';

export function pluralize(word) {
  if (word.includes('-')) {
    const parts = word.split('-');
    const pluralizedLast = basePluralize(parts.pop());

    return [...parts, pluralizedLast].join('-');
  }

  return basePluralize(word);
}
