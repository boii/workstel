<script setup lang="ts">
import { computed } from 'vue';
import { useDisplay } from 'vuetify';
import { useVaultMessages } from '../composables/useVaultMessages';
const open = defineModel<boolean>({ required: true });
const props = withDefaults(
  defineProps<{
    title: string;
    subtitle?: string;
    busy?: boolean;
    width?: number;
    fullscreenOnMobile?: boolean;
    /** Short dialogs open on phones as a bottom sheet sized to their content. */
    sheet?: boolean;
  }>(),
  { subtitle: '', busy: false, width: 560, fullscreenOnMobile: false, sheet: false },
);
const { width: viewport } = useDisplay();
const phone = computed(() => viewport.value <= 680);
const fullscreen = computed(() => phone.value && props.fullscreenOnMobile && !props.sheet);
const bottomSheet = computed(() => phone.value && props.sheet);
const messages = useVaultMessages();
</script>
<template>
  <v-dialog
    v-model="open"
    :max-width="width"
    :persistent="busy"
    :fullscreen="fullscreen"
    :class="{ 'dialog-sheet': bottomSheet }"
    :transition="bottomSheet ? 'dialog-bottom-transition' : undefined"
    scrollable
    :aria-label="title"
  >
    <v-card class="vault-panel">
      <header class="vault-panel-header">
        <div class="vault-panel-heading">
          <div class="vault-panel-title">
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
            :aria-label="messages.close"
            :disabled="busy"
            @click="open = false"
          />
        </div>
        <div
          v-if="$slots.toolbar"
          class="vault-panel-toolbar"
        >
          <slot name="toolbar" />
        </div>
      </header>
      <v-card-text
        class="vault-panel-body"
        :class="{ 'vault-panel-body--flush': $slots.toolbar }"
        ><slot
      /></v-card-text>
      <footer
        v-if="$slots.actions"
        class="vault-panel-actions"
      >
        <slot name="actions" />
      </footer>
    </v-card>
  </v-dialog>
</template>
