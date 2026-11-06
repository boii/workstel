import { computed } from 'vue';
import { useDisplay } from 'vuetify';

/**
 * Widest viewport, in px, that gets the phone layout: centred popup dialogs,
 * the folded Filters button and the taller header. CSS media queries cannot read this
 * constant, so they repeat it as `@media (max-width: 680px)`; keep both in step.
 */
export const phoneMaxWidth = 680;

/** True while the viewport is phone-sized. */
export function usePhone() {
  const { width } = useDisplay();
  return computed(() => width.value <= phoneMaxWidth);
}
