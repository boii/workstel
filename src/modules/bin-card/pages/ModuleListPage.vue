<script setup lang="ts">
import ActionMenu from '../../../shared/action-menu.vue';
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import ModulePage from '../../../shared/ModulePage.vue';
import FilterGroup from '../../../shared/filter-group.vue';
import ListRow from '../../../shared/list-row.vue';
import UndoSnackbar from '../../../shared/undo-snackbar.vue';
import { useOptimisticArchive, useUndoNotice } from '../../../core/use-optimistic-archive';
import { runtime } from '../../../config/runtime';
import type { ModuleAssignment } from '../../../core/module-access';
import EntryForm from '../components/EntryForm.vue';
import ItemForm from '../components/ItemForm.vue';
import StockLedger from '../components/StockLedger.vue';
import {
  errorMessage,
  formatQuantity,
  useBinCardMessages,
} from '../composables/useBinCardMessages';
import { createDemoBinCardApi, demoDepartments, demoHotelId } from '../demo-api';
import { createLiveBinCardApi } from '../live-api';
import type { ItemStatus, StockEntryInput, StockItem, StockItemInput } from '../types';
import { stockLevel } from '../validation';
import '../styles.css';

const props = withDefaults(defineProps<{ access?: ModuleAssignment[] }>(), { access: () => [] });
const emit = defineEmits<{ back: [] }>();
const messages = useBinCardMessages();
const api = runtime.demo ? createDemoBinCardApi() : createLiveBinCardApi();

// Demo mode grants every capability on sample departments; production uses server grants.
const scope = computed<ModuleAssignment[]>(() =>
  runtime.demo
    ? demoDepartments.map((d) => ({
        moduleId: 'bin-card',
        hotelId: demoHotelId,
        hotelName: '',
        departmentId: d.id,
        departmentCode: d.id,
        departmentName: d.name,
        canRead: true,
        canWrite: true,
        canManage: true,
      }))
    : props.access.filter((row) => row.moduleId === 'bin-card' && row.canRead),
);
const hotelId = computed(() => scope.value[0]?.hotelId ?? '');
const hotelScope = computed(() => scope.value.filter((row) => row.hotelId === hotelId.value));
const can = (departmentId: string, flag: 'canWrite' | 'canManage') =>
  hotelScope.value.some((row) => row.departmentId === departmentId && row[flag]);
const manageableDepartments = computed(() =>
  hotelScope.value
    .filter((row) => row.canManage)
    .map((row) => ({ id: row.departmentId, name: row.departmentName })),
);

const items = ref<StockItem[]>([]);
const nextCursor = ref<string | null>(null);
const loading = ref(true);
const loadingMore = ref(false);
const failure = ref('');
const search = ref('');
const departmentId = ref<string | null>(null);
const status = ref<ItemStatus | 'all'>('active');
const lowOnly = ref(false);
const { notice, undoAction, show: showNotice } = useUndoNotice();
let controller: AbortController | null = null;
let searchTimer: ReturnType<typeof setTimeout> | undefined;

async function load(after: string | null = null) {
  if (!hotelId.value) return;
  controller?.abort();
  controller = new AbortController();
  const signal = controller.signal;
  if (after) loadingMore.value = true;
  else loading.value = true;
  failure.value = '';
  try {
    const page = await api.listItems(
      {
        hotelId: hotelId.value,
        departmentId: departmentId.value,
        status: status.value,
        search: search.value,
        lowOnly: lowOnly.value,
        after,
      },
      signal,
    );
    items.value = after ? [...items.value, ...page.data] : page.data;
    nextCursor.value = page.nextCursor;
  } catch (error) {
    if (!signal.aborted) failure.value = errorMessage(messages.value, error);
  } finally {
    if (!signal.aborted) {
      loading.value = false;
      loadingMore.value = false;
    }
  }
}
watch([departmentId, status, lowOnly], () => void load());
watch(search, () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => void load(), 300);
});
watch(hotelId, () => void load(), { immediate: true });
onBeforeUnmount(() => {
  controller?.abort();
  clearTimeout(searchTimer);
});

const hasFilters = computed(
  () => !!search.value || !!departmentId.value || status.value !== 'active' || lowOnly.value,
);
// Filters other than search; on phones they share one Filters button.
const filterCount = computed(
  () =>
    (departmentId.value ? 1 : 0) + (status.value !== 'active' ? 1 : 0) + (lowOnly.value ? 1 : 0),
);
function resetFilterGroup() {
  departmentId.value = null;
  status.value = 'active';
  lowOnly.value = false;
}
function resetFilters() {
  search.value = '';
  departmentId.value = null;
  status.value = 'active';
  lowOnly.value = false;
}

const formOpen = ref(false);
const editing = ref<StockItem | null>(null);
const entryOpen = ref(false);
const ledgerOpen = ref(false);
const selected = ref<StockItem | null>(null);
function openForm(item: StockItem | null = null) {
  editing.value = item;
  formOpen.value = true;
}
async function saveItem(input: StockItemInput) {
  await api.saveItem(hotelId.value, input, editing.value ?? undefined);
  notice.value = messages.value.saved;
  await load();
}
const { toggle: toggleArchive } = useOptimisticArchive({
  rows: items,
  statusFilter: () => status.value,
  commit: (item, archived) => api.setArchived(hotelId.value, item, archived),
  show: showNotice,
  messages: () => ({
    archived: messages.value.archivedDone,
    restored: messages.value.restoredDone,
  }),
  errorMessage: (error) => errorMessage(messages.value, error),
  reload: () => load(),
});
function openEntry(item: StockItem) {
  selected.value = item;
  entryOpen.value = true;
}
function openLedger(item: StockItem) {
  selected.value = item;
  ledgerOpen.value = true;
}
async function recordEntry(input: StockEntryInput, key: string) {
  const item = selected.value!;
  const saved = await api.recordEntry(hotelId.value, item.id, input, key);
  notice.value = messages.value.entrySaved + ' ' + formatQuantity(saved.balance) + ' ' + item.unit;
  await load();
}
const loadLedger = (before: string | null, signal: AbortSignal) =>
  api.listEntries(hotelId.value, selected.value!.id, before, signal);

const stockItems = computed(() => [
  { value: false, title: messages.value.allStock },
  { value: true, title: messages.value.lowOnly },
]);
const statusItems = computed(() => [
  { value: 'active', title: messages.value.active },
  { value: 'archived', title: messages.value.archived },
  { value: 'all', title: messages.value.all },
]);
const departmentItems = computed(() => [
  { value: null, title: messages.value.allDepartments },
  ...hotelScope.value.map((row) => ({ value: row.departmentId, title: row.departmentName })),
]);
</script>
<template>
  <div class="bin-module">
    <button
      class="bin-breadcrumb"
      @click="emit('back')"
    >
      <v-icon
        icon="mdi-arrow-left"
        size="var(--workstel-icon-sm)"
      />{{ messages.back }}
    </button>
    <ModulePage
      :title="messages.title"
      :description="items.length + ' ' + (items.length === 1 ? messages.itemOne : messages.items)"
      :empty-icon="hasFilters ? 'mdi-filter-off-outline' : 'mdi-package-variant-closed'"
      :loading="loading"
      :error="failure"
      :empty="!items.length"
      :empty-title="hasFilters ? messages.noResults : messages.emptyTitle"
      :empty-description="
        hasFilters
          ? messages.noResultsHint
          : manageableDepartments.length
            ? messages.emptyDescription
            : messages.emptyReadOnly
      "
      :retry-label="messages.retry"
      @retry="load()"
    >
      <template #actions>
        <v-btn
          v-if="manageableDepartments.length"
          color="primary"
          class="module-primary-action"
          prepend-icon="mdi-plus"
          :aria-label="messages.add"
          @click="openForm()"
          >{{ messages.add }}</v-btn
        >
      </template>
      <template #toolbar>
        <v-alert
          v-if="runtime.demo"
          type="info"
          variant="tonal"
          density="compact"
          icon="mdi-package-variant-closed"
          class="bin-notice"
          >{{ messages.demoNotice }}</v-alert
        >
        <div class="bin-toolbar">
          <v-text-field
            v-model="search"
            class="bin-search"
            :placeholder="messages.search"
            :aria-label="messages.search"
            prepend-inner-icon="mdi-magnify"
            single-line
            clearable
            maxlength="150"
            @update:model-value="search = $event ?? ''"
          />
          <FilterGroup
            :count="filterCount"
            @reset="resetFilterGroup"
          >
            <v-select
              v-if="hotelScope.length > 1"
              v-model="departmentId"
              :items="departmentItems"
              :label="messages.department"
            />
            <v-select
              v-model="status"
              :items="statusItems"
              :label="messages.status"
            />
            <v-select
              v-model="lowOnly"
              :items="stockItems"
              :label="messages.stockFilter"
            />
          </FilterGroup>
        </div>
      </template>
      <template #empty-action>
        <v-btn
          v-if="hasFilters"
          variant="text"
          color="primary"
          @click="resetFilters"
          >{{ messages.reset }}</v-btn
        ><v-btn
          v-else-if="manageableDepartments.length"
          variant="tonal"
          color="primary"
          prepend-icon="mdi-plus"
          @click="openForm()"
          >{{ messages.add }}</v-btn
        >
      </template>
      <ul class="list-rows">
        <ListRow
          v-for="item in items"
          :key="item.id"
          class="bin-row"
          icon="mdi-package-variant-closed"
          :archived="item.status === 'archived'"
        >
          <span class="bin-code">{{ item.code }}</span>
          <strong>{{ item.name }}</strong>
          <small>{{ [item.location, item.departmentName].filter(Boolean).join(' · ') }}</small>
          <template #status>
            <small>{{ messages.balance }}</small>
            <strong class="bin-balance">{{ formatQuantity(item.balance) }} {{ item.unit }}</strong>
            <span
              v-if="stockLevel(item) !== 'ok'"
              class="list-row-chip bin-level"
              :class="'bin-level--' + stockLevel(item)"
              >{{ stockLevel(item) === 'out' ? messages.stockOut : messages.stockLow }}</span
            >
          </template>
          <template #actions>
            <v-btn
              v-if="item.status === 'active' && can(item.departmentId, 'canWrite')"
              variant="tonal"
              class="row-primary-action"
              prepend-icon="mdi-swap-vertical"
              :aria-label="messages.record + ' — ' + item.name"
              @click="openEntry(item)"
              >{{ messages.record }}</v-btn
            ><v-btn
              variant="text"
              class="row-secondary-action"
              prepend-icon="mdi-format-list-bulleted"
              :aria-label="messages.ledger + ' — ' + item.name"
              :title="messages.ledger"
              @click="openLedger(item)"
              >{{ messages.ledger }}</v-btn
            ><ActionMenu
              v-if="can(item.departmentId, 'canManage')"
              :label="messages.moreActions + ' — ' + item.name"
              ><v-list-item
                prepend-icon="mdi-pencil-outline"
                :title="messages.edit"
                @click="openForm(item)" /><v-list-item
                :prepend-icon="
                  item.status === 'active' ? 'mdi-archive-outline' : 'mdi-archive-arrow-up-outline'
                "
                :title="item.status === 'active' ? messages.archive : messages.restore"
                @click="toggleArchive(item)"
            /></ActionMenu>
          </template>
        </ListRow>
      </ul>
      <v-btn
        v-if="nextCursor"
        variant="text"
        color="primary"
        class="mt-3"
        :loading="loadingMore"
        @click="load(nextCursor)"
        >{{ messages.loadMore }}</v-btn
      >
    </ModulePage>
    <ItemForm
      v-model="formOpen"
      :item="editing"
      :departments="manageableDepartments"
      :save="saveItem"
    />
    <EntryForm
      v-model="entryOpen"
      :item="selected"
      :record="recordEntry"
    />
    <StockLedger
      v-model="ledgerOpen"
      :item="selected"
      :load="loadLedger"
    />
    <UndoSnackbar
      :message="notice"
      :undo="undoAction"
      @close="showNotice('')"
    />
  </div>
</template>
