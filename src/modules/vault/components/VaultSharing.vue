<script setup lang="ts">
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
  <v-dialog
    v-model="open"
    max-width="600"
    :persistent="busy"
  >
    <v-card class="vault-dialog">
      <div class="vault-dialog-heading">
        <h2>{{ messages.shareTitle }}</h2>
        <v-btn
          icon="mdi-close"
          variant="text"
          :aria-label="messages.close"
          :disabled="busy"
          @click="open = false"
        />
      </div>
      <p class="vault-confirm-hint">{{ entry.name }}</p>
      <p class="vault-field-hint">{{ messages.shareHint }}</p>
      <v-alert
        v-if="failure"
        type="error"
        variant="tonal"
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
        <p
          v-if="!shares.length"
          class="vault-field-hint"
        >
          {{ messages.privateOnly }}
        </p>
        <v-list
          v-else
          class="vault-share-list"
          ><v-list-item
            v-for="share in shares"
            :key="share.email"
            :title="share.email"
            :subtitle="messages.readOnly"
            ><template #append
              ><v-btn
                variant="text"
                color="error"
                :disabled="busy"
                @click="change(share.email, 'revoke')"
                >{{ messages.revoke }}</v-btn
              ></template
            ></v-list-item
          ></v-list
        >
        <v-form
          class="vault-share-form"
          @submit.prevent="change(email, 'grant')"
          ><v-text-field
            v-model="email"
            type="email"
            :label="messages.recipientEmail"
            autocomplete="off"
            required
            maxlength="254"
            :disabled="busy || shares.length >= 50"
          /><v-btn
            type="submit"
            color="primary"
            :loading="busy"
            :disabled="busy || !email.trim() || shares.length >= 50"
            >{{ messages.share }}</v-btn
          ></v-form
        >
      </template>
    </v-card>
  </v-dialog>
</template>
