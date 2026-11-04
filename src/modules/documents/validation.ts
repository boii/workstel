import { categories } from './types';
import type { DocumentInput } from './types';

export type DocumentField = 'title' | 'category' | 'url' | 'description' | 'departmentId';
export type ValidationError = 'required' | 'tooLong' | 'invalidUrl';

/** Same rule as the server: an https address without embedded credentials. */
export function isSafeLink(value: string) {
  const text = value.trim();
  if (text.length < 9 || text.length > 2048) return false;
  try {
    const url = new URL(text);
    return url.protocol === 'https:' && !!url.hostname && !url.username && !url.password;
  } catch {
    return false;
  }
}

export function validateDocument(input: DocumentInput) {
  const errors: Partial<Record<DocumentField, ValidationError>> = {};
  if (!input.title.trim()) errors.title = 'required';
  else if (input.title.trim().length > 150) errors.title = 'tooLong';
  if (!categories.includes(input.category)) errors.category = 'required';
  if (!input.url.trim()) errors.url = 'required';
  else if (!isSafeLink(input.url)) errors.url = 'invalidUrl';
  if (input.description.trim().length > 500) errors.description = 'tooLong';
  if (!input.departmentId) errors.departmentId = 'required';
  return errors;
}
