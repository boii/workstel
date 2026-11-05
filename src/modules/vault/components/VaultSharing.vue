<script setup lang="ts">
import VaultDialog from './VaultDialog.vue';
import { onMounted, onUnmounted, ref } from 'vue';
import { vaultRpc } from '../live-api';
import type { VaultEntry } from '../types';
import { useVaultMessages } from '../composables/useVaultMessages';
const open = defineModel<boolean>({ required: true });
const props = defineProps<{ entry: VaultEntry }>();
const emit = defineEmits<{ changed: []; transferred: [] }>();
const messages = useVaultMessages();
const shares = ref<{ email: string; grantedAt: string }[]>([]),
  email = ref(''),
  busy = ref(false),
  loading = ref(true),
  failure = ref('');
const version = ref(props.entry.version);
const departments = ref<{ departmentId: string; name: string }[]>([]);
const sharedDepartments = ref<string[]>([]);
const newOwner = ref('');
const keepAccess = ref(true);
const confirmTransfer = ref(false);
const isText = (value: unknown) => typeof value === 'string';
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
    const available = result.meta.availableDepartments;
    const granted = result.meta.departments;
    // Older servers do not report department shares; the section then stays hidden.
    if (available !== undefined || granted !== undefined) {
      if (
        !Array.isArray(available) ||
        !Array.isArray(granted) ||
        !available.every(
          (d: Record<string, unknown>) => isText(d?.departmentId) && isText(d?.name),
        ) ||
        !granted.every((d: Record<string, unknown>) => isText(d?.departmentId))
      )
        throw Error('INVALID_RESPONSE');
      departments.value = available.map((d: { departmentId: string; name: string }) => ({
        departmentId: d.departmentId,
        name: d.name,
      }));
      sharedDepartments.value = granted.map((d: { departmentId: string }) => d.departmentId);
    }
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
async function shareDepartment(departmentId: string, shared: boolean) {
  if (busy.value || loading.value) return;
  busy.value = true;
  failure.value = '';
  try {
    await vaultRpc('vault_set_department_share', {
      p_hotel_id: props.entry.hotelId,
      p_account_id: props.entry.id,
      p_department_id: departmentId,
      p_expected_version: version.value,
      p_action: shared ? 'grant' : 'revoke',
    });
    if (disposed) return;
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
async function transfer() {
  confirmTransfer.value = false;
  if (busy.value || loading.value || !newOwner.value.trim()) return;
  busy.value = true;
  failure.value = '';
  try {
    await vaultRpc('vault_transfer_owner', {
      p_hotel_id: props.entry.hotelId,
      p_account_id: props.entry.id,
      p_email: newOwner.value.trim(),
      p_expected_version: version.value,
      p_keep_reader: keepAccess.value,
    });
    if (disposed) return;
    // The caller is no longer the owner, so the sharing dialog has nothing left to manage.
    emit('transferred');
    open.value = false;
  } catch (error) {
    if (!disposed)
      failure.value =
        error instanceof Error && error.message === 'VERSION_CONFLICT'
          ? messages.value.conflict
          : error instanceof Error && error.message === 'RECIPIENT_UNAVAILABLE'
            ? messages.value.transferUnavailable
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
      <section
        v-if="departments.length"
        class="vault-share-section"
        aria-labelledby="vault-share-departments"
      >
        <h3 id="vault-share-departments">{{ messages.departmentShare }}</h3>
        <p class="vault-field-hint vault-share-warning">
          <v-icon
            icon="mdi-alert-outline"
            size="14"
          />{{ messages.departmentShareHint }}
        </p>
        <div class="vault-share-departments">
          <v-checkbox
            v-for="department in departments"
            :key="department.departmentId"
            :model-value="sharedDepartments.includes(department.departmentId)"
            :label="department.name"
            :disabled="busy"
            color="primary"
            density="compact"
            hide-details
            @update:model-value="(value) => shareDepartment(department.departmentId, !!value)"
          />
        </div>
      </section>
      <section
        class="vault-share-section"
        aria-labelledby="vault-transfer"
      >
        <h3 id="vault-transfer">{{ messages.transferTitle }}</h3>
        <p class="vault-field-hint">{{ messages.transferHint }}</p>
        <v-text-field
          v-model="newOwner"
          type="email"
          :label="messages.newOwnerEmail"
          autocomplete="off"
          maxlength="254"
          :disabled="busy"
          hide-details="auto"
          density="compact"
        />
        <div class="vault-transfer-actions">
          <v-checkbox
            v-model="keepAccess"
            :label="messages.keepReadAccess"
            :disabled="busy"
            color="primary"
            density="compact"
            hide-details
          />
          <v-btn
            variant="outlined"
            prepend-icon="mdi-account-switch-outline"
            :disabled="busy || !newOwner.trim()"
            @click="confirmTransfer = true"
            >{{ messages.transfer }}</v-btn
          >
        </div>
      </section>
    </template>
    <v-dialog
      v-model="confirmTransfer"
      max-width="420"
    >
      <v-card class="vault-transfer-confirm">
        <h2>{{ messages.transferConfirm }}</h2>
        <p>
          <strong>{{ entry.name }}</strong> → <strong>{{ newOwner.trim() }}</strong>
        </p>
        <p>{{ messages.transferConfirmBody }}</p>
        <div class="vault-transfer-confirm-actions">
          <v-btn
            variant="text"
            @click="confirmTransfer = false"
            >{{ messages.cancel }}</v-btn
          ><v-btn
            color="primary"
            variant="flat"
            @click="transfer"
            >{{ messages.transfer }}</v-btn
          >
        </div>
      </v-card>
    </v-dialog>
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
<style scoped>
.vault-share-section {
  margin-top: 16px;
  padding-top: 14px;
  border-top: 1px solid var(--workstel-border);
}
.vault-share-section h3 {
  font-size: var(--workstel-font-sm);
  font-weight: 600;
}
.vault-share-warning {
  display: flex;
  align-items: flex-start;
  gap: 6px;
  color: var(--workstel-warning-text) !important;
}
.vault-share-warning .v-icon {
  flex-shrink: 0;
  margin-top: 2px;
}
.vault-share-departments {
  display: flex;
  flex-wrap: wrap;
  gap: 0 12px;
}
.vault-share-departments :deep(.v-label),
.vault-transfer-actions :deep(.v-label) {
  font-size: var(--workstel-font-sm);
}
.vault-transfer-actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 8px;
}
.vault-transfer-confirm {
  padding: 22px;
}
.vault-transfer-confirm h2 {
  font-size: var(--workstel-font-lg);
  font-weight: 500;
}
.vault-transfer-confirm p {
  margin-top: 10px;
  font-size: var(--workstel-font-sm);
  line-height: 1.6;
  color: var(--workstel-text-secondary);
  overflow-wrap: anywhere;
}
.vault-transfer-confirm-actions {
  display: flex;
  justify-content: flex-end;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 20px;
}
@media (max-width: 680px) {
  .vault-transfer-actions .v-btn,
  .vault-transfer-confirm-actions .v-btn {
    min-height: 44px;
  }
  .vault-share-section :deep(.v-selection-control) {
    min-height: 44px;
  }
}
</style>
