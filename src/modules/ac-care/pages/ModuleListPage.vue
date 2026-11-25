<script setup lang="ts">
import ActionMenu from '../../../shared/action-menu.vue';
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import ModulePage from '../../../shared/ModulePage.vue';
import EmptyFilterChips from '../../../shared/empty-filter-chips.vue';
import FilterGroup from '../../../shared/filter-group.vue';
import ListRow from '../../../shared/list-row.vue';
import UndoSnackbar from '../../../shared/undo-snackbar.vue';
import { useUndoNotice } from '../../../core/use-optimistic-archive';
import { runtime } from '../../../config/runtime';
import type { ModuleAssignment } from '../../../core/module-access';
import AreasDialog from '../components/AreasDialog.vue';
import ComplaintForm from '../components/ComplaintForm.vue';
import ImportUnits from '../components/ImportUnits.vue';
import ServiceForm from '../components/ServiceForm.vue';
import UnitForm from '../components/UnitForm.vue';
import UnitHistory from '../components/UnitHistory.vue';
import WorkDialog from '../components/WorkDialog.vue';
import {
  conditionKeys,
  conditionTones,
  dueLabel,
  errorMessage,
  fill,
  formatDay,
  refrigerantKeys,
  serviceIcons,
  serviceKeys,
  shortName,
  unitTypeKeys,
  useAcCareMessages,
} from '../composables/useAcCareMessages';
import { createDemoAcCareApi, demoDepartments, demoHotelId } from '../demo-api';
import { createLiveAcCareApi } from '../live-api';
import { conditions } from '../types';
import type {
  AcUnit,
  ComplaintKind,
  Condition,
  HistoryCursor,
  ImportRow,
  ServiceInput,
  ServiceType,
  Technician,
  UnitInput,
} from '../types';
import { daysBetween, dueTasks, hotelToday } from '../validation';
import type { Task, TaskBucket } from '../validation';
import '../styles.css';

const props = withDefaults(defineProps<{ access?: ModuleAssignment[] }>(), { access: () => [] });
const emit = defineEmits<{ back: [] }>();
const messages = useAcCareMessages();
const api = runtime.demo ? createDemoAcCareApi() : createLiveAcCareApi();

// Demo mode grants every capability on a sample department; production uses server grants.
const scope = computed<ModuleAssignment[]>(() =>
  runtime.demo
    ? demoDepartments.map((d) => ({
        moduleId: 'ac-care',
        hotelId: demoHotelId,
        hotelName: '',
        departmentId: d.id,
        departmentCode: d.id,
        departmentName: d.name,
        canRead: true,
        canWrite: true,
        canManage: true,
      }))
    : props.access.filter((row) => row.moduleId === 'ac-care' && row.canRead),
);
const hotelId = computed(() => scope.value[0]?.hotelId ?? '');
const hotelScope = computed(() => scope.value.filter((row) => row.hotelId === hotelId.value));
const can = (departmentId: string, flag: 'canWrite' | 'canManage') =>
  hotelScope.value.some((row) => row.departmentId === departmentId && row[flag]);
const managedDepartments = computed(() => hotelScope.value.filter((row) => row.canManage));
const canManageAny = computed(() => managedDepartments.value.length > 0);

const tab = ref<'tasks' | 'units'>('tasks');
const search = ref('');
const area = ref<string | null>(null);
const departmentId = ref<string | null>(null);
const condition = ref<Condition | null>(null);
const taskScope = ref<'mine' | 'all'>('all');
const showArchived = ref(false);

const units = ref<AcUnit[]>([]);
const today = ref(hotelToday());
const loading = ref(true);
const failure = ref('');
const { notice, undoAction, show: showNotice } = useUndoNotice();
let controller: AbortController | null = null;
let poll: number | undefined;
let scopeChosen = false;

async function load(quiet = false) {
  if (!hotelId.value) return;
  controller?.abort();
  controller = new AbortController();
  const signal = controller.signal;
  if (!quiet) loading.value = true;
  try {
    const list = await api.listUnits(hotelId.value, departmentId.value, showArchived.value, signal);
    units.value = list.units;
    today.value = list.today;
    failure.value = '';
    // Technicians with an area start on their own tasks; supervisors and others on all tasks.
    if (!scopeChosen) {
      scopeChosen = true;
      taskScope.value = list.units.some((u) => u.areaMine) ? 'mine' : 'all';
    }
  } catch (error) {
    if (!signal.aborted && !quiet) failure.value = errorMessage(messages.value, error);
  } finally {
    if (!signal.aborted) loading.value = false;
  }
}
watch([departmentId, showArchived], () => void load());
watch(hotelId, () => void load(), { immediate: true });
const dialogOpen = () =>
  formOpen.value ||
  importOpen.value ||
  serviceOpen.value ||
  complaintOpen.value ||
  workOpen.value ||
  areasOpen.value;
// The list refreshes every minute while visible, so claims by other technicians show up.
onMounted(() => {
  poll = window.setInterval(() => {
    if (document.visibilityState === 'visible' && !dialogOpen()) void load(true);
  }, 60000);
});
onBeforeUnmount(() => {
  controller?.abort();
  window.clearInterval(poll);
});

const byCode = (a: AcUnit, b: AcUnit) => a.code.localeCompare(b.code, undefined, { numeric: true });
const areas = computed(() =>
  [...new Set(units.value.map((u) => u.area))].sort((a, b) =>
    a === b ? 0 : !a ? 1 : !b ? -1 : a.localeCompare(b, undefined, { numeric: true }),
  ),
);
const matches = (unit: AcUnit) => {
  const text = search.value.trim().toLowerCase();
  return (
    (!text ||
      unit.code.toLowerCase().includes(text) ||
      unit.location.toLowerCase().includes(text)) &&
    (area.value === null || unit.area === area.value)
  );
};
const allTasks = computed(() => dueTasks(units.value.filter(matches), today.value));
const visibleTasks = computed(() =>
  taskScope.value === 'mine'
    ? allTasks.value.filter((task) => task.unit.areaMine || task.entry.work?.mine)
    : allTasks.value,
);
const bucketOrder: TaskBucket[] = ['overdue', 'week', 'upcoming'];
const bucketTitles: Record<TaskBucket, 'overdue' | 'thisWeek' | 'upcoming'> = {
  overdue: 'overdue',
  week: 'thisWeek',
  upcoming: 'upcoming',
};
const taskGroups = computed(() =>
  bucketOrder
    .map((bucket) => ({ bucket, tasks: visibleTasks.value.filter((t) => t.bucket === bucket) }))
    .filter((group) => group.tasks.length),
);
const visibleUnits = computed(() =>
  units.value
    .filter(
      (unit) => matches(unit) && (condition.value === null || unit.condition === condition.value),
    )
    .sort(byCode),
);

const hasFilters = computed(
  () =>
    !!search.value.trim() ||
    area.value !== null ||
    !!departmentId.value ||
    (tab.value === 'units' && condition.value !== null),
);
// Filters other than search; on phones they share one Filters button.
const filterCount = computed(
  () =>
    (area.value !== null ? 1 : 0) +
    (departmentId.value ? 1 : 0) +
    (tab.value === 'units' && condition.value !== null ? 1 : 0) +
    (tab.value === 'tasks' && taskScope.value === 'mine' ? 1 : 0),
);
const activeFilters = computed(() => {
  const rows: { key: string; label: string; clear: () => void }[] = [];
  if (search.value.trim())
    rows.push({
      key: 'search',
      label: `${messages.value.search}: “${search.value.trim()}”`,
      clear: () => (search.value = ''),
    });
  if (area.value !== null)
    rows.push({
      key: 'area',
      label: `${messages.value.area}: ${area.value || messages.value.noArea}`,
      clear: () => (area.value = null),
    });
  if (departmentId.value)
    rows.push({
      key: 'department',
      label: `${messages.value.department}: ${
        hotelScope.value.find((row) => row.departmentId === departmentId.value)?.departmentName ??
        departmentId.value
      }`,
      clear: () => (departmentId.value = null),
    });
  if (tab.value === 'units' && condition.value !== null)
    rows.push({
      key: 'condition',
      label: `${messages.value.condition}: ${messages.value[conditionKeys[condition.value]]}`,
      clear: () => (condition.value = null),
    });
  if (tab.value === 'tasks' && taskScope.value === 'mine')
    rows.push({
      key: 'scope',
      label: messages.value.scopeMine,
      clear: () => (taskScope.value = 'all'),
    });
  return rows;
});
function resetFilterGroup() {
  area.value = null;
  departmentId.value = null;
  condition.value = null;
  taskScope.value = 'all';
}
function resetFilters() {
  search.value = '';
  resetFilterGroup();
}

const isEmpty = computed(() =>
  tab.value === 'tasks' ? !taskGroups.value.length : !visibleUnits.value.length,
);
const emptyTitle = computed(() => {
  if (!units.value.length) return messages.value.emptyTitle;
  if (tab.value === 'tasks' && !hasFilters.value) return messages.value.noTasksTitle;
  return hasFilters.value ? messages.value.noResults : messages.value.noTasksTitle;
});
const emptyDescription = computed(() => {
  if (!units.value.length)
    return canManageAny.value ? messages.value.emptyDescription : messages.value.emptyReadOnly;
  if (tab.value === 'tasks' && taskScope.value === 'mine' && activeFilters.value.length === 1)
    return messages.value.noMyTasksDescription;
  if (hasFilters.value) return messages.value.noResultsHint;
  return messages.value.noTasksDescription;
});

// Row text
function workText(task: Pick<Task, 'entry'>) {
  const work = task.entry.work;
  if (!work) return '';
  if (work.state === 'postponed') return fill(messages.value.postponedNote, { note: work.note });
  if (work.mine) return messages.value.claimedByMe;
  return fill(work.assigned ? messages.value.assignedTo : messages.value.claimedBy, {
    name: shortName(work.userEmail),
  });
}
const takenByOther = (task: Task) => task.entry.work?.state === 'claimed' && !task.entry.work.mine;
const dueTone = (task: Task) =>
  task.bucket === 'overdue' ? 'danger' : task.bucket === 'week' ? 'warning' : 'neutral';
function unitDetails(unit: AcUnit) {
  return [
    unit.area || messages.value.noArea,
    messages.value[unitTypeKeys[unit.unitType]],
    unit.capacity,
    messages.value[refrigerantKeys[unit.refrigerant]],
  ]
    .filter(Boolean)
    .join(' · ');
}
function nextDue(unit: AcUnit) {
  const entry = [...unit.schedule].sort((a, b) => a.dueOn.localeCompare(b.dueOn))[0];
  if (!entry) return messages.value.noSchedule;
  const days = daysBetween(today.value, entry.dueOn);
  return fill(messages.value.nextDue, {
    service: messages.value[serviceKeys[entry.type]],
    when:
      Math.abs(days) <= 30 ? dueLabel(messages.value, days).toLowerCase() : formatDay(entry.dueOn),
  });
}
const mostDue = (unit: AcUnit): ServiceType =>
  dueTasks([unit], today.value, 100000)[0]?.entry.type ?? 'filter';

// Task actions
const busy = ref(new Set<string>());
const taskKey = (unit: AcUnit, type: ServiceType) => unit.id + ':' + type;
async function setWork(
  unit: AcUnit,
  type: ServiceType,
  action: 'claim' | 'release' | 'postpone' | 'assign',
  options: { note?: string; userId?: string } = {},
) {
  const key = taskKey(unit, type);
  busy.value = new Set(busy.value).add(key);
  try {
    await api.setWork(hotelId.value, unit, type, action, options);
    showNotice(
      action === 'claim'
        ? messages.value.claimed
        : action === 'release'
          ? messages.value.released
          : action === 'postpone'
            ? messages.value.postponed
            : messages.value.assigned,
    );
  } finally {
    const next = new Set(busy.value);
    next.delete(key);
    busy.value = next;
    await load(true);
  }
}
async function claim(task: Task) {
  try {
    await setWork(task.unit, task.entry.type, 'claim');
  } catch (error) {
    showNotice(errorMessage(messages.value, error));
  }
}
async function release(task: Task) {
  try {
    await setWork(task.unit, task.entry.type, 'release');
  } catch (error) {
    showNotice(errorMessage(messages.value, error));
  }
}

// Dialogs
const selected = ref<AcUnit | null>(null);
const selectedType = ref<ServiceType>('filter');
const serviceOpen = ref(false);
const complaintOpen = ref(false);
const historyOpen = ref(false);
const workOpen = ref(false);
const workMode = ref<'postpone' | 'assign'>('postpone');
const technicians = ref<Technician[]>([]);
function openService(unit: AcUnit, type: ServiceType = mostDue(unit)) {
  selected.value = unit;
  selectedType.value = type;
  serviceOpen.value = true;
}
function openComplaint(unit: AcUnit) {
  selected.value = unit;
  complaintOpen.value = true;
}
function openHistory(unit: AcUnit) {
  selected.value = unit;
  historyOpen.value = true;
}
async function openWork(task: Task, mode: 'postpone' | 'assign') {
  selected.value = task.unit;
  selectedType.value = task.entry.type;
  workMode.value = mode;
  if (mode === 'assign') {
    try {
      technicians.value = (await api.listAreas(hotelId.value, task.unit.departmentId)).technicians;
    } catch (error) {
      showNotice(errorMessage(messages.value, error));
      return;
    }
  }
  workOpen.value = true;
}
const submitWork = (value: string) =>
  setWork(
    selected.value!,
    selectedType.value,
    workMode.value,
    workMode.value === 'postpone' ? { note: value } : { userId: value },
  );
async function recordService(input: ServiceInput, key: string) {
  const saved = await api.recordService(hotelId.value, selected.value!, input, key);
  showNotice(
    saved.result === 'normal' ? messages.value.serviceNormal : messages.value.serviceAttention,
  );
  await load(true);
  return saved;
}
async function recordComplaint(kind: ComplaintKind, note: string, key: string) {
  await api.recordComplaint(hotelId.value, selected.value!, kind, note, key);
  showNotice(messages.value.complaintSaved);
  await load(true);
}
const loadHistory = (before: HistoryCursor | null, signal: AbortSignal) =>
  api.unitHistory(hotelId.value, selected.value!, before, signal);
function taskMenu(task: Task) {
  const rows: { key: string; icon: string; title: string; run: () => void }[] = [];
  const write = can(task.unit.departmentId, 'canWrite');
  const manage = can(task.unit.departmentId, 'canManage');
  const work = task.entry.work;
  if (write && (!takenByOther(task) || manage) && work?.mine)
    rows.push({
      key: 'postpone',
      icon: 'mdi-clock-outline',
      title: messages.value.postpone,
      run: () => void openWork(task, 'postpone'),
    });
  if (write && !work?.mine && (!takenByOther(task) || manage))
    rows.push({
      key: 'record',
      icon: 'mdi-wrench-outline',
      title: messages.value.recordService,
      run: () => openService(task.unit, task.entry.type),
    });
  if (write && !work && !takenByOther(task))
    rows.push({
      key: 'postpone',
      icon: 'mdi-clock-outline',
      title: messages.value.postpone,
      run: () => void openWork(task, 'postpone'),
    });
  if (manage)
    rows.push({
      key: 'assign',
      icon: 'mdi-account-arrow-right-outline',
      title: messages.value.assign,
      run: () => void openWork(task, 'assign'),
    });
  if (work && (work.mine || manage))
    rows.push({
      key: 'release',
      icon: 'mdi-hand-back-left-outline',
      title: messages.value.release,
      run: () => void release(task),
    });
  rows.push({
    key: 'history',
    icon: 'mdi-history',
    title: messages.value.history,
    run: () => openHistory(task.unit),
  });
  return rows;
}

// Units (manage)
const formOpen = ref(false);
const importOpen = ref(false);
const areasOpen = ref(false);
const editing = ref<AcUnit | null>(null);
function openForm(unit: AcUnit | null = null) {
  editing.value = unit;
  formOpen.value = true;
}
async function saveUnit(input: UnitInput) {
  const department = editing.value?.departmentId ?? managedDepartments.value[0].departmentId;
  await api.saveUnit(hotelId.value, department, input, editing.value ?? undefined);
  showNotice(messages.value.saved);
  await load(true);
}
const importRows = (rows: ImportRow[]) =>
  api.importUnits(hotelId.value, managedDepartments.value[0].departmentId, rows);
async function imported(text: string) {
  showNotice(text);
  await load(true);
}
// Archive and restore apply at once and offer Undo, like the other modules.
async function setUnitState(unit: AcUnit, action: 'archive' | 'restore' | 'broken' | 'normal') {
  try {
    await api.setUnitState(hotelId.value, unit, action);
    const committed: AcUnit = { ...unit, version: unit.version + 1 };
    if (action === 'archive' || action === 'restore')
      showNotice(
        action === 'archive' ? messages.value.archivedDone : messages.value.restoredDone,
        () => void undoArchive(committed, action === 'archive' ? 'restore' : 'archive'),
      );
    else showNotice(action === 'broken' ? messages.value.brokenDone : messages.value.normalDone);
  } catch (error) {
    showNotice(errorMessage(messages.value, error));
  }
  await load(true);
}
async function undoArchive(committed: AcUnit, action: 'archive' | 'restore') {
  try {
    await api.setUnitState(hotelId.value, committed, action);
    showNotice(action === 'archive' ? messages.value.archivedDone : messages.value.restoredDone);
  } catch (error) {
    showNotice(errorMessage(messages.value, error));
  }
  await load(true);
}
const areasDepartment = computed(
  () =>
    departmentId.value ??
    managedDepartments.value[0]?.departmentId ??
    hotelScope.value[0]?.departmentId ??
    '',
);
const loadAreas = (signal: AbortSignal) =>
  api.listAreas(hotelId.value, areasDepartment.value, signal);
const setAreaMember = (name: string, userId: string, action: 'add' | 'remove', backup: boolean) =>
  api.setAreaMember(hotelId.value, areasDepartment.value, name, userId, action, backup);
async function areasChanged(text: string) {
  showNotice(text);
  await load(true);
}

const areaItems = computed(() => [
  { value: null, title: messages.value.allAreas },
  ...areas.value.map((value) => ({ value, title: value || messages.value.noArea })),
]);
const departmentItems = computed(() => [
  { value: null, title: messages.value.allDepartments },
  ...hotelScope.value.map((row) => ({ value: row.departmentId, title: row.departmentName })),
]);
const conditionItems = computed(() => [
  { value: null, title: messages.value.allConditions },
  ...conditions.map((value) => ({ value, title: messages.value[conditionKeys[value]] })),
]);
const scopeItems = computed(() => [
  { value: 'all', title: messages.value.scopeAll },
  { value: 'mine', title: messages.value.scopeMine },
]);
const description = computed(
  () =>
    units.value.length +
    ' ' +
    (units.value.length === 1 ? messages.value.unitOne : messages.value.units),
);
</script>
<template>
  <div class="ac-module">
    <button
      class="module-breadcrumb"
      @click="emit('back')"
    >
      <v-icon
        icon="mdi-arrow-left"
        size="var(--workstel-icon-sm)"
      />{{ messages.back }}
    </button>
    <ModulePage
      :title="messages.title"
      :description="description"
      :empty-icon="hasFilters ? 'mdi-filter-off-outline' : 'mdi-air-conditioner'"
      :loading="loading"
      :error="failure"
      :empty="isEmpty"
      :empty-title="emptyTitle"
      :empty-description="emptyDescription"
      :retry-label="messages.retry"
      @retry="load()"
    >
      <template #actions>
        <v-btn
          variant="text"
          prepend-icon="mdi-account-group-outline"
          @click="areasOpen = true"
          >{{ messages.areasTitle }}</v-btn
        ><ActionMenu v-if="canManageAny"
          ><template #activator="{ props: menu }"
            ><v-btn
              v-bind="menu"
              color="primary"
              class="module-primary-action"
              prepend-icon="mdi-air-conditioner"
              append-icon="mdi-chevron-down"
              >{{ messages.manage }}</v-btn
            ></template
          ><v-list-item
            prepend-icon="mdi-plus"
            :title="messages.addUnit"
            @click="openForm()" /><v-list-item
            prepend-icon="mdi-table-arrow-down"
            :title="messages.importUnits"
            @click="importOpen = true" /><v-list-item
            :prepend-icon="showArchived ? 'mdi-eye-off-outline' : 'mdi-archive-eye-outline'"
            :title="showArchived ? messages.hideArchived : messages.showArchived"
            @click="showArchived = !showArchived"
        /></ActionMenu>
      </template>
      <template #toolbar>
        <v-alert
          v-if="runtime.demo"
          type="info"
          variant="tonal"
          density="compact"
          icon="mdi-air-conditioner"
          class="module-notice"
          >{{ messages.demoNotice }}</v-alert
        >
        <div class="ac-controls">
          <v-tabs
            v-model="tab"
            color="primary"
            density="compact"
            class="ac-tabs"
            :aria-label="messages.sections"
          >
            <v-tab
              value="tasks"
              prepend-icon="mdi-calendar-check-outline"
              >{{ messages.tabTasks }}</v-tab
            >
            <v-tab
              value="units"
              prepend-icon="mdi-air-conditioner"
              >{{ messages.tabUnits }}</v-tab
            >
          </v-tabs>
          <div class="ac-toolbar">
            <v-text-field
              v-model="search"
              class="ac-search"
              :placeholder="messages.search"
              :aria-label="messages.search"
              prepend-inner-icon="mdi-magnify"
              single-line
              clearable
              maxlength="80"
              @update:model-value="search = $event ?? ''"
            />
            <FilterGroup
              :count="filterCount"
              @reset="resetFilterGroup"
            >
              <v-select
                v-if="tab === 'tasks'"
                v-model="taskScope"
                :items="scopeItems"
                :label="messages.scope"
              />
              <v-select
                v-if="areas.length > 1"
                v-model="area"
                :items="areaItems"
                :label="messages.area"
              />
              <v-select
                v-if="tab === 'units'"
                v-model="condition"
                :items="conditionItems"
                :label="messages.condition"
              />
              <v-select
                v-if="hotelScope.length > 1"
                v-model="departmentId"
                :items="departmentItems"
                :label="messages.department"
              />
            </FilterGroup>
          </div>
        </div>
      </template>
      <template #empty-action>
        <EmptyFilterChips
          v-if="units.length && activeFilters.length"
          :filters="activeFilters"
          :reset-label="messages.reset"
          @reset="resetFilters"
        /><v-btn
          v-else-if="!units.length && canManageAny"
          variant="tonal"
          color="primary"
          prepend-icon="mdi-table-arrow-down"
          @click="importOpen = true"
          >{{ messages.importUnits }}</v-btn
        >
      </template>

      <template v-if="tab === 'tasks'">
        <section
          v-for="group in taskGroups"
          :key="group.bucket"
        >
          <h2 class="ac-section-title">
            {{ messages[bucketTitles[group.bucket]] }} · {{ group.tasks.length }}
          </h2>
          <ul class="list-rows">
            <ListRow
              v-for="task in group.tasks"
              :key="taskKey(task.unit, task.entry.type)"
              :icon="serviceIcons[task.entry.type]"
            >
              <strong>{{ task.unit.code }} · {{ task.unit.location }}</strong>
              <small
                >{{ messages[serviceKeys[task.entry.type]] }} ·
                {{ task.unit.area || messages.noArea }}</small
              >
              <template #status>
                <span
                  class="list-row-chip"
                  :class="'ac-chip--' + dueTone(task)"
                  >{{ dueLabel(messages, task.daysLeft) }}</span
                >
                <small
                  v-if="task.entry.work"
                  class="ac-work"
                  :class="{ 'ac-work--mine': task.entry.work.mine }"
                  >{{ workText(task) }}</small
                >
                <small v-else-if="!task.entry.lastDoneAt">{{ messages.neverServiced }}</small>
              </template>
              <template #actions>
                <v-btn
                  v-if="task.entry.work?.mine && can(task.unit.departmentId, 'canWrite')"
                  variant="tonal"
                  class="row-primary-action"
                  prepend-icon="mdi-wrench-outline"
                  :aria-label="messages.recordService + ' — ' + task.unit.code"
                  @click="openService(task.unit, task.entry.type)"
                  >{{ messages.recordService }}</v-btn
                ><v-btn
                  v-else-if="!takenByOther(task) && can(task.unit.departmentId, 'canWrite')"
                  variant="tonal"
                  class="row-primary-action"
                  prepend-icon="mdi-hand-back-right-outline"
                  :loading="busy.has(taskKey(task.unit, task.entry.type))"
                  :aria-label="messages.claim + ' — ' + task.unit.code"
                  @click="claim(task)"
                  >{{ messages.claim }}</v-btn
                ><ActionMenu :label="messages.moreActions + ' — ' + task.unit.code"
                  ><v-list-item
                    v-for="item in taskMenu(task)"
                    :key="item.key"
                    :prepend-icon="item.icon"
                    :title="item.title"
                    @click="item.run()"
                /></ActionMenu>
              </template>
            </ListRow>
          </ul>
        </section>
      </template>

      <ul
        v-else
        class="list-rows"
      >
        <ListRow
          v-for="unit in visibleUnits"
          :key="unit.id"
          icon="mdi-air-conditioner"
          :archived="unit.archived"
        >
          <strong>{{ unit.code }} · {{ unit.location }}</strong>
          <small>{{ unitDetails(unit) }}</small>
          <template #status>
            <span
              class="list-row-chip"
              :class="'ac-chip--' + (unit.archived ? 'neutral' : conditionTones[unit.condition])"
              >{{
                unit.archived ? messages.archived : messages[conditionKeys[unit.condition]]
              }}</span
            >
            <small>{{ nextDue(unit) }}</small>
            <small
              v-if="unit.complaints60d"
              class="ac-flag"
              >{{
                unit.complaints60d === 1
                  ? messages.complaintOne
                  : fill(messages.complaintsCount, { count: unit.complaints60d })
              }}</small
            >
            <small
              v-if="unit.refills90d > 1"
              class="ac-flag"
              >{{ fill(messages.refillsCount, { count: unit.refills90d }) }}</small
            >
          </template>
          <template #actions>
            <v-btn
              v-if="!unit.archived && can(unit.departmentId, 'canWrite')"
              variant="tonal"
              class="row-primary-action"
              prepend-icon="mdi-wrench-outline"
              :aria-label="messages.recordService + ' — ' + unit.code"
              @click="openService(unit)"
              >{{ messages.recordService }}</v-btn
            ><v-btn
              variant="text"
              class="row-secondary-action"
              prepend-icon="mdi-history"
              :aria-label="messages.history + ' — ' + unit.code"
              :title="messages.history"
              @click="openHistory(unit)"
              >{{ messages.history }}</v-btn
            ><ActionMenu
              v-if="can(unit.departmentId, 'canWrite')"
              :label="messages.moreActions + ' — ' + unit.code"
              ><v-list-item
                v-if="!unit.archived"
                prepend-icon="mdi-message-alert-outline"
                :title="messages.reportComplaint"
                @click="openComplaint(unit)" /><template v-if="can(unit.departmentId, 'canManage')"
                ><v-list-item
                  prepend-icon="mdi-pencil-outline"
                  :title="messages.editUnit"
                  @click="openForm(unit)" /><v-list-item
                  v-if="!unit.archived"
                  :prepend-icon="
                    unit.condition === 'broken'
                      ? 'mdi-check-circle-outline'
                      : 'mdi-alert-octagon-outline'
                  "
                  :title="unit.condition === 'broken' ? messages.markNormal : messages.markBroken"
                  @click="
                    setUnitState(unit, unit.condition === 'broken' ? 'normal' : 'broken')
                  " /><v-list-item
                  :prepend-icon="
                    unit.archived ? 'mdi-archive-arrow-up-outline' : 'mdi-archive-outline'
                  "
                  :title="unit.archived ? messages.restore : messages.archive"
                  @click="setUnitState(unit, unit.archived ? 'restore' : 'archive')" /></template
            ></ActionMenu>
          </template>
        </ListRow>
      </ul>
    </ModulePage>

    <ServiceForm
      v-model="serviceOpen"
      :unit="selected"
      :initial-type="selectedType"
      :record="recordService"
    />
    <ComplaintForm
      v-model="complaintOpen"
      :unit="selected"
      :record="recordComplaint"
    />
    <UnitHistory
      v-model="historyOpen"
      :unit="selected"
      :load="loadHistory"
    />
    <WorkDialog
      v-model="workOpen"
      :mode="workMode"
      :unit="selected"
      :type="selectedType"
      :technicians="technicians"
      :submit="submitWork"
    />
    <UnitForm
      v-model="formOpen"
      :unit="editing"
      :areas="areas.filter(Boolean)"
      :save="saveUnit"
    />
    <ImportUnits
      v-model="importOpen"
      :save="importRows"
      @done="imported"
    />
    <AreasDialog
      v-model="areasOpen"
      :can-manage="!!areasDepartment && can(areasDepartment, 'canManage')"
      :load="loadAreas"
      :set-member="setAreaMember"
      @changed="areasChanged"
    />
    <UndoSnackbar
      :message="notice"
      :undo="undoAction"
      @close="showNotice('')"
    />
  </div>
</template>
