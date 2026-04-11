import { pluralize as basePluralize } from '@stonyx/utils/string';

export function isDbError(error: unknown): error is { code: string; message: string } {
  return typeof error === 'object' && error !== null && 'code' in error && typeof (error as Record<string, unknown>).code === 'string' && 'message' in error && typeof (error as Record<string, unknown>).message === 'string';
}

// Wrapper to handle dasherized model names (e.g., "access-link" → "access-links")
export function pluralize(word: string): string {
  if (word.includes('-')) {
    const parts = word.split('-');
    const pluralizedLast = basePluralize(parts.pop()!);
    return [...parts, pluralizedLast].join('-');
  }

  return basePluralize(word);
}
