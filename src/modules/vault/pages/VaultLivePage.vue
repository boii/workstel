<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import ModulePage from '../../../shared/ModulePage.vue';
import { vaultRpc as rpc, parseEntries } from '../live-api';
import VaultAudit from '../components/VaultAudit.vue';
import VaultSharing from '../components/VaultSharing.vue';
import VaultSecretDialog from '../components/VaultSecretDialog.vue';
import { secretOperation } from '../secret-api';
import { locale } from '../../../i18n';
import type { StaffAssignment } from '../../../auth/useAuth';
import { useVaultMessages } from '../composables/useVaultMessages';
import VaultEntryForm from '../components/VaultEntryForm.vue';
import type { VaultEntry, VaultEntryInput, DepartmentId } from '../types';
import { departmentIds } from '../types';
const props = defineProps<{ assignments: StaffAssignment[] }>();
const emit = defineEmits<{ back: [] }>();
const messages = useVaultMessages(),
  entries = ref<VaultEntry[]>([]),
  loading = ref(false),
  failure = ref(''),
  search = ref(''),
  formOpen = ref(false),
  editing = ref<VaultEntry | null>(null),
  detail = ref<VaultEntry | null>(null),
  busy = ref(false),
  feedbackMessage = ref<'saved' | 'archiveDone' | 'restoreDone'>('saved'),
  feedback = ref(false),
  next = ref<string | null>(null),
  archiveTarget = ref<VaultEntry | null>(null);
const sharingTarget = ref<VaultEntry | null>(null);
const secretTarget = ref<VaultEntry | null>(null),
  secretMode = ref<'write' | 'reveal'>('reveal'),
  secretAvailable = ref(false);
const secretOpen = computed({
  get: () => !!secretTarget.value,
  set: (value) => {
    if (!value) secretTarget.value = null;
  },
});
const sharingOpen = computed({
  get: () => !!sharingTarget.value,
  set: (value) => {
    if (!value) sharingTarget.value = null;
  },
});
const hotelId = ref(props.assignments[0]?.hotelId ?? '');
const hotels = computed(() => [
  ...new Map(
    props.assignments.map((a) => [a.hotelId, { value: a.hotelId, title: a.hotelName }]),
  ).values(),
]);
const status = ref<'active' | 'archived' | 'all'>('active');
const department = ref<string | null>(null);
const auditOpen = ref(false);
const canAudit = computed(() =>
  props.assignments.some((a) => a.hotelId === hotelId.value && a.canAudit),
);
const departments = computed(() =>
  props.assignments
    .filter((a) => a.hotelId === hotelId.value && a.canRead)
    .map((a) => ({ value: a.departmentId, title: a.departmentName })),
);
const writableDepartments = computed(() =>
  props.assignments
    .filter(
      (a) =>
        a.hotelId === hotelId.value &&
        a.canWrite &&
        departmentIds.includes(a.departmentCode as DepartmentId),
    )
    .map((a) => a.departmentCode as DepartmentId),
);
function departmentName(code: string) {
  return (
    props.assignments.find((a) => a.hotelId === hotelId.value && a.departmentCode === code)
      ?.departmentName ?? code
  );
}
function resetFilters() {
  search.value = '';
  status.value = 'active';
  department.value = null;
  void load();
}
function changedHotel() {
  department.value = null;
  detail.value = null;
  formOpen.value = false;
  auditOpen.value = false;
  void load();
}
const canWrite = computed(() =>
  props.assignments.some((a) => a.hotelId === hotelId.value && a.canWrite),
);
function canArchive(entry: VaultEntry) {
  return (
    entry.canArchive === true &&
    props.assignments.some(
      (a) => a.hotelId === entry.hotelId && a.departmentCode === entry.departmentId && a.canArchive,
    )
  );
}
function canEdit(entry: VaultEntry) {
  return (
    entry.canEdit === true &&
    props.assignments.some(
      (a) => a.hotelId === entry.hotelId && a.departmentCode === entry.departmentId && a.canWrite,
    )
  );
}
function showError(error: unknown) {
  const code = error instanceof Error ? error.message : '';
  failure.value =
    code === 'ACCESS_DENIED'
      ? messages.value.forbidden
      : code === 'VERSION_CONFLICT'
        ? messages.value.conflict
        : messages.value.loadError;
}
let request = 0;
const lifetime = new AbortController();
let controller: AbortController | undefined;
onUnmounted(() => {
  ++request;
  lifetime.abort();
  controller?.abort();
});
async function load(more = false) {
  const current = ++request;
  controller?.abort();
  controller = new AbortController();
  loading.value = true;
  if (!more) {
    entries.value = [];
    next.value = null;
  }
  failure.value = '';
  try {
    const result = await rpc(
      'vault_list_accounts',
      {
        p_hotel_id: hotelId.value,
        p_department_id: department.value,
        p_status: status.value,
        p_search: search.value.trim().slice(0, 150),
        p_after: more ? next.value : null,
        p_limit: 50,
      },
      controller.signal,
    );
    if (current !== request) return;
    if (!Array.isArray(result?.data)) throw Error('INVALID_RESPONSE');
    const rows = parseEntries(result.data, hotelId.value);
    entries.value = more ? [...entries.value, ...rows] : rows;
    next.value = typeof result.meta?.nextCursor === 'string' ? result.meta.nextCursor : null;
  } catch (error) {
    if (current === request) {
      entries.value = [];
      next.value = null;
      showError(error);
    }
  } finally {
    if (current === request) loading.value = false;
  }
}
function edit(entry: VaultEntry | null = null) {
  if (busy.value) return;
  detail.value = null;
  editing.value = entry;
  formOpen.value = true;
  failure.value = '';
}
async function write(input: VaultEntryInput, id?: string) {
  if (busy.value) return;
  busy.value = true;
  failure.value = '';
  const assignment = props.assignments.find(
    (a) => a.hotelId === hotelId.value && a.departmentCode === input.departmentId && a.canWrite,
  );
  if (!assignment) {
    failure.value = messages.value.forbidden;
    busy.value = false;
    return;
  }
  try {
    await rpc('vault_write_metadata', {
      p_hotel_id: hotelId.value,
      p_department_id: assignment.departmentId,
      p_input: {
        name: input.name,
        username: input.username,
        website: input.website,
        notes: input.notes,
      },
      p_account_id: id ?? null,
      p_expected_version: id ? editing.value?.version : null,
      p_action: 'save',
    });
    formOpen.value = false;
    detail.value = null;
    await load();
    feedbackMessage.value = 'saved';
    feedback.value = true;
  } catch (error) {
    showError(error);
  } finally {
    busy.value = false;
  }
}
async function changeStatus(entry: VaultEntry, action: 'archive' | 'restore') {
  if (busy.value) return;
  busy.value = true;
  try {
    const assignment = props.assignments.find(
      (a) => a.hotelId === entry.hotelId && a.departmentCode === entry.departmentId,
    );
    if (!assignment) throw Error('ACCESS_DENIED');
    await rpc('vault_write_metadata', {
      p_hotel_id: entry.hotelId,
      p_department_id: assignment.departmentId,
      p_input: {},
      p_account_id: entry.id,
      p_expected_version: entry.version,
      p_action: action,
    });
    detail.value = null;
    archiveTarget.value = null;
    await load();
    feedbackMessage.value = action === 'archive' ? 'archiveDone' : 'restoreDone';
    feedback.value = true;
  } catch (error) {
    showError(error);
  } finally {
    busy.value = false;
  }
}
const detailOpen = computed({
  get: () => !!detail.value,
  set: (value) => {
    if (!value) detail.value = null;
  },
});
const archiveOpen = computed({
  get: () => !!archiveTarget.value,
  set: (value) => {
    if (!value) archiveTarget.value = null;
  },
});
onMounted(() => {
  void load();
  void secretOperation('status', {}, lifetime.signal)
    .then((result) => {
      if (!lifetime.signal.aborted) secretAvailable.value = result.available === true;
    })
    .catch(() => {
      secretAvailable.value = false;
    });
});
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
      :loading="loading && !entries.length"
      :error="formOpen ? '' : failure"
      :empty="!entries.length && !loading"
      :empty-title="
        search.trim() || status !== 'active' || department
          ? messages.noResults
          : messages.emptyTitle
      "
      :empty-description="
        search.trim() || status !== 'active' || department
          ? messages.noResultsHint
          : messages.liveEmpty
      "
      :retry-label="messages.retry"
      @retry="load()"
      ><template #actions>
        <v-btn
          v-if="canAudit"
          variant="text"
          prepend-icon="mdi-history"
          @click="auditOpen = true"
          >{{ messages.auditTitle }}</v-btn
        >
        <v-btn
          :disabled="!canWrite || busy"
          color="primary"
          prepend-icon="mdi-plus"
          @click="edit()"
          >{{ messages.add }}</v-btn
        >
      </template>
      <template #toolbar
        ><v-alert
          type="info"
          variant="tonal"
          density="compact"
          class="vault-notice"
          >{{ secretAvailable ? messages.secretReady : messages.privateNotice }}</v-alert
        ><v-form
          class="vault-toolbar vault-toolbar--live"
          @submit.prevent="load()"
          ><v-text-field
            v-model="search"
            class="vault-search"
            prepend-inner-icon="mdi-magnify"
            hide-details
            :label="messages.search"
            maxlength="150"
          /><v-select
            v-model="hotelId"
            class="vault-hotel-filter"
            hide-details
            :label="messages.hotel"
            :items="hotels"
            :disabled="busy || formOpen"
            @update:model-value="changedHotel"
          /><v-select
            v-model="status"
            class="vault-status-filter"
            hide-details
            :label="messages.status"
            :items="[
              { value: 'active', title: messages.active },
              { value: 'archived', title: messages.archived },
              { value: 'all', title: messages.all },
            ]"
            @update:model-value="load()"
          /><v-select
            v-model="department"
            class="vault-department-filter"
            hide-details
            :items="departments"
            :label="messages.department"
            clearable
            @update:model-value="load()"
          /><v-btn
            type="submit"
            class="vault-search-submit"
            variant="tonal"
            color="primary"
            :loading="loading"
            >{{ messages.searchAction }}</v-btn
          ></v-form
        ></template
      >
      <template #empty-action>
        <v-btn
          v-if="search.trim() || status !== 'active' || department"
          variant="text"
          color="primary"
          @click="resetFilters"
          >{{ messages.reset }}</v-btn
        >
      </template>
      <v-card class="vault-live-list">
        <v-list class="pa-0">
          <v-list-item
            v-for="entry in entries"
            :key="entry.id"
            class="vault-live-entry"
            append-icon="mdi-chevron-right"
            @click="detail = entry"
          >
            <template #prepend
              ><span class="vault-entry-icon"
                ><v-icon
                  icon="mdi-key-outline"
                  size="22" /></span
            ></template>
            <template #title
              ><span class="vault-live-name">{{ entry.name }}</span></template
            >
            <template #subtitle>
              <span class="vault-live-username">{{ entry.username }}</span>
              <span class="vault-live-meta">
                <span>{{ departmentName(entry.departmentId) }}</span>
                <span>{{ entry.isOwner ? messages.ownedByMe : messages.sharedWithMe }}</span>
                <v-chip
                  size="x-small"
                  variant="tonal"
                  :color="entry.status === 'active' ? 'primary' : undefined"
                  >{{ entry.status === 'active' ? messages.active : messages.archived }}</v-chip
                >
              </span>
            </template>
          </v-list-item>
        </v-list>
      </v-card>
      <v-btn
        v-if="next"
        class="vault-load-more"
        variant="text"
        :loading="loading"
        @click="load(true)"
        >{{ messages.loadMore }}</v-btn
      ></ModulePage
    >
    <VaultEntryForm
      v-model="formOpen"
      :entry="editing"
      :allowed-departments="writableDepartments"
      :password-service-available="secretAvailable"
      :saving="busy"
      :server-error="failure"
      :close-on-submit="false"
      @save="write"
    />
    <v-dialog
      v-model="detailOpen"
      max-width="600"
      ><v-card
        v-if="detail"
        class="vault-dialog"
        ><div class="vault-dialog-heading">
          <h2>{{ detail.name }}</h2>
          <v-btn
            icon="mdi-close"
            variant="text"
            :aria-label="messages.close"
            @click="detail = null"
          />
        </div>
        <v-alert
          v-if="failure"
          type="error"
          variant="tonal"
          >{{ failure }}</v-alert
        >
        <dl class="vault-details">
          <dt>{{ messages.username }}</dt>
          <dd>{{ detail.username }}</dd>
          <dt>{{ messages.website }}</dt>
          <dd>{{ detail.website || '—' }}</dd>
          <dt>{{ messages.notes }}</dt>
          <dd>{{ detail.notes || '—' }}</dd>
          <dt>{{ messages.updated }}</dt>
          <dd>
            {{
              new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(
                new Date(detail.updatedAt),
              )
            }}
          </dd>
          <dt>{{ messages.password }}</dt>
          <dd>{{ secretAvailable ? messages.passwordActions : messages.unavailable }}</dd>
        </dl>
        <p class="vault-field-hint">
          {{ secretAvailable ? messages.encryptedHint : messages.passwordHint }}
        </p>
        <div class="vault-dialog-actions vault-detail-actions">
          <v-btn
            v-if="secretAvailable && detail.status === 'active'"
            variant="text"
            :disabled="busy"
            @click="
              secretMode = 'reveal';
              secretTarget = detail;
              detail = null;
            "
            >{{ messages.reveal }}</v-btn
          >
          <v-btn
            v-if="secretAvailable && detail.status === 'active' && canEdit(detail)"
            variant="text"
            :disabled="busy"
            @click="
              secretMode = 'write';
              secretTarget = detail;
              detail = null;
            "
            >{{ messages.setPassword }}</v-btn
          >
          <v-btn
            v-if="detail.isOwner && canEdit(detail)"
            variant="text"
            :disabled="busy"
            @click="
              sharingTarget = detail;
              detail = null;
            "
            >{{ messages.shareTitle }}</v-btn
          >
          <v-btn
            v-if="canArchive(detail)"
            variant="text"
            :disabled="busy"
            @click="
              detail.status === 'active'
                ? (archiveTarget = detail)
                : changeStatus(detail, 'restore')
            "
            >{{ detail.status === 'active' ? messages.archive : messages.restore }}</v-btn
          ><v-btn
            color="primary"
            :disabled="busy || !canEdit(detail)"
            @click="edit(detail)"
            >{{ messages.edit }}</v-btn
          >
        </div></v-card
      ></v-dialog
    >
    <v-dialog
      v-model="archiveOpen"
      :persistent="busy"
      max-width="440"
      ><v-card class="vault-dialog"
        ><h2>{{ messages.archiveTitle }}</h2>
        <v-alert
          v-if="failure"
          type="error"
          variant="tonal"
          role="alert"
          >{{ failure }}</v-alert
        >
        <p class="vault-confirm-hint">{{ messages.archiveHint }}</p>
        <div class="vault-dialog-actions">
          <v-btn
            variant="text"
            :disabled="busy"
            @click="archiveTarget = null"
            >{{ messages.cancel }}</v-btn
          ><v-btn
            color="primary"
            :loading="busy"
            @click="archiveTarget && changeStatus(archiveTarget, 'archive')"
            >{{ messages.archive }}</v-btn
          >
        </div></v-card
      ></v-dialog
    >
    <VaultSecretDialog
      v-if="secretTarget"
      v-model="secretOpen"
      :entry="secretTarget"
      :mode="secretMode"
      @changed="load()"
    />
    <VaultSharing
      v-if="sharingTarget"
      v-model="sharingOpen"
      :entry="sharingTarget"
      @changed="load()"
    />
    <VaultAudit
      v-if="auditOpen"
      v-model="auditOpen"
      :hotel-id="hotelId"
      :assignments="assignments"
    />
    <v-snackbar v-model="feedback"
      >{{ messages[feedbackMessage]
      }}<template #actions
        ><v-btn
          variant="text"
          @click="feedback = false"
          >{{ messages.close }}</v-btn
        ></template
      ></v-snackbar
    >
  </div>
</template>
