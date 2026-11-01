<script setup lang="ts">
import { computed, ref } from 'vue';
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
  archiveId.value = null;
  feedback.value = 'archiveDone';
}
function restoreEntry(id: string) {
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
  <div class="vault-module">
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
      :description="messages.description"
      :empty="!filtered.length"
      :empty-title="entries.length ? messages.noResults : messages.emptyTitle"
      :empty-description="entries.length ? messages.noResultsHint : messages.emptyDescription"
      :retry-label="messages.retry"
    >
      <template #actions
        ><v-btn
          color="primary"
          prepend-icon="mdi-plus"
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
        <div class="vault-list-summary">{{ filtered.length }} {{ messages.records }}</div></template
      >
      <template #empty-action
        ><v-btn
          variant="text"
          color="primary"
          @click="resetFilters"
          >{{ messages.reset }}</v-btn
        ></template
      >
      <v-card class="vault-desktop"
        ><v-table density="compact"
          ><thead>
            <tr>
              <th>{{ messages.name }}</th>
              <th>{{ messages.username }}</th>
              <th>{{ messages.department }}</th>
              <th>{{ messages.secretStatus }}</th>
              <th>{{ messages.updated }}</th>
              <th>
                <span class="vault-sr-only">{{ messages.actions }}</span>
              </th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="entry in filtered"
              :key="entry.id"
            >
              <td>
                <button
                  class="vault-account-name"
                  @click="detailId = entry.id"
                >
                  {{ entry.name }}</button
                ><span class="vault-account-website">{{ entry.website }}</span>
              </td>
              <td>{{ entry.username }}</td>
              <td>{{ messages[departmentKeys[entry.departmentId]] }}</td>
              <td>
                <span class="vault-secret-state"
                  ><v-icon
                    icon="mdi-lock-outline"
                    size="14"
                  />{{ messages.unavailable }}</span
                >
              </td>
              <td class="vault-date">{{ formatDate(entry.updatedAt) }}</td>
              <td>
                <v-btn
                  icon="mdi-chevron-right"
                  variant="text"
                  :aria-label="messages.details + ' ' + entry.name"
                  @click="detailId = entry.id"
                />
              </td>
            </tr></tbody></v-table
      ></v-card>
      <div class="vault-mobile">
        <v-card
          v-for="entry in filtered"
          :key="entry.id"
          class="vault-mobile-card"
          ><div class="vault-mobile-heading">
            <button
              class="vault-account-name"
              @click="detailId = entry.id"
            >
              {{ entry.name }}</button
            ><v-btn
              icon="mdi-chevron-right"
              variant="text"
              :aria-label="messages.details + ' ' + entry.name"
              @click="detailId = entry.id"
            />
          </div>
          <p>{{ entry.username }}</p>
          <div class="vault-mobile-footer">
            <span>{{ messages[departmentKeys[entry.departmentId]] }}</span
            ><span class="vault-secret-state"
              ><v-icon
                icon="mdi-lock-outline"
                size="14"
              />{{ messages.unavailable }}</span
            >
          </div></v-card
        >
      </div>
    </ModulePage>
    <VaultEntryForm
      v-model="formOpen"
      :entry="editing"
      @save="saveEntry"
    />
    <v-dialog
      v-model="detailOpen"
      max-width="620"
      ><v-card
        v-if="detail"
        class="vault-dialog"
        ><div class="vault-dialog-heading">
          <h2>{{ detail.name }}</h2>
          <v-btn
            icon="mdi-close"
            variant="text"
            :aria-label="messages.close"
            @click="detailId = null"
          />
        </div>
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
            <span>••••••••••••</span
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
        <div class="vault-dialog-actions">
          <v-btn
            v-if="detail.status === 'active'"
            variant="text"
            @click="archiveId = detail.id"
            >{{ messages.archive }}</v-btn
          ><v-btn
            v-else
            variant="text"
            @click="restoreEntry(detail.id)"
            >{{ messages.restore }}</v-btn
          ><v-btn
            color="primary"
            prepend-icon="mdi-pencil-outline"
            @click="openForm(detail)"
            >{{ messages.edit }}</v-btn
          >
        </div></v-card
      ></v-dialog
    >
    <v-dialog
      v-model="archiveOpen"
      max-width="440"
      ><v-card class="vault-dialog"
        ><h2>{{ messages.archiveTitle }}</h2>
        <p class="vault-confirm-hint">{{ messages.archiveHint }}</p>
        <div class="vault-dialog-actions">
          <v-btn
            variant="text"
            @click="archiveId = null"
            >{{ messages.cancel }}</v-btn
          ><v-btn
            color="primary"
            @click="archiveEntry"
            >{{ messages.archive }}</v-btn
          >
        </div></v-card
      ></v-dialog
    >
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
