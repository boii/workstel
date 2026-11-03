import { stockUnits } from './types';
import type { EntryType, StockItem, StockItemInput, StockLevel } from './types';

export type ItemField = 'code' | 'name' | 'unit' | 'location' | 'minQuantity' | 'departmentId';
export type EntryField = 'quantity' | 'reference' | 'notes';
export type ValidationError =
  'required' | 'tooLong' | 'invalidCode' | 'invalidQuantity' | 'insufficientStock' | 'noChange';

const quantityPattern = /^\d{1,11}(\.\d{1,3})?$/;

/** Parse a quantity typed with either a dot or a comma decimal separator. */
export function parseQuantity(text: string): number | undefined {
  const value = text.trim().replace(',', '.');
  return quantityPattern.test(value) ? Number(value) : undefined;
}

export function normalizeCode(value: string) {
  return value.trim().toUpperCase();
}

export function validateItem(input: Omit<StockItemInput, 'minQuantity'> & { minQuantity: string }) {
  const errors: Partial<Record<ItemField, ValidationError>> = {};
  const code = normalizeCode(input.code);
  if (!code) errors.code = 'required';
  else if (!/^[A-Z0-9][A-Z0-9._-]{0,29}$/.test(code)) errors.code = 'invalidCode';
  if (!input.name.trim()) errors.name = 'required';
  else if (input.name.trim().length > 150) errors.name = 'tooLong';
  if (!stockUnits.includes(input.unit)) errors.unit = 'required';
  if (input.location.trim().length > 100) errors.location = 'tooLong';
  if (input.minQuantity.trim() && parseQuantity(input.minQuantity) === undefined)
    errors.minQuantity = 'invalidQuantity';
  if (!input.departmentId) errors.departmentId = 'required';
  return errors;
}

/** Signed balance change for an entry, mirroring bin_card_record_entry. */
export function entryDelta(type: EntryType, quantity: number, balance: number) {
  const delta = type === 'receipt' ? quantity : type === 'issue' ? -quantity : quantity - balance;
  // Quantities have three decimals; rounding removes binary floating-point noise.
  return Math.round(delta * 1000) / 1000;
}

export function validateEntry(
  input: { type: EntryType; quantity: string; reference: string; notes: string },
  balance: number,
) {
  const errors: Partial<Record<EntryField, ValidationError>> = {};
  const quantity = parseQuantity(input.quantity);
  if (!input.quantity.trim()) errors.quantity = 'required';
  else if (quantity === undefined || (input.type !== 'adjustment' && quantity === 0))
    errors.quantity = 'invalidQuantity';
  else {
    const delta = entryDelta(input.type, quantity, balance);
    if (input.type === 'adjustment' && delta === 0) errors.quantity = 'noChange';
    else if (balance + delta < 0) errors.quantity = 'insufficientStock';
  }
  if (input.reference.trim().length > 60) errors.reference = 'tooLong';
  if (input.notes.trim().length > 500) errors.notes = 'tooLong';
  return errors;
}

export function stockLevel(item: Pick<StockItem, 'balance' | 'minQuantity'>): StockLevel {
  if (item.balance <= 0) return 'out';
  return item.balance <= item.minQuantity ? 'low' : 'ok';
}
