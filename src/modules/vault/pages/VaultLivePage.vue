<script setup lang="ts">
import ActionMenu from '../../../shared/action-menu.vue';
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import ModuleDialog from '../../../shared/module-dialog.vue';
import ModulePage from '../../../shared/ModulePage.vue';
import { vaultRpc as rpc, parseEntries, findAccount } from '../live-api';
import VaultAccountList from '../components/VaultAccountList.vue';
import VaultAudit from '../components/VaultAudit.vue';
import VaultSharing from '../components/VaultSharing.vue';
import VaultSecretDialog from '../components/VaultSecretDialog.vue';
import FilterGroup from '../../../shared/filter-group.vue';
import UndoSnackbar from '../../../shared/undo-snackbar.vue';
import { useOptimisticArchive, useUndoNotice } from '../../../core/use-optimistic-archive';
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
  next = ref<string | null>(null);
const { notice, undoAction, show: showNotice } = useUndoNotice();
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
const secretReset = ref(0),
  searching = ref(false);
const SEARCH_DELAY = 300;
let searchTimer: ReturnType<typeof setTimeout> | undefined;
// Typing waits for a short pause and then runs one search, instead of one request per key.
// Requests are also aborted, so a slow answer never overwrites a newer one.
watch(search, () => {
  searching.value = true;
  if (searchTimer) clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    searchTimer = undefined;
    // A filter or URL change may already have loaded exactly this query.
    if (JSON.stringify(filterQuery()) === loadedFilterKey) {
      searching.value = false;
      return;
    }
    void load().finally(() => {
      if (searchTimer === undefined) searching.value = false;
    });
  }, SEARCH_DELAY);
});
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
/** True once at least one list request has produced rows in this visit. */
const hadEntries = ref(false);
/** Placeholders appear on first load; later searches keep the current rows in place. */
const showSkeleton = computed(() => loading.value && !hadEntries.value);
/** Filters that are currently narrowing the list, each with its own clear action. */
const activeFilters = computed(() => {
  const rows: { key: string; label: string; clear: () => void }[] = [];
  if (search.value.trim())
    rows.push({
      key: 'search',
      label: `${messages.value.search}: “${search.value.trim()}”`,
      // The debounced watcher on search performs the reload.
      clear: () => (search.value = ''),
    });
  if (access.value !== 'all')
    rows.push({
      key: 'access',
      label: `${messages.value.access}: ${
        access.value === 'mine' ? messages.value.ownedByMe : messages.value.sharedWithMe
      }`,
      clear: () => {
        access.value = 'all';
        void load();
      },
    });
  if (status.value !== 'active')
    rows.push({
      key: 'status',
      label: `${messages.value.status}: ${
        status.value === 'archived' ? messages.value.archived : messages.value.all
      }`,
      clear: () => {
        status.value = 'active';
        void load();
      },
    });
  if (department.value)
    rows.push({
      key: 'department',
      label: `${messages.value.department}: ${departmentName(department.value)}`,
      clear: () => {
        department.value = null;
        void load();
      },
    });
  return rows;
});
/** Secondary filters inside the shared FilterGroup; search stays outside it. */
const filterCount = computed(
  () =>
    (access.value !== 'all' ? 1 : 0) +
    (status.value !== 'active' ? 1 : 0) +
    (department.value ? 1 : 0),
);
function resetFilterGroup() {
  access.value = 'all';
  status.value = 'active';
  department.value = null;
  void load();
}
/** Header count; "+" marks that more accounts are available to load. */
const countLabel = computed(() => {
  const count = visibleEntries.value.length;
  return `${count}${next.value ? '+' : ''} ${count === 1 && !next.value ? messages.value.accountOne : messages.value.records}`;
});
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
  failure.value = errorText(error);
}
function errorText(error: unknown) {
  const code = error instanceof Error ? error.message : '';
  return code === 'ACCESS_DENIED'
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
  if (searchTimer) clearTimeout(searchTimer);
  lifetime.abort();
  controller?.abort();
  detailController?.abort();
});
async function load(more = false, preserve = false) {
  // An explicit load (filter, refresh, retry) replaces any pending debounced search.
  if (searchTimer) {
    clearTimeout(searchTimer);
    searchTimer = undefined;
  }
  searching.value = false;
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
  // Rows stay on screen while a new search runs, so the table never flashes empty.
  // They are replaced only when the new result arrives, or cleared on failure.
  if (!more && !preserve && !hadEntries.value) {
    entries.value = [];
    next.value = null;
  }
  failure.value = '';
  try {
    const targetCount = preserve ? Math.max(50, entries.value.length) : 50;
    const found: VaultEntry[] = [];
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
      found.push(...parseEntries(result.data, hotelId.value));
      cursor = typeof result.meta?.nextCursor === 'string' ? result.meta.nextCursor : null;
      if (cursor && cursors.has(cursor)) throw Error('INVALID_RESPONSE');
      if (cursor) cursors.add(cursor);
    } while (preserve && cursor && pages < Math.ceil(targetCount / 50));
    // Skeleton placeholders only replace the list on first paint. Later searches keep the
    // current rows visible until the new result arrives, instead of blanking the table.
    hadEntries.value ||= found.length > 0;
    entries.value = more ? [...entries.value, ...found] : found;
    next.value = cursor;
  } catch (error) {
    if (current === request && !controller.signal.aborted) {
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
    showNotice(messages.value.saved);
  } catch (error) {
    showError(error);
  } finally {
    busy.value = false;
  }
}
// Archive and restore update the list at once and offer Undo, like the other modules.
const { toggle: toggleArchive } = useOptimisticArchive({
  rows: entries,
  statusFilter: () => status.value,
  commit: async (entry, archived) => {
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
      p_action: archived ? 'archive' : 'restore',
    });
  },
  show: showNotice,
  messages: () => ({
    archived: messages.value.archiveDone,
    restored: messages.value.restoreDone,
  }),
  errorMessage: errorText,
  reload: () => load(false, true),
});
function toggleDetailArchive(entry: VaultEntry) {
  closeDetail();
  void toggleArchive(entry);
}
const detailOpen = computed({
  get: () => !!detail.value || detailLoading.value,
  set: (value) => {
    if (!value) closeDetail();
  },
});
// After a transfer the caller may no longer see the account, so details close and the list reloads.
async function transferred() {
  closeDetail();
  await load(false, true);
  showNotice(messages.value.transferDone);
}
function closeDetail() {
  detailController?.abort();
  detailLoading.value = false;
  detail.value = null;
  void router.replace({ path: '/vault', query: filterQuery() });
}
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
        size="var(--workstel-icon-sm)"
      />{{ messages.back }}</button
    ><ModulePage
      :title="messages.title"
      :description="countLabel"
      :loading="showSkeleton"
      :error="formOpen ? '' : failure"
      :empty="!visibleEntries.length && !loading && !searching"
      :empty-icon="hasFilters ? 'mdi-filter-off-outline' : 'mdi-shield-lock-outline'"
      :empty-title="hasFilters ? messages.noResults : messages.emptyTitle"
      :empty-description="hasFilters ? messages.noResultsHint : messages.liveEmpty"
      :retry-label="messages.retry"
      @retry="
        load();
        restoreDetail();
      "
      ><template #actions>
        <v-btn
          :disabled="!canWrite || busy"
          color="primary"
          class="module-primary-action"
          prepend-icon="mdi-plus"
          :aria-label="messages.add"
          :title="messages.add"
          @click="edit()"
          >{{ messages.add }}</v-btn
        >
      </template>
      <template #toolbar>
        <!-- Audit log sits at the end of the toolbar row as an icon, so phones keep one row. -->
        <div class="vault-toolbar-row">
          <div class="vault-toolbar">
            <v-text-field
              :model-value="search"
              class="vault-search"
              :placeholder="messages.search"
              :aria-label="messages.search"
              prepend-inner-icon="mdi-magnify"
              :loading="searching"
              single-line
              clearable
              maxlength="150"
              @update:model-value="search = $event ?? ''"
              @keydown.enter.prevent="load()"
            />
            <FilterGroup
              :count="filterCount"
              @reset="resetFilterGroup"
            >
              <v-select
                v-model="access"
                :label="messages.access"
                :items="[
                  { value: 'all', title: messages.allAccounts },
                  { value: 'mine', title: messages.ownedByMe },
                  { value: 'shared', title: messages.sharedWithMe },
                ]"
              />
              <v-select
                v-model="status"
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
                :items="[{ value: null, title: messages.allDepartments }, ...departments]"
                :label="messages.department"
                @update:model-value="load()"
              />
              <v-select
                v-if="hotels.length > 1"
                v-model="hotelId"
                :label="messages.hotel"
                :items="hotels"
                :disabled="busy || formOpen"
                @update:model-value="changedHotel"
              />
            </FilterGroup>
          </div>
          <v-btn
            v-if="canAudit"
            class="vault-audit-action"
            icon="mdi-history"
            variant="text"
            :aria-label="messages.auditTitle"
            :title="messages.auditTitle"
            @click="auditOpen = true"
          />
        </div>
        <p
          v-if="!secretAvailable"
          class="vault-compact-service-hint"
        >
          <v-icon
            icon="mdi-lock-outline"
            size="var(--workstel-icon-xs)"
          />
          {{ messages.passwordHint }}
        </p>
      </template>
      <template #empty-action>
        <div
          v-if="activeFilters.length"
          class="vault-empty-filters"
        >
          <span
            v-if="next"
            class="vault-field-hint"
            >{{ messages.filteredOnlyLoaded }}</span
          >
          <div class="vault-empty-chips">
            <v-chip
              v-for="filter in activeFilters"
              :key="filter.key"
              size="small"
              variant="tonal"
              closable
              :aria-label="messages.reset + ': ' + filter.label"
              @click:close="filter.clear"
              >{{ filter.label }}</v-chip
            >
          </div>
          <v-btn
            variant="text"
            color="primary"
            @click="resetFilters"
            >{{ messages.reset }}</v-btn
          >
        </div>
        <v-btn
          v-else-if="canWrite"
          variant="tonal"
          color="primary"
          prepend-icon="mdi-plus"
          :disabled="busy"
          @click="edit()"
          >{{ messages.add }}</v-btn
        >
      </template>
      <VaultAccountList
        :entries="visibleEntries"
        :secret-available="secretAvailable"
        :busy="busy"
        :reset-key="secretReset"
        :can-edit="canEdit"
        :can-archive="canArchive"
        :department-name="departmentName"
        @detail="openDetail"
        @edit="edit($event)"
        @password="
          secretMode = 'write';
          secretTarget = $event;
        "
        @share="sharingTarget = $event"
        @archive="toggleArchive"
        @restore="toggleArchive"
      />
    </ModulePage>
    <div
      v-if="next"
      class="vault-compact-footer"
    >
      <v-btn
        variant="text"
        :loading="loading"
        @click="load(true)"
        >{{ messages.loadMore }}</v-btn
      >
      <span v-if="access !== 'all'">{{ messages.accessLoadedHint }}</span>
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
    <ModuleDialog
      v-model="detailOpen"
      class="vault-dialog"
      :title="detail?.name ?? messages.details"
      :subtitle="messages.details"
      :busy="busy"
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
        </dl>
        <p
          v-if="secretAvailable"
          class="vault-field-hint"
        >
          {{ messages.encryptedHint }}
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
        <ActionMenu
          v-if="canEdit(detail) || canArchive(detail)"
          above
          :label="messages.actions"
          :disabled="busy"
        >
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
            @click="toggleDetailArchive(detail)"
          />
        </ActionMenu>
        <v-btn
          v-if="canEdit(detail)"
          color="primary"
          :disabled="busy"
          @click="edit(detail)"
          >{{ messages.edit }}</v-btn
        >
      </template>
    </ModuleDialog>
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
      @transferred="transferred"
    />
    <VaultAudit
      v-if="auditOpen"
      v-model="auditOpen"
      :hotel-id="hotelId"
      :assignments="assignments"
    />
    <UndoSnackbar
      :message="notice"
      :undo="undoAction"
      @close="showNotice('')"
    />
  </div>
</template>
