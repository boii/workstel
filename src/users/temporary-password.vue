<script setup lang="ts">
import { dialogWidth } from '../shared/dialog-widths';
import { onUnmounted, ref } from 'vue';
import ModuleDialog from '../shared/module-dialog.vue';
import { t } from '../i18n';

/** Shows a server-generated temporary password once; it is never stored by the page. */
const open = defineModel<boolean>({ required: true });
defineProps<{ email: string; password: string }>();
const emit = defineEmits<{ closed: [] }>();
const copyState = ref<'idle' | 'copied' | 'failed'>('idle');
let timer: ReturnType<typeof setTimeout> | undefined;
onUnmounted(() => {
  if (timer) clearTimeout(timer);
});
async function copy(value: string) {
  try {
    await navigator.clipboard.writeText(value);
    copyState.value = 'copied';
  } catch {
    copyState.value = 'failed';
  }
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => (copyState.value = 'idle'), 2000);
}
function close() {
  open.value = false;
  emit('closed');
}
</script>
<template>
  <ModuleDialog
    v-model="open"
    :title="t('tempPasswordTitle')"
    :subtitle="t('tempPasswordFor') + ' ' + email"
    :width="dialogWidth.md"
  >
    <p class="temp-hint">{{ t('tempPasswordHint') }}</p>
    <div class="temp-box">
      <code :aria-label="t('tempPasswordTitle')">{{ password }}</code>
      <v-btn
        variant="text"
        color="primary"
        :prepend-icon="copyState === 'copied' ? 'mdi-check' : 'mdi-content-copy'"
        @click="copy(password)"
        >{{
          t(copyState === 'copied' ? 'copied' : copyState === 'failed' ? 'copyFailed' : 'copy')
        }}</v-btn
      >
    </div>
    <template #actions>
      <v-btn
        color="primary"
        @click="close"
        >{{ t('done') }}</v-btn
      >
    </template>
  </ModuleDialog>
</template>
<style scoped>
.temp-hint {
  font-size: var(--workstel-font-sm);
  line-height: var(--workstel-leading-relaxed);
  color: var(--workstel-text-secondary);
}
.temp-box {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--workstel-space-2);
  margin-top: var(--workstel-space-3);
  padding: var(--workstel-space-2_5) var(--workstel-space-1_5) var(--workstel-space-2_5)
    var(--workstel-space-3_5);
  border: 1px solid var(--workstel-border);
  border-radius: var(--workstel-radius-md);
  background: var(--workstel-surface-muted);
}
.temp-box code {
  font:
    600 16px 'Noto Sans',
    monospace;
  letter-spacing: 1px;
  overflow-wrap: anywhere;
}
</style>
