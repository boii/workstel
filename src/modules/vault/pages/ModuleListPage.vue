<script setup lang="ts">
import { computed, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
const route = useRoute();
const router = useRouter();
import ModuleDialog from '../../../shared/module-dialog.vue';
import UndoSnackbar from '../../../shared/undo-snackbar.vue';
import { useOptimisticArchive, useUndoNotice } from '../../../core/use-optimistic-archive';
import VaultAccountList from '../components/VaultAccountList.vue';
import VaultUsernameCopy from '../components/VaultUsernameCopy.vue';
import EmptyFilterChips from '../../../shared/empty-filter-chips.vue';
import ModulePage from '../../../shared/ModulePage.vue';
import FilterGroup from '../../../shared/filter-group.vue';
import { locale } from '../../../i18n';
import { useVault } from '../composables/useVault';
import { useVaultMessages } from '../composables/useVaultMessages';
import VaultEntryForm from '../components/VaultEntryForm.vue';
import { departmentIds } from '../types';
import type { VaultEntry, VaultEntryInput, VaultAction } from '../types';
import { safeWebsiteUrl } from '../validation';
const emit = defineEmits<{ back: [] }>();
const { entries, activity, save, setStatus } = useVault();
const messages = useVaultMessages(),
  search = ref(''),
  department = ref('all'),
  status = ref<'active' | 'archived' | 'all'>('active'),
  formOpen = ref(false),
  editing = ref<VaultEntry | null>(null),
  detailId = computed<string | null>({
    get: () => (typeof route.params.accountId === 'string' ? route.params.accountId : null),
    set: (id) => {
      void router.push({ path: id ? '/vault/accounts/' + id : '/vault', query: route.query });
    },
  }),
  { notice, undoAction, show: showNotice } = useUndoNotice();
const departmentKeys = {
  'front-office': 'frontOffice',
  sales: 'sales',
  engineering: 'engineering',
  it: 'it',
  accounting: 'accounting',
  'human-resource': 'humanResource',
  'admin-general': 'adminGeneral',
  housekeeping: 'housekeeping',
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
  if (result.entry) showNotice(messages.value.saved);
}
// The demo store holds every status, so archived rows stay in it and the list filters them.
const { toggle: toggleArchive } = useOptimisticArchive({
  rows: entries,
  statusFilter: () => 'all',
  commit: async (entry, archived) => setStatus(entry.id, archived ? 'archived' : 'active', true),
  show: showNotice,
  messages: () => ({
    archived: messages.value.archiveDone,
    restored: messages.value.restoreDone,
  }),
  errorMessage: () => messages.value.loadError,
  reload: () => undefined,
});
function toggleDetailArchive(entry: VaultEntry) {
  detailId.value = null;
  void toggleArchive(entry);
}
const filterCount = computed(
  () => (department.value !== 'all' ? 1 : 0) + (status.value !== 'active' ? 1 : 0),
);
const hasFilters = computed(() => !!search.value.trim() || filterCount.value > 0);
const activeFilters = computed(() => {
  const rows: { key: string; label: string; clear: () => void }[] = [];
  if (search.value.trim())
    rows.push({
      key: 'search',
      label: `${messages.value.search}: “${search.value.trim()}”`,
      clear: () => (search.value = ''),
    });
  if (department.value !== 'all')
    rows.push({
      key: 'department',
      label: `${messages.value.department}: ${
        messages.value[departmentKeys[department.value as keyof typeof departmentKeys]]
      }`,
      clear: () => (department.value = 'all'),
    });
  if (status.value !== 'active')
    rows.push({
      key: 'status',
      label: `${messages.value.status}: ${
        status.value === 'archived' ? messages.value.archived : messages.value.all
      }`,
      clear: () => (status.value = 'active'),
    });
  return rows;
});
function resetFilterGroup() {
  department.value = 'all';
  status.value = 'active';
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
        size="var(--workstel-icon-sm)"
      />{{ messages.back }}</button
    ><ModulePage
      :title="messages.title"
      :description="
        filtered.length + ' ' + (filtered.length === 1 ? messages.accountOne : messages.records)
      "
      :empty="!filtered.length"
      :empty-icon="hasFilters ? 'mdi-filter-off-outline' : 'mdi-shield-lock-outline'"
      :empty-title="hasFilters ? messages.noResults : messages.emptyTitle"
      :empty-description="hasFilters ? messages.noResultsHint : messages.emptyDescription"
      :retry-label="messages.retry"
    >
      <template #actions
        ><v-btn
          color="primary"
          class="module-primary-action"
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
            :model-value="search"
            class="vault-search"
            :aria-label="messages.search"
            :placeholder="messages.search"
            prepend-inner-icon="mdi-magnify"
            single-line
            clearable
            @update:model-value="search = $event ?? ''"
          />
          <FilterGroup
            :count="filterCount"
            @reset="resetFilterGroup"
          >
            <v-select
              v-model="department"
              :label="messages.department"
              :items="departmentOptions"
            />
            <v-select
              v-model="status"
              :label="messages.status"
              :items="[
                { value: 'active', title: messages.active },
                { value: 'archived', title: messages.archived },
                { value: 'all', title: messages.all },
              ]"
            />
          </FilterGroup>
        </div>
      </template>
      <template #empty-action
        ><EmptyFilterChips
          v-if="activeFilters.length"
          :filters="activeFilters"
          :reset-label="messages.reset"
          @reset="resetFilters"
        /><v-btn
          v-else
          variant="tonal"
          color="primary"
          prepend-icon="mdi-plus"
          @click="openForm()"
          >{{ messages.add }}</v-btn
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
        :department-name="(id) => messages[departmentKeys[id]]"
        @detail="detailId = $event.id"
        @edit="openForm($event)"
        @archive="toggleArchive(entries.find((entry) => entry.id === $event.id)!)"
        @restore="toggleArchive(entries.find((entry) => entry.id === $event.id)!)"
      />
    </ModulePage>
    <VaultEntryForm
      v-model="formOpen"
      :entry="editing"
      @save="saveEntry"
    />
    <ModuleDialog
      v-model="detailOpen"
      class="vault-dialog"
      :title="detail?.name ?? messages.details"
      :subtitle="messages.details"
    >
      <template v-if="detail">
        <p class="vault-detail-subtitle">
          {{ messages[departmentKeys[detail.departmentId]] }} ·
          {{ detail.status === 'active' ? messages.active : messages.archived }}
        </p>
        <dl class="vault-details">
          <dt>{{ messages.username }}</dt>
          <dd>
            <VaultUsernameCopy
              :value="detail.username"
              :name="detail.name"
            />
          </dd>
          <dt>{{ messages.website }}</dt>
          <dd>
            <a
              v-if="safeWebsiteUrl(detail.website)"
              class="vault-compact-domain"
              :href="safeWebsiteUrl(detail.website)!.href"
              target="_blank"
              rel="noopener noreferrer"
              :aria-label="messages.openWebsite + ' — ' + detail.name"
              >{{ detail.website
              }}<v-icon
                icon="mdi-open-in-new"
                size="11"
            /></a>
            <template v-else>{{ detail.website || '—' }}</template>
          </dd>
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
          @click="toggleDetailArchive(detail)"
          >{{ detail.status === 'active' ? messages.archive : messages.restore }}</v-btn
        >
        <v-btn
          color="primary"
          @click="openForm(detail)"
          >{{ messages.edit }}</v-btn
        >
      </template>
    </ModuleDialog>
    <UndoSnackbar
      :message="notice"
      :undo="undoAction"
      @close="showNotice('')"
    />
  </div>
</template>
