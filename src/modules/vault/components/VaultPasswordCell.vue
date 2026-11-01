<script setup lang="ts">
import { onUnmounted, ref, watch } from 'vue';
import type { VaultEntry } from '../types';
import { secretOperation, SecretOperationError } from '../secret-api';
import { useVaultMessages } from '../composables/useVaultMessages';
import VaultSecretDialog from './VaultSecretDialog.vue';
const props = defineProps<{ entry: VaultEntry; available: boolean; resetKey: number }>();
const messages = useVaultMessages();
const revealed = ref(''),
  busy = ref(false),
  failure = ref(''),
  copied = ref(false),
  verify = ref(false);
let generation = 0;
let pending: AbortController | undefined;
let timer: ReturnType<typeof setTimeout> | undefined;
let feedbackTimer: ReturnType<typeof setTimeout> | undefined;
let intent: 'reveal' | 'copy' = 'reveal';
function clear() {
  ++generation;
  pending?.abort();
  revealed.value = '';
  busy.value = false;
  copied.value = false;
  if (timer) clearTimeout(timer);
  if (feedbackTimer) clearTimeout(feedbackTimer);
}
function visibilityChanged() {
  if (document.visibilityState !== 'visible') clear();
}
document.addEventListener('visibilitychange', visibilityChanged);
window.addEventListener('blur', clear);
watch(
  () => props.resetKey,
  () => {
    clear();
    verify.value = false;
    failure.value = '';
  },
);
onUnmounted(() => {
  clear();
  document.removeEventListener('visibilitychange', visibilityChanged);
  window.removeEventListener('blur', clear);
});
async function act(action: 'reveal' | 'copy') {
  if (busy.value || !props.available || props.entry.status !== 'active') return;
  intent = action;
  failure.value = '';
  if (action === 'reveal' && revealed.value) {
    clear();
    return;
  }
  busy.value = true;
  const current = ++generation;
  pending = new AbortController();
  try {
    // A masked value is only a placeholder. Fetch plaintext solely on explicit action.
    let value = revealed.value;
    if (!value) {
      const result = await secretOperation('reveal', { accountId: props.entry.id }, pending.signal);
      if (current !== generation || document.visibilityState !== 'visible') return;
      value = result.password ?? '';
    }
    if (!value) throw new SecretOperationError('SECRET_UNAVAILABLE');
    if (action === 'reveal') {
      revealed.value = value;
      timer = setTimeout(clear, 30000);
    } else {
      await navigator.clipboard.writeText(value);
      if (current !== generation) return;
      copied.value = true;
      feedbackTimer = setTimeout(() => {
        copied.value = false;
      }, 2000);
    }
  } catch (error) {
    if (current !== generation) return;
    const code = error instanceof SecretOperationError ? error.code : '';
    if (code === 'REAUTH_REQUIRED') verify.value = true;
    else
      failure.value =
        code === 'ACCESS_DENIED'
          ? messages.value.forbidden
          : code === 'RATE_LIMITED'
            ? messages.value.rateLimited
            : code === 'SECRET_UNAVAILABLE'
              ? messages.value.noPassword
              : error instanceof SecretOperationError
                ? messages.value.secretError
                : messages.value.copyFailed;
  } finally {
    if (current === generation) busy.value = false;
  }
}
function verified() {
  verify.value = false;
  void act(intent);
}
</script>
<template>
  <div class="vault-inline-secret">
    <div class="vault-credential-line">
      <span
        class="vault-password-value"
        :class="{ 'vault-password-value--revealed': revealed }"
        :aria-label="revealed ? messages.password : messages.passwordHidden"
        >{{ revealed || '••••••••' }}</span
      >
      <v-btn
        :icon="revealed ? 'mdi-eye-off-outline' : 'mdi-eye-outline'"
        variant="text"
        size="x-small"
        :aria-label="(revealed ? messages.hidePassword : messages.reveal) + ' — ' + entry.name"
        :title="revealed ? messages.hidePassword : messages.reveal"
        :disabled="!available || entry.status !== 'active' || busy"
        :loading="busy && intent === 'reveal'"
        @click="act('reveal')"
      />
      <v-btn
        :icon="copied ? 'mdi-check' : 'mdi-content-copy'"
        :color="copied ? 'primary' : undefined"
        variant="text"
        size="x-small"
        :aria-label="(copied ? messages.copied : messages.copyPassword) + ' — ' + entry.name"
        :title="messages.clipboardHint"
        :disabled="!available || entry.status !== 'active' || busy"
        :loading="busy && intent === 'copy'"
        @click="act('copy')"
      />
      <span
        v-if="copied"
        class="vault-sr-only"
        role="status"
        >{{ messages.copied }}</span
      >
    </div>
    <p
      v-if="failure"
      class="vault-inline-error"
      role="alert"
    >
      {{ failure }}
    </p>
    <VaultSecretDialog
      v-if="verify"
      v-model="verify"
      :entry="entry"
      mode="verify"
      @verified="verified"
    />
  </div>
</template>
