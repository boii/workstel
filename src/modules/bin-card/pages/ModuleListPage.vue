<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import ModulePage from '../../../shared/ModulePage.vue';
import KeyboardShortcuts from '../../../shared/keyboard-shortcuts.vue';
import { runtime } from '../../../config/runtime';
import { t } from '../../../i18n';
import type { ModuleAssignment } from '../../../core/module-access';
import { useShortcuts } from '../../../core/use-shortcuts';
import { focusFieldInput } from '../../../core/focus-field';
import type { FocusableField } from '../../../core/focus-field';
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
const notice = ref('');
let controller: AbortController | null = null;
let searchTimer: ReturnType<typeof setTimeout> | undefined;

async function load(after: string | null = null) {
  if (!hotelId.value) return;
  controller?.abort();
  controller = new AbortController();
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
      controller.signal,
    );
    items.value = after ? [...items.value, ...page.data] : page.data;
    nextCursor.value = page.nextCursor;
  } catch (error) {
    if (!controller.signal.aborted) failure.value = errorMessage(messages.value, error);
  } finally {
    loading.value = false;
    loadingMore.value = false;
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
async function toggleArchive(item: StockItem) {
  try {
    await api.setArchived(hotelId.value, item, item.status === 'active');
    notice.value =
      item.status === 'active' ? messages.value.archivedDone : messages.value.restoredDone;
  } catch (error) {
    notice.value = errorMessage(messages.value, error);
  }
  await load();
}
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

const searchField = ref<FocusableField | null>(null);
const shortcutsOpen = ref(false);
const anyOpen = computed(
  () => formOpen.value || entryOpen.value || ledgerOpen.value || shortcutsOpen.value,
);
useShortcuts(() => [
  { key: '/', run: () => focusFieldInput(searchField.value) },
  { key: '?', shift: true, run: () => (shortcutsOpen.value = true) },
  {
    key: 'n',
    when: () => manageableDepartments.value.length > 0 && !anyOpen.value,
    run: () => openForm(),
  },
]);
const shortcutRows = computed(() => [
  { keys: '/', label: messages.value.search },
  ...(manageableDepartments.value.length ? [{ keys: 'N', label: messages.value.add }] : []),
  { keys: '?', label: t('shortcutList') },
  { keys: 'Esc', label: t('shortcutClose') },
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
        size="16"
      />{{ messages.back }}
    </button>
    <ModulePage
      :title="messages.title"
      :description="items.length + ' ' + messages.items"
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
            ref="searchField"
            v-model="search"
            class="bin-search"
            :placeholder="messages.search"
            :aria-label="messages.search"
            prepend-inner-icon="mdi-magnify"
            single-line
            clearable
            maxlength="150"
          />
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
        </div>
        <v-checkbox
          v-model="lowOnly"
          :label="messages.lowOnly"
          density="compact"
          color="primary"
          hide-details
          class="bin-low-filter"
        />
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
      <ul class="bin-list">
        <li
          v-for="item in items"
          :key="item.id"
          class="bin-row"
          :class="{ 'bin-row--archived': item.status === 'archived' }"
        >
          <div class="bin-identity">
            <span class="bin-code">{{ item.code }}</span>
            <strong>{{ item.name }}</strong>
            <small>{{ [item.location, item.departmentName].filter(Boolean).join(' · ') }}</small>
          </div>
          <div class="bin-balance">
            <small>{{ messages.balance }}</small>
            <strong>{{ formatQuantity(item.balance) }} {{ item.unit }}</strong>
            <span
              v-if="stockLevel(item) !== 'ok'"
              class="bin-level"
              :class="'bin-level--' + stockLevel(item)"
              >{{ stockLevel(item) === 'out' ? messages.stockOut : messages.stockLow }}</span
            >
          </div>
          <div class="bin-actions">
            <v-btn
              v-if="item.status === 'active' && can(item.departmentId, 'canWrite')"
              color="primary"
              variant="tonal"
              prepend-icon="mdi-swap-vertical"
              @click="openEntry(item)"
              >{{ messages.record }}</v-btn
            ><v-btn
              variant="text"
              prepend-icon="mdi-format-list-bulleted"
              @click="openLedger(item)"
              >{{ messages.ledger }}</v-btn
            ><v-menu v-if="can(item.departmentId, 'canManage')"
              ><template #activator="{ props: menu }"
                ><v-btn
                  v-bind="menu"
                  icon="mdi-dots-vertical"
                  variant="text"
                  :aria-label="messages.moreActions + ' — ' + item.name" /></template
              ><v-list density="compact"
                ><v-list-item
                  prepend-icon="mdi-pencil-outline"
                  :title="messages.edit"
                  @click="openForm(item)" /><v-list-item
                  :prepend-icon="
                    item.status === 'active'
                      ? 'mdi-archive-outline'
                      : 'mdi-archive-arrow-up-outline'
                  "
                  :title="item.status === 'active' ? messages.archive : messages.restore"
                  @click="toggleArchive(item)" /></v-list
            ></v-menu>
          </div>
        </li>
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
    <KeyboardShortcuts
      v-model="shortcutsOpen"
      :rows="shortcutRows"
    />
    <v-snackbar
      :model-value="!!notice"
      timeout="3000"
      @update:model-value="notice = ''"
      >{{ notice }}</v-snackbar
    >
  </div>
</template>
