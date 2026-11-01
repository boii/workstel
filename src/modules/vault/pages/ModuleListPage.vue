<script setup lang="ts">
import { computed, ref } from 'vue';
import VaultDialog from '../components/VaultDialog.vue';
import VaultAccountList from '../components/VaultAccountList.vue';
import ModulePage from '../../../shared/ModulePage.vue';
import { locale } from '../../../i18n';
import { useVault } from '../composables/useVault';
import { useVaultMessages } from '../composables/useVaultMessages';
import VaultEntryForm from '../components/VaultEntryForm.vue';
import { departmentIds } from '../types';
import type { VaultEntry, VaultEntryInput, VaultAction } from '../types';
const emit = defineEmits<{ back: [] }>();
const { entries, activity, save, setStatus } = useVault();
const messages = useVaultMessages(),
  search = ref(''),
  department = ref('all'),
  status = ref<'active' | 'archived' | 'all'>('active'),
  formOpen = ref(false),
  editing = ref<VaultEntry | null>(null),
  detailId = ref<string | null>(null),
  archiveId = ref<string | null>(null),
  feedback = ref<'saved' | 'archiveDone' | 'restoreDone' | null>(null);
const departmentKeys = {
  'front-office': 'frontOffice',
  sales: 'sales',
  engineering: 'engineering',
  it: 'it',
} as const;
const actionKeys: Record<
  VaultAction,
  'createdActivity' | 'editedActivity' | 'archivedActivity' | 'restoredActivity'
> = {
  created: 'createdActivity',
  updated: 'editedActivity',
  archived: 'archivedActivity',
  restored: 'restoredActivity',
};
const filtered = computed(() =>
  entries.value.filter(
    (entry) =>
      (status.value === 'all' || entry.status === status.value) &&
      (department.value === 'all' || entry.departmentId === department.value) &&
      [entry.name, entry.username, entry.website].some((value) =>
        value.toLowerCase().includes(search.value.trim().toLowerCase()),
      ),
  ),
);
const detail = computed(() => entries.value.find((entry) => entry.id === detailId.value) ?? null);
const history = computed(() => activity.value.filter((item) => item.entryId === detailId.value));
const detailOpen = computed({
  get: () => !!detail.value,
  set: (value) => {
    if (!value) detailId.value = null;
  },
});
const archiveOpen = computed({
  get: () => !!archiveId.value,
  set: (value) => {
    if (!value) archiveId.value = null;
  },
});
const departmentOptions = computed(() => [
  { value: 'all', title: messages.value.allDepartments },
  ...departmentIds.map((value) => ({ value, title: messages.value[departmentKeys[value]] })),
]);
function formatDate(value: string) {
  return new Intl.DateTimeFormat(locale.value === 'id' ? 'id-ID' : 'en-GB', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Asia/Jakarta',
  }).format(new Date(value));
}
function openForm(entry: VaultEntry | null = null) {
  detailId.value = null;
  editing.value = entry;
  formOpen.value = true;
}
function saveEntry(input: VaultEntryInput, id?: string) {
  const result = save(input, id);
  if (result.entry) feedback.value = 'saved';
}
function archiveEntry() {
  if (!archiveId.value) return;
  setStatus(archiveId.value, 'archived');
  detailId.value = null;
  archiveId.value = null;
  feedback.value = 'archiveDone';
}
function restoreEntry(id: string) {
  detailId.value = null;
  setStatus(id, 'active');
  feedback.value = 'restoreDone';
}
function resetFilters() {
  search.value = '';
  department.value = 'all';
  status.value = 'active';
}
</script>
<template>
  <div class="vault-module vault-compact-page">
    <button
      class="vault-breadcrumb"
      @click="emit('back')"
    >
      <v-icon
        icon="mdi-arrow-left"
        size="16"
      />{{ messages.back }}</button
    ><ModulePage
      :title="messages.title"
      :description="filtered.length + ' ' + messages.records"
      :empty="!filtered.length"
      :empty-title="entries.length ? messages.noResults : messages.emptyTitle"
      :empty-description="entries.length ? messages.noResultsHint : messages.emptyDescription"
      :retry-label="messages.retry"
    >
      <template #actions
        ><v-btn
          color="primary"
          prepend-icon="mdi-plus"
          :aria-label="messages.add"
          :title="messages.add"
          @click="openForm()"
          >{{ messages.add }}</v-btn
        ></template
      >
      <template #toolbar
        ><v-alert
          icon="mdi-shield-lock-outline"
          variant="tonal"
          type="info"
          density="compact"
          class="vault-notice"
          >{{ messages.backendNotice }}</v-alert
        >
        <div class="vault-toolbar">
          <v-text-field
            v-model="search"
            :aria-label="messages.search"
            :placeholder="messages.search"
            prepend-inner-icon="mdi-magnify"
            hide-details
          /><v-select
            v-model="department"
            :label="messages.department"
            :items="departmentOptions"
            hide-details
          /><v-select
            v-model="status"
            :label="messages.status"
            :items="[
              { value: 'active', title: messages.active },
              { value: 'archived', title: messages.archived },
              { value: 'all', title: messages.all },
            ]"
            hide-details
          />
        </div>
      </template>
      <template #empty-action
        ><v-btn
          variant="text"
          color="primary"
          @click="resetFilters"
          >{{ messages.reset }}</v-btn
        ></template
      >
      <VaultAccountList
        :entries="filtered.map((entry) => ({ ...entry, isOwner: true }))"
        :secret-available="false"
        :sharing-available="false"
        :busy="false"
        :reset-key="0"
        :can-edit="() => true"
        :can-archive="() => true"
        @detail="detailId = $event.id"
        @edit="openForm($event)"
        @archive="archiveId = $event.id"
        @restore="restoreEntry($event.id)"
      />
    </ModulePage>
    <VaultEntryForm
      v-model="formOpen"
      :entry="editing"
      @save="saveEntry"
    />
    <VaultDialog
      v-model="detailOpen"
      :title="detail?.name ?? messages.details"
      :subtitle="messages.details"
      drawer
    >
      <template v-if="detail">
        <p class="vault-detail-subtitle">
          {{ messages[departmentKeys[detail.departmentId]] }} ·
          {{ detail.status === 'active' ? messages.active : messages.archived }}
        </p>
        <dl class="vault-details">
          <dt>{{ messages.username }}</dt>
          <dd>{{ detail.username }}</dd>
          <dt>{{ messages.website }}</dt>
          <dd>{{ detail.website || '—' }}</dd>
          <dt>{{ messages.password }}</dt>
          <dd class="vault-password-line">
            <span>••••••••</span
            ><v-btn
              variant="text"
              prepend-icon="mdi-eye-off-outline"
              disabled
              >{{ messages.reveal }}</v-btn
            >
          </dd>
          <dt>{{ messages.notes }}</dt>
          <dd>{{ detail.notes || '—' }}</dd>
          <dt>{{ messages.updated }}</dt>
          <dd>{{ formatDate(detail.updatedAt) }}</dd>
        </dl>
        <p class="vault-field-hint">{{ messages.passwordHint }}</p>
        <h3 class="vault-history-title">{{ messages.history }}</h3>
        <p
          v-if="!history.length"
          class="vault-field-hint"
        >
          {{ messages.noHistory }}
        </p>
        <ul class="vault-history">
          <li
            v-for="item in history"
            :key="item.id"
          >
            <span>{{ messages[actionKeys[item.action]] }} · {{ messages.demoActor }}</span
            ><small>{{ formatDate(item.occurredAt) }}</small>
          </li>
        </ul>
      </template>
      <template
        v-if="detail"
        #actions
      >
        <v-btn
          variant="text"
          @click="detail.status === 'active' ? (archiveId = detail.id) : restoreEntry(detail.id)"
          >{{ detail.status === 'active' ? messages.archive : messages.restore }}</v-btn
        >
        <v-btn
          color="primary"
          @click="openForm(detail)"
          >{{ messages.edit }}</v-btn
        >
      </template>
    </VaultDialog>
    <VaultDialog
      v-model="archiveOpen"
      :title="messages.archiveTitle"
      :width="440"
    >
      <p class="vault-field-hint vault-panel-intro">{{ messages.archiveHint }}</p>
      <template #actions
        ><v-btn
          variant="text"
          @click="archiveId = null"
          >{{ messages.cancel }}</v-btn
        ><v-btn
          color="primary"
          @click="archiveEntry"
          >{{ messages.archive }}</v-btn
        ></template
      >
    </VaultDialog>
    <v-snackbar
      :model-value="!!feedback"
      @update:model-value="!$event && (feedback = null)"
      >{{ feedback ? messages[feedback] : ''
      }}<template #actions
        ><v-btn
          variant="text"
          @click="feedback = null"
          >{{ messages.close }}</v-btn
        ></template
      ></v-snackbar
    >
  </div>
</template>
