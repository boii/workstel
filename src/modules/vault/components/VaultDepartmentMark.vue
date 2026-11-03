<script setup lang="ts">
import { computed } from 'vue';
import { useVaultMessages } from '../composables/useVaultMessages';

/** Department labels are hotel data, so initials are derived from the actual names. */
const props = defineProps<{ departmentId: string; departmentName: string }>();
const messages = useVaultMessages();
const initials = computed(() => {
  const words = props.departmentName
    .trim()
    .split(/[\s&]+/)
    .filter(Boolean);
  if (!words.length) return '—';
  return words
    .slice(0, 2)
    .map((word) => word[0])
    .join('')
    .toUpperCase();
});
const tone = computed(() => {
  let hash = 0;
  for (const character of props.departmentId) hash = (hash * 31 + character.charCodeAt(0)) % 4;
  return ['mint', 'blue', 'peach', 'yellow'][hash];
});
</script>
<template>
  <span
    class="vault-department"
    :title="departmentName"
  >
    <span
      class="vault-department-mark"
      :class="'vault-department-mark--' + tone"
      aria-hidden="true"
      >{{ initials }}</span
    >
    <span class="vault-sr-only">{{ messages.department }}: {{ departmentName }}</span>
  </span>
</template>
