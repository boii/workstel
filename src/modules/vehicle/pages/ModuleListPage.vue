<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import ModulePage from '../../../shared/ModulePage.vue';
import FilterGroup from '../../../shared/filter-group.vue';
import UndoSnackbar from '../../../shared/undo-snackbar.vue';
import { useOptimisticArchive, useUndoNotice } from '../../../core/use-optimistic-archive';
import { runtime } from '../../../config/runtime';
import type { ModuleAssignment } from '../../../core/module-access';
import { useShortcuts } from '../../../core/use-shortcuts';
import { focusFieldInput } from '../../../core/focus-field';
import type { FocusableField } from '../../../core/focus-field';
import KeyboardShortcuts from '../../../shared/keyboard-shortcuts.vue';
import { t } from '../../../i18n';
import InspectionForm from '../components/InspectionForm.vue';
import InspectionHistory from '../components/InspectionHistory.vue';
import VehicleForm from '../components/VehicleForm.vue';
import { errorMessage, formatTime, useVehicleMessages } from '../composables/useVehicleMessages';
import { createDemoVehicleApi, demoDepartments, demoHotelId } from '../demo-api';
import { createLiveVehicleApi } from '../live-api';
import type { InspectionInput, Vehicle, VehicleInput, VehicleStatus } from '../types';
import '../styles.css';

const props = withDefaults(defineProps<{ access?: ModuleAssignment[] }>(), { access: () => [] });
const emit = defineEmits<{ back: [] }>();
const messages = useVehicleMessages();
const api = runtime.demo ? createDemoVehicleApi() : createLiveVehicleApi();

// Demo mode grants every capability on sample departments; production uses server grants.
const scope = computed<ModuleAssignment[]>(() =>
  runtime.demo
    ? demoDepartments.map((d) => ({
        moduleId: 'vehicle',
        hotelId: demoHotelId,
        hotelName: '',
        departmentId: d.id,
        departmentCode: d.id,
        departmentName: d.name,
        canRead: true,
        canWrite: true,
        canManage: true,
      }))
    : props.access.filter((row) => row.moduleId === 'vehicle' && row.canRead),
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

const vehicles = ref<Vehicle[]>([]);
const nextCursor = ref<string | null>(null);
const loading = ref(true);
const loadingMore = ref(false);
const failure = ref('');
const search = ref('');
const departmentId = ref<string | null>(null);
const status = ref<VehicleStatus | 'all'>('active');
const { notice, undoAction, show: showNotice } = useUndoNotice();
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
    const page = await api.listVehicles(
      {
        hotelId: hotelId.value,
        departmentId: departmentId.value,
        status: status.value,
        search: search.value,
        after,
      },
      controller.signal,
    );
    vehicles.value = after ? [...vehicles.value, ...page.data] : page.data;
    nextCursor.value = page.nextCursor;
  } catch (error) {
    if (!controller.signal.aborted) failure.value = errorMessage(messages.value, error);
  } finally {
    loading.value = false;
    loadingMore.value = false;
  }
}
watch([departmentId, status], () => void load());
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
  () => !!search.value || !!departmentId.value || status.value !== 'active',
);
// Filters other than search; on phones they share one Filters button.
const filterCount = computed(
  () => (departmentId.value ? 1 : 0) + (status.value !== 'active' ? 1 : 0),
);
function resetFilterGroup() {
  departmentId.value = null;
  status.value = 'active';
}
function resetFilters() {
  search.value = '';
  departmentId.value = null;
  status.value = 'active';
}

const formOpen = ref(false);
const editing = ref<Vehicle | null>(null);
const inspectOpen = ref(false);
const historyOpen = ref(false);
const selected = ref<Vehicle | null>(null);
function openForm(vehicle: Vehicle | null = null) {
  editing.value = vehicle;
  formOpen.value = true;
}
async function saveVehicle(input: VehicleInput) {
  await api.saveVehicle(hotelId.value, input, editing.value ?? undefined);
  notice.value = messages.value.saved;
  await load();
}
const { toggle: toggleArchive } = useOptimisticArchive({
  rows: vehicles,
  statusFilter: () => status.value,
  commit: (vehicle, archived) => api.setArchived(hotelId.value, vehicle, archived),
  show: showNotice,
  messages: () => ({
    archived: messages.value.archivedDone,
    restored: messages.value.restoredDone,
  }),
  errorMessage: (error) => errorMessage(messages.value, error),
  reload: () => load(),
});
function openInspection(vehicle: Vehicle) {
  selected.value = vehicle;
  inspectOpen.value = true;
}
function openHistory(vehicle: Vehicle) {
  selected.value = vehicle;
  historyOpen.value = true;
}
async function recordInspection(input: InspectionInput, key: string) {
  const saved = await api.recordInspection(hotelId.value, selected.value!.id, input, key);
  notice.value =
    saved.result === 'pass' ? messages.value.inspectionPass : messages.value.inspectionAttention;
  await load();
}
const loadHistory = (before: string | null, signal: AbortSignal) =>
  api.listInspections(hotelId.value, selected.value!.id, before, signal);

const searchField = ref<FocusableField | null>(null);
const shortcutsOpen = ref(false);
const anyOpen = computed(
  () => formOpen.value || inspectOpen.value || historyOpen.value || shortcutsOpen.value,
);
useShortcuts(
  () => [
    { key: '/', run: () => focusFieldInput(searchField.value) },
    { key: '?', shift: true, run: () => (shortcutsOpen.value = true) },
    {
      key: 'n',
      when: () => manageableDepartments.value.length > 0 && !anyOpen.value,
      run: () => openForm(),
    },
  ],
  () => true,
);
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
  <div class="vehicle-module">
    <button
      class="vehicle-breadcrumb"
      @click="emit('back')"
    >
      <v-icon
        icon="mdi-arrow-left"
        size="16"
      />{{ messages.back }}
    </button>
    <ModulePage
      :title="messages.title"
      :description="
        vehicles.length + ' ' + (vehicles.length === 1 ? messages.vehicleOne : messages.vehicles)
      "
      :empty-icon="hasFilters ? 'mdi-filter-off-outline' : 'mdi-car-outline'"
      :loading="loading"
      :error="failure"
      :empty="!vehicles.length"
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
          icon="mdi-car-outline"
          class="vehicle-notice"
          >{{ messages.demoNotice }}</v-alert
        >
        <div class="vehicle-toolbar">
          <v-text-field
            ref="searchField"
            v-model="search"
            class="vehicle-search"
            :placeholder="messages.search"
            :aria-label="messages.search"
            prepend-inner-icon="mdi-magnify"
            single-line
            clearable
            maxlength="100"
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
      <ul class="vehicle-list">
        <li
          v-for="vehicle in vehicles"
          :key="vehicle.id"
          class="vehicle-row"
          :class="{ 'vehicle-row--archived': vehicle.status === 'archived' }"
        >
          <div class="vehicle-identity">
            <v-icon
              icon="mdi-car-outline"
              size="22"
            />
            <div>
              <strong>{{ vehicle.name }}</strong>
              <span class="vehicle-plate">{{ vehicle.plateNumber }}</span>
              <small>{{ vehicle.departmentName }}</small>
            </div>
          </div>
          <div class="vehicle-last">
            <small>{{ messages.lastInspection }}</small>
            <template v-if="vehicle.lastInspectedAt">
              <span
                class="vehicle-result"
                :class="'vehicle-result--' + vehicle.lastResult"
                >{{ vehicle.lastResult === 'pass' ? messages.pass : messages.attention }}</span
              ><span class="vehicle-time">{{ formatTime(vehicle.lastInspectedAt) }}</span>
            </template>
            <span
              v-else
              class="vehicle-time"
              >{{ messages.notInspected }}</span
            >
          </div>
          <div class="vehicle-actions">
            <v-btn
              v-if="vehicle.status === 'active' && can(vehicle.departmentId, 'canWrite')"
              color="primary"
              variant="tonal"
              prepend-icon="mdi-clipboard-check-outline"
              @click="openInspection(vehicle)"
              >{{ messages.inspect }}</v-btn
            ><v-btn
              variant="text"
              prepend-icon="mdi-history"
              @click="openHistory(vehicle)"
              >{{ messages.history }}</v-btn
            ><v-menu v-if="can(vehicle.departmentId, 'canManage')"
              ><template #activator="{ props: menu }"
                ><v-btn
                  v-bind="menu"
                  icon="mdi-dots-vertical"
                  variant="text"
                  :aria-label="messages.moreActions + ' — ' + vehicle.name" /></template
              ><v-list density="compact"
                ><v-list-item
                  prepend-icon="mdi-pencil-outline"
                  :title="messages.edit"
                  @click="openForm(vehicle)" /><v-list-item
                  :prepend-icon="
                    vehicle.status === 'active'
                      ? 'mdi-archive-outline'
                      : 'mdi-archive-arrow-up-outline'
                  "
                  :title="vehicle.status === 'active' ? messages.archive : messages.restore"
                  @click="toggleArchive(vehicle)" /></v-list
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
    <VehicleForm
      v-model="formOpen"
      :vehicle="editing"
      :departments="manageableDepartments"
      :save="saveVehicle"
    />
    <InspectionForm
      v-model="inspectOpen"
      :vehicle="selected"
      :record="recordInspection"
    />
    <InspectionHistory
      v-model="historyOpen"
      :vehicle="selected"
      :load="loadHistory"
    />
    <KeyboardShortcuts
      v-model="shortcutsOpen"
      :rows="shortcutRows"
    />
    <UndoSnackbar
      :message="notice"
      :undo="undoAction"
      @close="showNotice('')"
    />
  </div>
</template>
