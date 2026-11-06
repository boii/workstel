<script setup lang="ts">
import { Comment, computed, ref, useSlots } from 'vue';
import type { VNode } from 'vue';
import { useDisplay } from 'vuetify';
import { t } from '../i18n';

/**
 * Secondary list filters. On wider screens the slot renders inline inside the module
 * toolbar grid; on phones it collapses into one Filters button next to search, with a
 * badge for active filters, so records start higher on the first screen.
 */
const props = defineProps<{ count: number }>();
const emit = defineEmits<{ reset: [] }>();
const { width } = useDisplay();
const compact = computed(() => width.value <= 680);
const open = ref(false);
const slots = useSlots();
// Filters rendered with v-if (one floor, one department) leave only comment nodes;
// then there is nothing to choose and the phone button stays hidden.
const hasFilters = (nodes: VNode[] | undefined): boolean =>
  (nodes ?? []).some((node) =>
    node.type === Comment
      ? false
      : Array.isArray(node.children) && typeof node.type === 'symbol'
        ? hasFilters(node.children as VNode[])
        : true,
  );
const label = computed(() =>
  props.count ? `${t('filters')} (${props.count} ${t('filtersActive')})` : t('filters'),
);
</script>
<template>
  <slot v-if="!compact" />
  <v-menu
    v-else-if="hasFilters(slots.default?.())"
    v-model="open"
    location="bottom end"
    :close-on-content-click="false"
    max-width="calc(100vw - 32px)"
  >
    <template #activator="{ props: menu }">
      <v-btn
        v-bind="menu"
        class="filter-group-button"
        variant="tonal"
        :color="count ? 'primary' : undefined"
        :aria-label="label"
        :title="label"
      >
        <v-badge
          :model-value="count > 0"
          :content="count"
          color="primary"
          floating
          ><v-icon icon="mdi-filter-variant"
        /></v-badge>
      </v-btn>
    </template>
    <v-card class="filter-group-panel">
      <header>
        <h2>{{ t('filters') }}</h2>
        <v-btn
          v-if="count"
          variant="text"
          color="primary"
          @click="emit('reset')"
          >{{ t('filtersReset') }}</v-btn
        >
      </header>
      <div class="filter-group-fields"><slot /></div>
      <v-btn
        color="primary"
        block
        class="filter-group-done"
        @click="open = false"
        >{{ t('filtersDone') }}</v-btn
      >
    </v-card>
  </v-menu>
</template>
<style scoped>
.filter-group-button {
  min-width: 44px !important;
  width: 44px;
  height: 44px !important;
  padding: 0 !important;
}
.filter-group-panel {
  width: 320px;
  max-width: 100%;
  padding: var(--workstel-space-3_5) var(--workstel-space-4) var(--workstel-space-4);
}
.filter-group-panel header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--workstel-space-3);
  min-height: 44px;
  margin-bottom: var(--workstel-space-1_5);
}
.filter-group-panel h2 {
  font-size: var(--workstel-font-md);
  font-weight: var(--workstel-weight-medium);
}
.filter-group-fields {
  display: grid;
  gap: var(--workstel-space-1);
}
.filter-group-done {
  margin-top: var(--workstel-space-1_5);
}
</style>
