<script setup lang="ts">
import { computed } from 'vue';
import { useDisplay } from 'vuetify';
import { t } from '../i18n';

const open = defineModel<boolean>({ required: true });
const props = withDefaults(
  defineProps<{ title: string; subtitle?: string; busy?: boolean; width?: number }>(),
  { subtitle: '', busy: false, width: 560 },
);
const { width: viewport } = useDisplay();
const fullscreen = computed(() => viewport.value <= 680);
</script>
<template>
  <v-dialog
    v-model="open"
    :max-width="props.width"
    :persistent="busy"
    :fullscreen="fullscreen"
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
  gap: 12px;
  padding: 14px 20px;
  border-bottom: 1px solid var(--workstel-border);
  flex-shrink: 0;
}
.module-dialog-title {
  min-width: 0;
}
.module-dialog-title h2 {
  font-size: 20px;
  font-weight: 500;
  line-height: 1.4;
  overflow-wrap: anywhere;
}
.module-dialog-title p {
  margin-top: 3px;
  font-size: 12px;
  color: var(--workstel-text-secondary);
  overflow-wrap: anywhere;
}
.module-dialog-body {
  padding: 16px 20px !important;
  min-height: 0;
  overflow-y: auto;
  overscroll-behavior: contain;
  font-size: 13px !important;
  line-height: 1.5 !important;
}
.module-dialog-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  flex-wrap: wrap;
  gap: 8px;
  padding: 12px 20px;
  border-top: 1px solid var(--workstel-border);
  flex-shrink: 0;
}
@media (max-width: 680px) {
  .module-dialog-heading {
    padding: 12px 16px;
  }
  /* Vuetify sets the button height inline from the global VBtn default. */
  .module-dialog-heading > .v-btn {
    width: 44px !important;
    height: 44px !important;
  }
  .module-dialog-body {
    padding: 14px 16px !important;
  }
  .module-dialog-actions {
    padding: 10px 16px;
  }
  /* Slot buttons carry the parent's scope, so they are reached with :deep(). */
  .module-dialog-actions :deep(.v-btn) {
    min-height: 44px;
  }
}
</style>
