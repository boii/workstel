<script setup lang="ts">
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
    :width="460"
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
  font-size: 12px;
  line-height: 1.6;
  color: var(--workstel-text-secondary);
}
.temp-box {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-top: 12px;
  padding: 10px 6px 10px 14px;
  border: 1px solid var(--workstel-border);
  border-radius: 6px;
  background: #f7f9fa;
}
.temp-box code {
  font:
    600 16px 'Noto Sans',
    monospace;
  letter-spacing: 1px;
  overflow-wrap: anywhere;
}
</style>
