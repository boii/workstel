<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { usePhone } from './breakpoints';
import { t } from '../i18n';
import { dialogWidth } from './dialog-widths';

const open = defineModel<boolean>({ required: true });
const props = withDefaults(
  defineProps<{
    title: string;
    subtitle?: string;
    busy?: boolean;
    width?: number;
    /**
     * On phones a dialog opens as a bottom sheet sized to its content. Long forms and views
     * whose length grows with records (histories, ledgers, audit logs) open instead as an inset
     * popup that fills the screen apart from a gap on every side.
     */
    fullscreen?: boolean;
    /** The form has unsaved input: closing it without saving asks first. */
    dirty?: boolean;
    /**
     * Makes this a confirmation: the footer gets Cancel and a filled button with this label,
     * which emits `confirm`. Confirmations default to the `md` width.
     */
    confirmLabel?: string;
    /** The confirmed action removes access or data, so its button is red. */
    destructive?: boolean;
    /** Replaces "Cancel" on a confirmation, as in "Keep editing". */
    cancelLabel?: string;
  }>(),
  {
    subtitle: '',
    busy: false,
    width: undefined,
    fullscreen: false,
    dirty: false,
    confirmLabel: '',
    destructive: false,
    cancelLabel: '',
  },
);
const emit = defineEmits<{ confirm: [] }>();
const maxWidth = computed(
  () => props.width ?? (props.confirmLabel ? dialogWidth.md : dialogWidth.lg),
);
const phone = usePhone();
const insetPhone = computed(() => phone.value && props.fullscreen);
const bottomSheet = computed(() => phone.value && !props.fullscreen);
const confirmDiscard = ref(false);
// Close, Escape, an outside click, phone Back and the form's own Cancel all come here.
function requestClose() {
  if (props.busy) return;
  if (props.dirty) confirmDiscard.value = true;
  else open.value = false;
}
function discard() {
  confirmDiscard.value = false;
  open.value = false;
}
watch(open, (value) => {
  if (!value) confirmDiscard.value = false;
});
</script>
<template>
  <v-dialog
    :model-value="open"
    :max-width="maxWidth"
    :persistent="busy"
    :class="{ 'dialog-sheet': bottomSheet, 'dialog-inset': insetPhone }"
    :transition="bottomSheet ? 'dialog-bottom-transition' : undefined"
    scrollable
    :aria-label="title"
    @update:model-value="(value: boolean) => (value ? (open = true) : requestClose())"
  >
    <v-card class="module-dialog">
      <header class="module-dialog-header">
        <div class="module-dialog-heading">
          <div class="module-dialog-title">
            <h2>{{ title }}</h2>
            <p
              v-if="subtitle"
              aria-live="polite"
            >
              {{ subtitle }}
            </p>
          </div>
          <v-btn
            icon="mdi-close"
            variant="text"
            :aria-label="t('close')"
            :disabled="busy"
            @click="requestClose"
          />
        </div>
        <div
          v-if="$slots.toolbar"
          class="module-dialog-toolbar"
        >
          <slot name="toolbar" />
        </div>
      </header>
      <v-card-text
        class="module-dialog-body"
        :class="{ 'module-dialog-body--flush': $slots.toolbar }"
        ><slot
      /></v-card-text>
      <footer
        v-if="$slots.actions || confirmLabel"
        class="module-dialog-actions"
      >
        <slot
          name="actions"
          :close="requestClose"
        >
          <v-btn
            variant="text"
            :disabled="busy"
            @click="requestClose"
            >{{ cancelLabel || t('cancelAction') }}</v-btn
          ><v-btn
            :color="destructive ? 'error' : 'primary'"
            variant="flat"
            :loading="busy"
            @click="emit('confirm')"
            >{{ confirmLabel }}</v-btn
          >
        </slot>
      </footer>
    </v-card>
    <ModuleDialog
      v-if="dirty || confirmDiscard"
      v-model="confirmDiscard"
      :title="t('discardTitle')"
      :confirm-label="t('discardAction')"
      :cancel-label="t('keepEditing')"
      destructive
      @confirm="discard"
    >
      <p>{{ t('discardBody') }}</p>
    </ModuleDialog>
  </v-dialog>
</template>
<style scoped>
.module-dialog {
  display: flex;
  flex-direction: column;
  overflow: hidden !important;
}
.module-dialog-header {
  border-bottom: 1px solid var(--workstel-border);
  flex-shrink: 0;
}
.module-dialog-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--workstel-space-3);
  padding: var(--workstel-space-3_5) var(--workstel-space-5);
}
/* Filters or search that stay above a scrolling list, such as the Vault audit log. */
.module-dialog-toolbar {
  padding: 0 var(--workstel-space-5) var(--workstel-space-3_5);
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
.module-dialog-body.module-dialog-body--flush {
  padding: 0 !important;
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
  /* On phones the footer's main action spans the remaining width, in sheets and inset popups. */
  .dialog-sheet .module-dialog-actions :deep(.v-btn:last-child:not(.v-btn--variant-text)),
  .dialog-inset .module-dialog-actions :deep(.v-btn:last-child:not(.v-btn--variant-text)) {
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
  .module-dialog-toolbar {
    padding: 0 var(--workstel-space-4) var(--workstel-space-3);
  }
  .module-dialog-body:not(.module-dialog-body--flush) {
    padding: var(--workstel-space-3_5) var(--workstel-space-4) !important;
  }
  .module-dialog-actions {
    padding: var(--workstel-space-2_5) var(--workstel-space-4);
  }
  /* Slot buttons carry the parent's scope, so they are reached with :deep(). */
  .module-dialog-actions :deep(.v-btn) {
    min-height: var(--workstel-touch-target);
  }
  .module-dialog-actions :deep(.v-btn--icon) {
    min-width: var(--workstel-touch-target);
  }
}
</style>
