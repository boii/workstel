<script setup lang="ts">
export interface ActiveFilterChip {
  key: string;
  label: string;
  clear: () => void;
}
defineProps<{
  filters: ActiveFilterChip[];
  resetLabel: string;
  hint?: string;
}>();
defineEmits<{ reset: [] }>();
</script>
<template>
  <div class="empty-filter-chips">
    <span
      v-if="hint"
      class="empty-filter-hint"
      >{{ hint }}</span
    >
    <div
      v-if="filters.length"
      class="empty-filter-chip-list"
    >
      <v-chip
        v-for="filter in filters"
        :key="filter.key"
        size="small"
        variant="tonal"
        closable
        :aria-label="resetLabel + ': ' + filter.label"
        @click:close="filter.clear"
        >{{ filter.label }}</v-chip
      >
    </div>
    <v-btn
      variant="text"
      color="primary"
      @click="$emit('reset')"
      >{{ resetLabel }}</v-btn
    >
  </div>
</template>
<style>
.empty-filter-chips {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--workstel-space-2_5);
  margin-top: var(--workstel-space-1);
}
.empty-filter-hint {
  font-size: var(--workstel-font-xs);
  color: var(--workstel-text-secondary);
}
.empty-filter-chip-list {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: var(--workstel-space-1_5);
}
.empty-filter-chip-list .v-chip {
  font-size: var(--workstel-font-xs);
  max-width: 100%;
}
.empty-filter-chip-list .v-chip__content {
  overflow-wrap: anywhere;
  white-space: normal;
}
</style>
