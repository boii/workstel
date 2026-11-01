import { computed } from 'vue';
import { locale } from '../../../i18n';
import en from '../locales/en';
import id from '../locales/id';
export function useVaultMessages() {
  return computed(() => (locale.value === 'id' ? id : en));
}
