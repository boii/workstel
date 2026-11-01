import { departmentIds } from './types';
import type { VaultEntryInput, VaultField, VaultValidationError } from './types';
export function validateEntry(
  input: VaultEntryInput,
): Partial<Record<VaultField, VaultValidationError>> {
  const errors: Partial<Record<VaultField, VaultValidationError>> = {};
  for (const field of ['name', 'username'] as const) {
    if (!input[field].trim()) errors[field] = 'required';
    else if (input[field].length > 150) errors[field] = 'tooLong';
  }
  if (!departmentIds.includes(input.departmentId)) errors.departmentId = 'required';
  if (input.notes.length > 1000) errors.notes = 'tooLong';
  if (input.website) {
    try {
      const url = new URL(input.website);
      if (url.protocol !== 'https:' || url.username || url.password) errors.website = 'invalidUrl';
    } catch {
      errors.website = 'invalidUrl';
    }
    if (input.website.length > 2048) errors.website = 'tooLong';
  }
  return errors;
}
export function normalizeEntry(input: VaultEntryInput): VaultEntryInput {
  return {
    name: input.name.trim(),
    username: input.username.trim(),
    website: input.website.trim(),
    notes: input.notes.trim(),
    departmentId: input.departmentId,
  };
}
