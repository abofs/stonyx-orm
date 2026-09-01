import { pluralize as basePluralize } from '@stonyx/utils/string';
import type { OrmRecord } from './types/orm-types.js';

export function isDbError(error: unknown): error is { code: string; message: string } {
  return typeof error === 'object' && error !== null && 'code' in error && typeof (error as Record<string, unknown>).code === 'string' && 'message' in error && typeof (error as Record<string, unknown>).message === 'string';
}

export function isOrmRecord(value: unknown): value is OrmRecord {
  return typeof value === 'object' && value !== null && '__data' in value && '__relationships' in value;
}

// Wrapper to handle dasherized model names (e.g., "access-link" → "access-links")
export function pluralize(word: string): string {
  if (word.includes('-')) {
    const parts = word.split('-');
    const last = parts.pop() as string;
    const pluralizedLast = basePluralize(last);
    return [...parts, pluralizedLast].join('-');
  }

  return basePluralize(word);
}
