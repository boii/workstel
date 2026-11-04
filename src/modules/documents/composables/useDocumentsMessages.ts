import { computed } from 'vue';
import { locale } from '../../../i18n';
import { ModuleRequestError } from '../../../core/module-rpc';
import en from '../locales/en';
import id from '../locales/id';
import type { Category } from '../types';

export function useDocumentsMessages() {
  return computed(() => (locale.value === 'id' ? id : en));
}

export const categoryKeys: Record<Category, keyof typeof en> = {
  sop: 'categorySop',
  policy: 'categoryPolicy',
  form: 'categoryForm',
  guide: 'categoryGuide',
  other: 'categoryOther',
};
export const categoryIcons: Record<Category, string> = {
  sop: 'mdi-clipboard-list-outline',
  policy: 'mdi-shield-check-outline',
  form: 'mdi-form-select',
  guide: 'mdi-book-open-variant-outline',
  other: 'mdi-file-document-outline',
};

const errorKeys: Record<string, keyof typeof en> = {
  ACCESS_DENIED: 'accessDenied',
  VERSION_CONFLICT: 'versionConflict',
  INVALID_URL: 'invalidUrl',
};
/** Map a server error code to safe, localized copy; unknown failures stay generic. */
export function errorMessage(messages: Record<keyof typeof en, string>, error: unknown) {
  const code = error instanceof ModuleRequestError ? error.code : '';
  return messages[errorKeys[code] ?? 'loadError'];
}

export function formatDate(value: string) {
  return new Intl.DateTimeFormat(locale.value === 'id' ? 'id-ID' : 'en-GB', {
    dateStyle: 'medium',
    timeZone: 'Asia/Jakarta',
  }).format(new Date(value));
}
