<script setup lang="ts">
import { computed } from 'vue';
import { useDisplay } from 'vuetify';
import { t } from '../i18n';
import { dialogWidth } from './dialog-widths';

const open = defineModel<boolean>({ required: true });
const props = withDefaults(
  defineProps<{
    title: string;
    subtitle?: string;
    busy?: boolean;
    width?: number;
    /** Short forms open on phones as a bottom sheet sized to their content. */
    sheet?: boolean;
  }>(),
  { subtitle: '', busy: false, width: dialogWidth.lg, sheet: false },
);
const { width: viewport } = useDisplay();
const phone = computed(() => viewport.value <= 680);
const fullscreen = computed(() => phone.value && !props.sheet);
const bottomSheet = computed(() => phone.value && props.sheet);
</script>
<template>
  <v-dialog
    v-model="open"
    :max-width="props.width"
    :persistent="busy"
    :fullscreen="fullscreen"
    :class="{ 'module-dialog-sheet': bottomSheet }"
    :transition="bottomSheet ? 'dialog-bottom-transition' : undefined"
    scrollable
    :aria-label="title"
  >
    <v-card class="module-dialog">
      <header class="module-dialog-heading">
        <div class="module-dialog-title">
          <h2>{{ title }}</h2>
          <p v-if="subtitle">{{ subtitle }}</p>
        </div>
        <v-btn
          icon="mdi-close"
          variant="text"
          :aria-label="t('close')"
          :disabled="busy"
          @click="open = false"
        />
      </header>
      <v-card-text class="module-dialog-body"><slot /></v-card-text>
      <footer
        v-if="$slots.actions"
        class="module-dialog-actions"
      >
        <slot name="actions" />
      </footer>
    </v-card>
  </v-dialog>
</template>
<style scoped>
.module-dialog {
  display: flex;
  flex-direction: column;
  overflow: hidden !important;
}
.module-dialog-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--workstel-space-3);
  padding: var(--workstel-space-3_5) var(--workstel-space-5);
  border-bottom: 1px solid var(--workstel-border);
  flex-shrink: 0;
}
.module-dialog-title {
  min-width: 0;
}
.module-dialog-title h2 {
  font-size: var(--workstel-font-lg);
  font-weight: var(--workstel-weight-medium);
  line-height: var(--workstel-leading-tight);
  overflow-wrap: anywhere;
}
.module-dialog-title p {
  margin-top: 3px;
  font-size: var(--workstel-font-sm);
  color: var(--workstel-text-secondary);
  overflow-wrap: anywhere;
}
.module-dialog-body {
  padding: var(--workstel-space-4) var(--workstel-space-5) !important;
  min-height: 0;
  overflow-y: auto;
  overscroll-behavior: contain;
  font-size: var(--workstel-font-sm) !important;
  line-height: var(--workstel-leading-normal) !important;
}
.module-dialog-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  flex-wrap: wrap;
  gap: var(--workstel-space-2);
  padding: var(--workstel-space-3) var(--workstel-space-5);
  border-top: 1px solid var(--workstel-border);
  flex-shrink: 0;
}
@media (max-width: 680px) {
  .module-dialog-sheet .module-dialog {
    border-radius: var(--workstel-radius-lg) var(--workstel-radius-lg) 0 0 !important;
    padding-bottom: env(safe-area-inset-bottom);
  }
  .module-dialog-sheet .module-dialog-actions :deep(.v-btn:last-child) {
    flex: 1 1 auto;
  }
  .module-dialog-heading {
    padding: var(--workstel-space-3) var(--workstel-space-4);
  }
  /* Vuetify sets the button height inline from the global VBtn default. */
  .module-dialog-heading > .v-btn {
    width: var(--workstel-touch-target) !important;
    height: var(--workstel-touch-target) !important;
  }
  .module-dialog-body {
    padding: var(--workstel-space-3_5) var(--workstel-space-4) !important;
  }
  .module-dialog-actions {
    padding: var(--workstel-space-2_5) var(--workstel-space-4);
  }
  /* Slot buttons carry the parent's scope, so they are reached with :deep(). */
  .module-dialog-actions :deep(.v-btn) {
    min-height: var(--workstel-touch-target);
  }
}
</style>
<style>
/* The overlay content is teleported outside this component, so the sheet layout is global. */
@media (max-width: 680px) {
  .v-dialog.module-dialog-sheet {
    align-items: flex-end;
  }
  .v-dialog.module-dialog-sheet > .v-overlay__content {
    width: 100% !important;
    max-width: 100% !important;
    max-height: 92dvh !important;
    margin: 0 !important;
  }
}
</style>
