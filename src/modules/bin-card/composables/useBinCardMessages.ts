import { computed } from 'vue';
import { locale } from '../../../i18n';
import { ModuleRequestError } from '../../../core/module-rpc';
import en from '../locales/en';
import id from '../locales/id';
import type { EntryType, StockUnit } from '../types';

export function useBinCardMessages() {
  return computed(() => (locale.value === 'id' ? id : en));
}

export const unitKeys: Record<StockUnit, keyof typeof en> = {
  pcs: 'unitPcs',
  box: 'unitBox',
  pack: 'unitPack',
  bottle: 'unitBottle',
  roll: 'unitRoll',
  set: 'unitSet',
  kg: 'unitKg',
  g: 'unitG',
  l: 'unitL',
  ml: 'unitMl',
  m: 'unitM',
};
export const entryKeys: Record<EntryType, keyof typeof en> = {
  receipt: 'receipt',
  issue: 'issue',
  adjustment: 'adjustment',
};

const errorKeys: Record<string, keyof typeof en> = {
  ACCESS_DENIED: 'accessDenied',
  DUPLICATE_CODE: 'duplicateCode',
  VERSION_CONFLICT: 'versionConflict',
  ITEM_ARCHIVED: 'itemArchived',
  UNIT_LOCKED: 'unitLocked',
  DEPARTMENT_LOCKED: 'departmentLocked',
  BALANCE_NOT_ZERO: 'balanceNotZero',
  INSUFFICIENT_STOCK: 'insufficientStock',
  NO_CHANGE: 'noChange',
};
/** Map a server error code to safe, localized copy; unknown failures stay generic. */
export function errorMessage(messages: Record<keyof typeof en, string>, error: unknown) {
  const code = error instanceof ModuleRequestError ? error.code : '';
  return messages[errorKeys[code] ?? 'loadError'];
}

const tag = () => (locale.value === 'id' ? 'id-ID' : 'en-GB');
/** Quantities show up to three decimals in the reader's number format. */
export function formatQuantity(value: number, signed = false) {
  return new Intl.NumberFormat(tag(), {
    maximumFractionDigits: 3,
    signDisplay: signed ? 'exceptZero' : 'auto',
  }).format(value);
}
/** Movement times display in the hotel's time zone. */
export function formatTime(value: string) {
  return new Intl.DateTimeFormat(tag(), {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Asia/Jakarta',
  }).format(new Date(value));
}
