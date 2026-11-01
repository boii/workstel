<script setup lang="ts">
import { onUnmounted, ref } from 'vue';
import { useVaultMessages } from '../composables/useVaultMessages';
const props = defineProps<{ value: string; name: string }>();
const messages = useVaultMessages();
const copied = ref(false),
  failed = ref(false);
let timer: ReturnType<typeof setTimeout> | undefined;
let disposed = false;
onUnmounted(() => {
  disposed = true;
  if (timer) clearTimeout(timer);
});
async function copy() {
  try {
    await navigator.clipboard.writeText(props.value);
    if (disposed) return;
    copied.value = true;
    failed.value = false;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      copied.value = false;
    }, 2000);
  } catch {
    if (!disposed) failed.value = true;
  }
}
</script>
<template>
  <div class="vault-credential-line vault-username-cell">
    <span
      class="vault-username-value"
      :title="value"
      >{{ value || '—' }}</span
    >
    <v-btn
      :icon="copied ? 'mdi-check' : 'mdi-content-copy'"
      :color="failed ? 'error' : copied ? 'primary' : undefined"
      variant="text"
      size="x-small"
      :disabled="!value"
      :aria-label="(copied ? messages.copied : messages.copyUsername) + ' — ' + name"
      :title="failed ? messages.copyFailed : messages.copyUsername"
      @click="copy"
    />
    <span
      v-if="copied || failed"
      class="vault-sr-only"
      :role="failed ? 'alert' : 'status'"
      >{{ failed ? messages.copyFailed : messages.copied }}</span
    >
  </div>
</template>
