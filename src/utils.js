import { pluralize as basePluralize } from '@stonyx/utils/string';

// Wrapper to handle dasherized model names (e.g., "access-link" → "access-links")
export function pluralize(word) {
  if (word.includes('-')) {
    const parts = word.split('-');
    const pluralizedLast = basePluralize(parts.pop());
    return [...parts, pluralizedLast].join('-');
  }

  return basePluralize(word);
}
