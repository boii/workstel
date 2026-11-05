<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';

/**
 * Optional form fields behind a single "Add …" link, so short forms stay short. The fields
 * show on their own when they already hold a value (editing), and fold again whenever the
 * form is reopened for another record.
 */
const props = defineProps<{
  label: string;
  /** True when any of the wrapped fields has a value. */
  filled: boolean;
  /** Changes whenever the form opens, so a new record starts folded. */
  resetKey: unknown;
}>();
const expanded = ref(false);
const shown = computed(() => props.filled || expanded.value);
const container = ref<HTMLElement | null>(null);
watch(
  () => props.resetKey,
  () => (expanded.value = false),
);
async function expand() {
  expanded.value = true;
  await nextTick();
  container.value?.querySelector<HTMLElement>('input, textarea, select')?.focus();
}
</script>
<template>
  <div
    v-if="shown"
    ref="container"
  >
    <slot />
  </div>
  <v-btn
    v-else
    variant="text"
    color="primary"
    prepend-icon="mdi-plus"
    class="optional-fields-toggle"
    @click="expand"
    >{{ label }}</v-btn
  >
</template>
<style scoped>
.optional-fields-toggle {
  margin-top: 10px;
  padding-inline: 4px !important;
}
</style>
