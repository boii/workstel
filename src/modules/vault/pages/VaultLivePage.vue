<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import VaultDialog from '../components/VaultDialog.vue';
import ModulePage from '../../../shared/ModulePage.vue';
import { vaultRpc as rpc, parseEntries, findAccount } from '../live-api';
import VaultAccountList from '../components/VaultAccountList.vue';
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
import { useRoute, useRouter } from 'vue-router';
const route = useRoute();
const router = useRouter();
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
const hotelId = ref(
  props.assignments.find((a) => a.hotelId === route.query.hotel)?.hotelId ??
    props.assignments[0]?.hotelId ??
    '',
);
const hotels = computed(() => [
  ...new Map(
    props.assignments.map((a) => [a.hotelId, { value: a.hotelId, title: a.hotelName }]),
  ).values(),
]);
const status = ref<'active' | 'archived' | 'all'>('active');
const department = ref<string | null>(null);
const auditOpen = ref(false);
const access = ref<'all' | 'mine' | 'shared'>('all');
const filtersOpen = ref(false),
  secretReset = ref(0);
const visibleEntries = computed(() =>
  entries.value.filter(
    (entry) => access.value === 'all' || (access.value === 'mine' ? entry.isOwner : !entry.isOwner),
  ),
);
const hasFilters = computed(
  () =>
    !!search.value.trim() ||
    status.value !== 'active' ||
    !!department.value ||
    access.value !== 'all',
);
watch([detail, formOpen, secretTarget, sharingTarget, auditOpen], () => {
  secretReset.value++;
});
watch([access, search], () => {
  secretReset.value++;
});
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
function queryValue(key: string) {
  const value = route.query[key];
  return typeof value === 'string' ? value : '';
}
function readFilters() {
  search.value = queryValue('search').slice(0, 150);
  const state = queryValue('status');
  status.value = state === 'archived' || state === 'all' ? state : 'active';
  const scope = queryValue('access');
  access.value = scope === 'mine' || scope === 'shared' ? scope : 'all';
  department.value = departments.value.some((a) => a.value === queryValue('department'))
    ? queryValue('department')
    : null;
}
readFilters();
function filterQuery() {
  return {
    hotel: hotelId.value,
    ...(search.value.trim() ? { search: search.value.trim().slice(0, 150) } : {}),
    ...(status.value !== 'active' ? { status: status.value } : {}),
    ...(access.value !== 'all' ? { access: access.value } : {}),
    ...(department.value ? { department: department.value } : {}),
  };
}
function openDetail(entry: VaultEntry) {
  detail.value = entry;
  void router.push({ path: '/vault/accounts/' + entry.id, query: filterQuery() });
}
let loadedFilterKey = '';
let detailController: AbortController | undefined;
const detailLoading = ref(false);
async function restoreDetail() {
  detailController?.abort();
  detailController = new AbortController();
  const signal = detailController.signal;
  const id = typeof route.params.accountId === 'string' ? route.params.accountId : '';
  if (!id) {
    detail.value = null;
    detailLoading.value = false;
    return;
  }
  if (detail.value?.id === id && detail.value.hotelId === hotelId.value) return;
  detail.value = null;
  detailLoading.value = true;
  try {
    const entry = await findAccount(hotelId.value, id, signal);
    if (signal.aborted) return;
    detail.value = entry;
    if (!entry) failure.value = messages.value.accountUnavailable;
  } catch (error) {
    if (!signal.aborted) showError(error);
  } finally {
    if (!signal.aborted) detailLoading.value = false;
  }
}
watch(
  () => route.fullPath,
  () => {
    const hotel = props.assignments.find((a) => a.hotelId === route.query.hotel)?.hotelId;
    if (hotel && hotel !== hotelId.value) hotelId.value = hotel;
    readFilters();
    if (loadedFilterKey !== JSON.stringify(filterQuery())) void load();
    void restoreDetail();
  },
);
watch(access, () => {
  void router.replace({ query: filterQuery() });
});
watch(detail, (entry) => {
  if (!entry && !detailLoading.value && route.params.accountId) {
    void router.replace({ path: '/vault', query: filterQuery() });
  }
});
function departmentName(code: string) {
  return (
    props.assignments.find((a) => a.hotelId === hotelId.value && a.departmentCode === code)
      ?.departmentName ?? code
  );
}
function resetFilters() {
  search.value = '';
  access.value = 'all';
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
  detailController?.abort();
});
async function load(more = false, preserve = false) {
  if (JSON.stringify(route.query) !== JSON.stringify(filterQuery())) {
    await router.replace({ query: filterQuery() });
    return;
  }
  loadedFilterKey = JSON.stringify(filterQuery());
  secretReset.value++;
  const current = ++request;
  controller?.abort();
  controller = new AbortController();
  loading.value = true;
  if (!more && !preserve) {
    entries.value = [];
    next.value = null;
  }
  failure.value = '';
  try {
    const targetCount = preserve ? Math.max(50, entries.value.length) : 50;
    const rows: VaultEntry[] = [];
    let cursor = more ? next.value : null;
    const cursors = new Set<string>();
    let pages = 0;
    do {
      pages++;
      const result = await rpc(
        'vault_list_accounts',
        {
          p_hotel_id: hotelId.value,
          p_department_id: department.value,
          p_status: status.value,
          p_search: search.value.trim().slice(0, 150),
          p_after: cursor,
          p_limit: 50,
        },
        controller.signal,
      );
      if (current !== request) return;
      if (!Array.isArray(result?.data)) throw Error('INVALID_RESPONSE');
      rows.push(...parseEntries(result.data, hotelId.value));
      cursor = typeof result.meta?.nextCursor === 'string' ? result.meta.nextCursor : null;
      if (cursor && cursors.has(cursor)) throw Error('INVALID_RESPONSE');
      if (cursor) cursors.add(cursor);
    } while (preserve && cursor && pages < Math.ceil(targetCount / 50));
    entries.value = more ? [...entries.value, ...rows] : rows;
    next.value = cursor;
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
    await load(false, true);
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
    await load(false, true);
    feedbackMessage.value = action === 'archive' ? 'archiveDone' : 'restoreDone';
    feedback.value = true;
  } catch (error) {
    showError(error);
  } finally {
    busy.value = false;
  }
}
const detailOpen = computed({
  get: () => !!detail.value || detailLoading.value,
  set: (value) => {
    if (!value) {
      detailController?.abort();
      detailLoading.value = false;
      detail.value = null;
      void router.replace({ path: '/vault', query: filterQuery() });
    }
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
  void restoreDetail();
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
      :description="`${visibleEntries.length} / ${entries.length} ${messages.loadedAccounts}`"
      :loading="loading && !entries.length"
      :error="formOpen ? '' : failure"
      :empty="!visibleEntries.length && !loading"
      :empty-title="hasFilters ? messages.noResults : messages.emptyTitle"
      :empty-description="hasFilters ? messages.noResultsHint : messages.liveEmpty"
      :retry-label="messages.retry"
      @retry="
        load();
        restoreDetail();
      "
      ><template #actions>
        <v-btn
          v-if="canAudit"
          variant="text"
          prepend-icon="mdi-history"
          :aria-label="messages.auditTitle"
          :title="messages.auditTitle"
          @click="auditOpen = true"
          >{{ messages.auditTitle }}</v-btn
        >
        <v-btn
          :disabled="!canWrite || busy"
          color="primary"
          prepend-icon="mdi-plus"
          :aria-label="messages.add"
          :title="messages.add"
          @click="edit()"
          >{{ messages.add }}</v-btn
        >
      </template>
      <template #toolbar>
        <v-form
          class="vault-compact-toolbar"
          @submit.prevent="load()"
        >
          <v-text-field
            v-model="search"
            class="vault-compact-search"
            prepend-inner-icon="mdi-magnify"
            hide-details
            density="compact"
            :label="messages.search"
            maxlength="150"
            @keydown.enter.prevent="load()"
          >
            <template #append-inner
              ><v-btn
                icon="mdi-arrow-right"
                variant="text"
                size="x-small"
                :loading="loading"
                :aria-label="messages.searchAction"
                @click="load()"
            /></template>
          </v-text-field>
          <v-select
            v-model="access"
            class="vault-access-filter"
            hide-details
            density="compact"
            :label="messages.access"
            :items="[
              { value: 'all', title: messages.allAccounts },
              { value: 'mine', title: messages.ownedByMe },
              { value: 'shared', title: messages.sharedWithMe },
            ]"
          />
          <v-btn
            variant="text"
            prepend-icon="mdi-filter-variant"
            :active="filtersOpen"
            :aria-expanded="filtersOpen"
            aria-controls="vault-additional-filters"
            @click="filtersOpen = !filtersOpen"
            >{{ messages.filters }}</v-btn
          >
          <v-btn
            v-if="hasFilters"
            icon="mdi-filter-remove-outline"
            variant="text"
            :aria-label="messages.reset"
            :title="messages.reset"
            @click="resetFilters"
          />
          <v-btn
            icon="mdi-refresh"
            variant="text"
            :aria-label="messages.refresh"
            :title="messages.refresh"
            :loading="loading"
            @click="load(false, true)"
          />
        </v-form>
        <div
          v-if="filtersOpen"
          id="vault-additional-filters"
          class="vault-compact-filters"
        >
          <v-select
            v-if="hotels.length > 1"
            v-model="hotelId"
            hide-details
            density="compact"
            :label="messages.hotel"
            :items="hotels"
            :disabled="busy || formOpen"
            @update:model-value="changedHotel"
          />
          <v-select
            v-model="status"
            hide-details
            density="compact"
            :label="messages.status"
            :items="[
              { value: 'active', title: messages.active },
              { value: 'archived', title: messages.archived },
              { value: 'all', title: messages.all },
            ]"
            @update:model-value="load()"
          />
          <v-select
            v-model="department"
            hide-details
            density="compact"
            :items="departments"
            :label="messages.department"
            clearable
            @update:model-value="load()"
          />
        </div>
        <p
          v-if="!secretAvailable"
          class="vault-compact-service-hint"
        >
          <v-icon
            icon="mdi-lock-outline"
            size="14"
          />
          {{ messages.unavailable }}
        </p>
      </template>
      <template #empty-action>
        <v-btn
          v-if="hasFilters"
          variant="text"
          color="primary"
          @click="resetFilters"
          >{{ messages.reset }}</v-btn
        >
      </template>
      <VaultAccountList
        :entries="visibleEntries"
        :secret-available="secretAvailable"
        :busy="busy"
        :reset-key="secretReset"
        :can-edit="canEdit"
        :can-archive="canArchive"
        @detail="openDetail"
        @edit="edit($event)"
        @password="
          secretMode = 'write';
          secretTarget = $event;
        "
        @share="sharingTarget = $event"
        @archive="archiveTarget = $event"
        @restore="changeStatus($event, 'restore')"
      />
    </ModulePage>
    <div
      v-if="next"
      class="vault-compact-footer"
    >
      <span>{{ visibleEntries.length }} / {{ entries.length }} {{ messages.loadedAccounts }}</span>
      <v-btn
        v-if="next"
        variant="text"
        :loading="loading"
        @click="load(true)"
        >{{ messages.loadMore }}</v-btn
      >
      <span v-if="access !== 'all' && next">{{ messages.accessLoadedHint }}</span>
    </div>
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
    <VaultDialog
      v-model="detailOpen"
      :title="detail?.name ?? messages.details"
      :subtitle="messages.details"
      :busy="busy"
      drawer
    >
      <v-skeleton-loader
        v-if="detailLoading"
        type="article"
      />
      <template v-else-if="detail">
        <v-alert
          v-if="failure"
          type="error"
          variant="tonal"
          >{{ failure }}</v-alert
        >
        <dl class="vault-details">
          <dt>{{ messages.department }}</dt>
          <dd>{{ departmentName(detail.departmentId) }}</dd>
          <dt>{{ messages.access }}</dt>
          <dd>{{ detail.isOwner ? messages.ownedByMe : messages.sharedWithMe }}</dd>
          <dt>{{ messages.username }}</dt>
          <dd>{{ detail.username }}</dd>
          <dt>{{ messages.website }}</dt>
          <dd>{{ detail.website || '—' }}</dd>
          <dt>{{ messages.notes }}</dt>
          <dd>{{ detail.notes || '—' }}</dd>
          <dt>{{ messages.updated }}</dt>
          <dd>
            {{
              new Intl.DateTimeFormat(locale, {
                dateStyle: 'medium',
                timeStyle: 'short',
                timeZone: 'Asia/Jakarta',
              }).format(new Date(detail.updatedAt))
            }}
          </dd>
          <dt>{{ messages.password }}</dt>
          <dd>{{ secretAvailable ? messages.passwordActions : messages.unavailable }}</dd>
        </dl>
        <p class="vault-field-hint">
          {{ secretAvailable ? messages.encryptedHint : messages.passwordHint }}
        </p>
      </template>
      <template
        v-if="detail"
        #actions
      >
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
        <v-menu
          v-if="canEdit(detail) || canArchive(detail)"
          location="top end"
        >
          <template #activator="{ props: menu }"
            ><v-btn
              v-bind="menu"
              icon="mdi-dots-vertical"
              variant="text"
              :disabled="busy"
              :aria-label="messages.actions"
              :title="messages.actions"
          /></template>
          <v-list density="compact">
            <v-list-item
              v-if="secretAvailable && detail.status === 'active' && canEdit(detail)"
              prepend-icon="mdi-key-outline"
              :title="messages.setPassword"
              @click="
                secretMode = 'write';
                secretTarget = detail;
                detail = null;
              "
            />
            <v-list-item
              v-if="detail.isOwner && canEdit(detail)"
              prepend-icon="mdi-account-multiple-outline"
              :title="messages.shareTitle"
              @click="
                sharingTarget = detail;
                detail = null;
              "
            />
            <v-list-item
              v-if="canArchive(detail)"
              :prepend-icon="
                detail.status === 'active' ? 'mdi-archive-outline' : 'mdi-archive-arrow-up-outline'
              "
              :title="detail.status === 'active' ? messages.archive : messages.restore"
              @click="
                detail.status === 'active'
                  ? (archiveTarget = detail)
                  : changeStatus(detail, 'restore')
              "
            />
          </v-list>
        </v-menu>
        <v-btn
          v-if="canEdit(detail)"
          color="primary"
          :disabled="busy"
          @click="edit(detail)"
          >{{ messages.edit }}</v-btn
        >
      </template>
    </VaultDialog>
    <VaultDialog
      v-model="archiveOpen"
      :title="messages.archiveTitle"
      :busy="busy"
      :width="440"
    >
      <v-alert
        v-if="failure"
        type="error"
        variant="tonal"
        density="compact"
        role="alert"
        >{{ failure }}</v-alert
      >
      <p class="vault-field-hint vault-panel-intro">{{ messages.archiveHint }}</p>
      <template #actions>
        <v-btn
          variant="text"
          :disabled="busy"
          @click="archiveTarget = null"
          >{{ messages.cancel }}</v-btn
        >
        <v-btn
          color="primary"
          :loading="busy"
          @click="archiveTarget && changeStatus(archiveTarget, 'archive')"
          >{{ messages.archive }}</v-btn
        >
      </template>
    </VaultDialog>
    <VaultSecretDialog
      v-if="secretTarget"
      v-model="secretOpen"
      :entry="secretTarget"
      :mode="secretMode"
      @changed="load(false, true)"
    />
    <VaultSharing
      v-if="sharingTarget"
      v-model="sharingOpen"
      :entry="sharingTarget"
      @changed="load(false, true)"
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
