<script setup lang="ts">
import { dialogWidth } from './dialog-widths';
import { computed } from 'vue';
import { t } from '../i18n';
import ModuleDialog from './module-dialog.vue';
import type { ShortcutRow } from '../core/use-shortcuts';

const open = defineModel<boolean>({ required: true });
const props = defineProps<{ rows: ShortcutRow[]; title?: string }>();
const heading = computed(() => props.title ?? t('shortcuts'));
</script>
<template>
  <ModuleDialog
    v-model="open"
    sheet
    :title="heading"
    :width="dialogWidth.xs"
  >
    <ul class="shortcut-list">
      <li
        v-for="row in rows"
        :key="row.keys + row.label"
      >
        <span>{{ row.label }}</span>
        <kbd>{{ row.keys }}</kbd>
      </li>
    </ul>
  </ModuleDialog>
</template>
<style scoped>
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
