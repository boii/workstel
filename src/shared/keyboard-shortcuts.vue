<script setup lang="ts">
import { computed } from 'vue';
import { t } from '../i18n';
import type { ShortcutRow } from '../core/use-shortcuts';

const open = defineModel<boolean>({ required: true });
const props = defineProps<{ rows: ShortcutRow[]; title?: string }>();
const heading = computed(() => props.title ?? t('shortcuts'));
</script>
<template>
  <v-dialog
    v-model="open"
    max-width="420"
    :aria-label="heading"
  >
    <v-card class="shortcut-panel">
      <header class="shortcut-panel-heading">
        <h2>{{ heading }}</h2>
        <v-btn
          icon="mdi-close"
          variant="text"
          :aria-label="t('close')"
          @click="open = false"
        />
      </header>
      <ul class="shortcut-list">
        <li
          v-for="row in rows"
          :key="row.keys + row.label"
        >
          <span>{{ row.label }}</span>
          <kbd>{{ row.keys }}</kbd>
        </li>
      </ul>
    </v-card>
  </v-dialog>
</template>
<style scoped>
.shortcut-panel {
  padding: 18px var(--workstel-space-5) var(--workstel-space-2);
}
.shortcut-panel-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--workstel-space-3);
  margin-bottom: var(--workstel-space-2);
}
.shortcut-panel-heading h2 {
  font-size: var(--workstel-font-lg);
  font-weight: var(--workstel-weight-medium);
}
.shortcut-list {
  list-style: none;
  margin: 0;
  padding: 0;
}
.shortcut-list li {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--workstel-space-5);
  padding: var(--workstel-space-2_5) 0;
  border-top: 1px solid var(--workstel-border);
  font-size: var(--workstel-font-sm);
}
.shortcut-list li:first-child {
  border-top: 0;
}
kbd {
  flex-shrink: 0;
  font: inherit;
  font-size: var(--workstel-font-xs);
  min-width: 30px;
  padding: 3px 7px;
  text-align: center;
  border: 1px solid var(--workstel-border);
  border-bottom-width: 2px;
  border-radius: var(--workstel-radius-sm);
  background: var(--workstel-surface-muted);
  color: var(--workstel-text-secondary);
}
</style>
