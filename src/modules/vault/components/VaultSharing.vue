<script setup lang="ts">
import VaultDialog from './VaultDialog.vue';
import { onMounted, onUnmounted, ref } from 'vue';
import { vaultRpc } from '../live-api';
import type { VaultEntry } from '../types';
import { useVaultMessages } from '../composables/useVaultMessages';
const open = defineModel<boolean>({ required: true });
const props = defineProps<{ entry: VaultEntry }>();
const emit = defineEmits<{ changed: [] }>();
const messages = useVaultMessages();
const shares = ref<{ email: string; grantedAt: string }[]>([]),
  email = ref(''),
  busy = ref(false),
  loading = ref(true),
  failure = ref('');
const version = ref(props.entry.version);
let disposed = false;
let controller: AbortController | undefined;
async function load() {
  loading.value = true;
  failure.value = '';
  controller?.abort();
  controller = new AbortController();
  try {
    const result = await vaultRpc(
      'vault_list_shares',
      { p_hotel_id: props.entry.hotelId, p_account_id: props.entry.id },
      controller.signal,
    );
    if (disposed) return;
    if (
      !Array.isArray(result.data) ||
      result.data.length > 50 ||
      !result.data.every(
        (s: Record<string, unknown>) =>
          typeof s.email === 'string' && typeof s.grantedAt === 'string',
      ) ||
      !Number.isSafeInteger(result.meta?.version)
    )
      throw Error('INVALID_RESPONSE');
    shares.value = result.data.map((s: { email: string; grantedAt: string }) => ({
      email: s.email,
      grantedAt: s.grantedAt,
    }));
    version.value = result.meta.version;
  } catch {
    if (!disposed) failure.value = messages.value.loadError;
  } finally {
    if (!disposed) loading.value = false;
  }
}
async function change(recipient: string, action: 'grant' | 'revoke') {
  if (busy.value || loading.value || !recipient.trim()) return;
  busy.value = true;
  failure.value = '';
  try {
    await vaultRpc('vault_set_share', {
      p_hotel_id: props.entry.hotelId,
      p_account_id: props.entry.id,
      p_email: recipient.trim(),
      p_expected_version: version.value,
      p_action: action,
    });
    if (disposed) return;
    email.value = '';
    await load();
    emit('changed');
  } catch (error) {
    if (!disposed)
      failure.value =
        error instanceof Error && error.message === 'VERSION_CONFLICT'
          ? messages.value.conflict
          : messages.value.shareError;
  } finally {
    if (!disposed) busy.value = false;
  }
}
onMounted(() => {
  void load();
});
onUnmounted(() => {
  disposed = true;
  controller?.abort();
});
</script>
<template>
  <VaultDialog
    v-model="open"
    :title="messages.shareTitle"
    :subtitle="entry.name"
    :busy="busy"
  >
    <p class="vault-field-hint vault-panel-intro">{{ messages.shareHint }}</p>
    <v-alert
      v-if="failure"
      type="error"
      variant="tonal"
      density="compact"
      role="alert"
      >{{ failure
      }}<v-btn
        variant="text"
        :disabled="busy"
        @click="load"
        >{{ messages.refresh }}</v-btn
      ></v-alert
    >
    <v-skeleton-loader
      v-if="loading"
      type="list-item-two-line"
    />
    <template v-else>
      <v-form
        id="vault-share-form"
        class="vault-panel-share-form"
        @submit.prevent="change(email, 'grant')"
      >
        <v-text-field
          v-model="email"
          type="email"
          :label="messages.recipientEmail"
          autocomplete="off"
          required
          maxlength="254"
          :disabled="busy || shares.length >= 50"
          hide-details="auto"
          density="compact"
        />
      </v-form>
      <p
        v-if="!shares.length"
        class="vault-field-hint"
      >
        {{ messages.privateOnly }}
      </p>
      <v-list
        v-else
        class="vault-panel-share-list"
        density="compact"
      >
        <v-list-item
          v-for="share in shares"
          :key="share.email"
          :title="share.email"
          :subtitle="messages.readOnly"
        >
          <template #append
            ><v-btn
              icon="mdi-account-remove-outline"
              variant="text"
              color="error"
              :disabled="busy"
              :aria-label="messages.revoke + ' — ' + share.email"
              :title="messages.revoke"
              @click="change(share.email, 'revoke')"
          /></template>
        </v-list-item>
      </v-list>
    </template>
    <template #actions>
      <v-btn
        variant="text"
        :disabled="busy"
        @click="open = false"
        >{{ messages.close }}</v-btn
      >
      <v-btn
        color="primary"
        type="submit"
        form="vault-share-form"
        :loading="busy"
        :disabled="busy || loading || !email.trim() || shares.length >= 50"
        >{{ messages.share }}</v-btn
      >
    </template>
  </VaultDialog>
</template>
