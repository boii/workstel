<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue';
import type { VaultEntry } from '../types';
import { getSupabase } from '../../../auth/client';
import { secretOperation, SecretOperationError } from '../secret-api';
import { useVaultMessages } from '../composables/useVaultMessages';
const open = defineModel<boolean>({ required: true });
const props = defineProps<{ entry: VaultEntry; mode: 'write' | 'reveal' | 'verify' }>();
const emit = defineEmits<{ changed: []; verified: [] }>();
const messages = useVaultMessages();
const loading = ref(true),
  busy = ref(false),
  failure = ref(''),
  requiresAuth = ref(false),
  password = ref(''),
  confirmation = ref(''),
  loginPassword = ref(''),
  revealed = ref(''),
  hasSecret = ref(false),
  version = ref<number | null>(null),
  saved = ref(false),
  copied = ref(false);
let disposed = false;
const controller = new AbortController();
let timer: ReturnType<typeof setTimeout> | undefined;
function clearReveal() {
  revealed.value = '';
  copied.value = false;
  if (timer) clearTimeout(timer);
}
function clearSensitive() {
  clearReveal();
  password.value = '';
  confirmation.value = '';
  loginPassword.value = '';
}
function errorMessage(error: unknown) {
  const code = error instanceof SecretOperationError ? error.code : '';
  requiresAuth.value = code === 'REAUTH_REQUIRED';
  failure.value =
    code === 'REAUTH_REQUIRED'
      ? messages.value.reauthenticate
      : code === 'VERSION_CONFLICT'
        ? messages.value.conflict
        : code === 'ACCESS_DENIED'
          ? messages.value.forbidden
          : code === 'RATE_LIMITED'
            ? messages.value.rateLimited
            : code === 'SECRET_UNAVAILABLE'
              ? messages.value.noPassword
              : messages.value.secretError;
}
async function inspect() {
  loading.value = true;
  failure.value = '';
  try {
    const result = await secretOperation(
      'inspect',
      { accountId: props.entry.id },
      controller.signal,
    );
    if (disposed) return;
    hasSecret.value = result.hasSecret === true;
    version.value = result.version ?? null;
    requiresAuth.value = result.reauthRequired === true;
  } catch (error) {
    if (!disposed) errorMessage(error);
  } finally {
    if (!disposed) loading.value = false;
  }
}
async function act() {
  if (props.mode === 'verify') return;
  if (busy.value || loading.value || version.value === null) return;
  clearReveal();
  failure.value = '';
  saved.value = false;
  if (
    props.mode === 'write' &&
    (!password.value ||
      password.value !== confirmation.value ||
      new TextEncoder().encode(password.value).length > 4096)
  ) {
    failure.value = messages.value.passwordMismatch;
    return;
  }
  busy.value = true;
  const input =
    props.mode === 'write'
      ? {
          accountId: props.entry.id,
          password: password.value,
          expectedVersion: version.value,
          requestId: crypto.randomUUID(),
        }
      : { accountId: props.entry.id };
  password.value = '';
  confirmation.value = '';
  try {
    const result = await secretOperation(props.mode, input, controller.signal);
    if (disposed) return;
    requiresAuth.value = false;
    if (props.mode === 'reveal') {
      if (document.visibilityState !== 'visible') return;
      revealed.value = result.password ?? '';
      timer = setTimeout(() => {
        clearReveal();
      }, 30000);
    } else {
      version.value = result.version ?? version.value;
      hasSecret.value = true;
      saved.value = true;
      emit('changed');
    }
  } catch (error) {
    if (!disposed) errorMessage(error);
  } finally {
    if (!disposed) busy.value = false;
  }
}
async function reauthenticate() {
  if (busy.value || !loginPassword.value) return;
  busy.value = true;
  failure.value = '';
  const credential = loginPassword.value;
  loginPassword.value = '';
  try {
    const client = getSupabase();
    const current = await client.auth.getUser();
    if (!current.data.user?.email || current.error) throw Error();
    const { data, error } = await client.auth.signInWithPassword({
      email: current.data.user.email,
      password: credential,
    });
    if (error || data.user?.id !== current.data.user.id) throw Error();
    if (disposed) return;
    requiresAuth.value = false;
    if (props.mode === 'verify') {
      emit('verified');
      open.value = false;
      return;
    }
    await inspect();
  } catch {
    if (!disposed) failure.value = messages.value.reauthenticationFailed;
  } finally {
    if (!disposed) busy.value = false;
  }
}
async function copy() {
  if (!revealed.value) return;
  try {
    await navigator.clipboard.writeText(revealed.value);
    if (!disposed) copied.value = true;
  } catch {
    if (!disposed) failure.value = messages.value.copyFailed;
  }
}
function visibilityChanged() {
  if (document.visibilityState !== 'visible') clearSensitive();
}
onMounted(() => {
  document.addEventListener('visibilitychange', visibilityChanged);
  window.addEventListener('blur', clearSensitive);
  if (props.mode === 'verify') {
    loading.value = false;
    requiresAuth.value = true;
  } else void inspect();
});
onUnmounted(() => {
  disposed = true;
  controller.abort();
  document.removeEventListener('visibilitychange', visibilityChanged);
  window.removeEventListener('blur', clearSensitive);
  clearSensitive();
});
</script>
<template>
  <v-dialog
    v-model="open"
    max-width="600"
    :persistent="busy"
  >
    <v-card class="vault-dialog">
      <div class="vault-dialog-heading">
        <h2>
          {{
            mode === 'verify'
              ? messages.verifyIdentity
              : mode === 'write'
                ? messages.setPassword
                : messages.reveal
          }}
        </h2>
        <v-btn
          icon="mdi-close"
          variant="text"
          :aria-label="messages.close"
          :disabled="busy"
          @click="open = false"
        />
      </div>
      <p class="vault-confirm-hint">{{ entry.name }}</p>
      <v-alert
        v-if="failure"
        type="error"
        variant="tonal"
        role="alert"
        class="my-4"
        >{{ failure }}</v-alert
      >
      <v-alert
        v-if="saved"
        type="success"
        variant="tonal"
        role="status"
        class="my-4"
        >{{ messages.passwordSaved }}</v-alert
      >
      <v-skeleton-loader
        v-if="loading"
        type="list-item-two-line"
      />
      <v-form
        v-else-if="requiresAuth"
        class="vault-secret-form"
        @submit.prevent="reauthenticate"
      >
        <p class="vault-field-hint">
          {{ mode === 'verify' ? messages.inlineReauthenticateHint : messages.reauthenticateHint }}
        </p>
        <v-text-field
          v-model="loginPassword"
          type="password"
          :label="messages.signInPassword"
          autocomplete="current-password"
          required
          :disabled="busy"
        />
        <v-btn
          type="submit"
          color="primary"
          :loading="busy"
          :disabled="!loginPassword || busy"
          >{{ messages.verifyIdentity }}</v-btn
        >
      </v-form>
      <v-form
        v-else-if="mode === 'write' && version !== null"
        class="vault-secret-form"
        @submit.prevent="act"
      >
        <p class="vault-field-hint">{{ messages.encryptedHint }}</p>
        <v-text-field
          v-model="password"
          type="password"
          :label="messages.newStoredPassword"
          autocomplete="off"
          required
          :disabled="busy"
        />
        <v-text-field
          v-model="confirmation"
          type="password"
          :label="messages.confirmStoredPassword"
          autocomplete="off"
          required
          :disabled="busy"
        />
        <v-btn
          type="submit"
          color="primary"
          :loading="busy"
          :disabled="busy || !password || password !== confirmation"
          >{{ messages.savePassword }}</v-btn
        >
      </v-form>
      <template v-else-if="mode === 'reveal' && version !== null">
        <p
          v-if="!hasSecret"
          class="vault-field-hint"
        >
          {{ messages.noPassword }}
        </p>
        <template v-else>
          <p class="vault-field-hint">{{ messages.revealHint }}</p>
          <v-text-field
            v-if="revealed"
            :model-value="revealed"
            :label="messages.password"
            readonly
            autocomplete="off"
            spellcheck="false"
          />
          <v-btn
            v-if="!revealed"
            color="primary"
            :loading="busy"
            @click="act"
            >{{ messages.reveal }}</v-btn
          >
          <template v-else
            ><v-btn
              variant="text"
              @click="clearReveal"
              >{{ messages.hidePassword }}</v-btn
            ><v-btn
              variant="text"
              @click="copy"
              >{{ copied ? messages.copied : messages.copyPassword }}</v-btn
            >
            <p class="vault-field-hint">{{ messages.clipboardHint }}</p></template
          >
        </template>
      </template>
      <v-btn
        v-else
        variant="text"
        :disabled="busy"
        @click="inspect"
        >{{ messages.retry }}</v-btn
      >
    </v-card>
  </v-dialog>
</template>
