<script setup lang="ts">
/**
 * One record in a module list (`<ul class="list-rows">`): identity, an optional status
 * column, then actions. Layout lives in shared/list-row.css so every module places
 * status and actions the same way, on desktop and in narrow lists.
 */
defineProps<{
  /** MDI icon shown before the identity text. */
  icon?: string;
  archived?: boolean;
}>();
</script>

<template>
  <li
    class="list-row"
    :class="{ 'list-row--archived': archived, 'list-row--no-status': !$slots.status }"
  >
    <div class="list-row-identity">
      <v-icon
        v-if="icon"
        class="list-row-icon"
        :icon="icon"
        size="var(--workstel-icon-lg)"
      />
      <div class="list-row-text"><slot /></div>
    </div>
    <div
      v-if="$slots.status"
      class="list-row-status"
    >
      <slot name="status" />
    </div>
    <div class="list-row-actions"><slot name="actions" /></div>
  </li>
</template>
