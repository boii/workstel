<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import ModulePage from '../../../shared/ModulePage.vue';
import KeyboardShortcuts from '../../../shared/keyboard-shortcuts.vue';
import { runtime } from '../../../config/runtime';
import { t } from '../../../i18n';
import type { ModuleAssignment } from '../../../core/module-access';
import { ModuleRequestError } from '../../../core/module-rpc';
import { useShortcuts } from '../../../core/use-shortcuts';
import { focusFieldInput } from '../../../core/focus-field';
import type { FocusableField } from '../../../core/focus-field';
import ImportRooms from '../components/ImportRooms.vue';
import RoomDialog from '../components/RoomDialog.vue';
import RoomForm from '../components/RoomForm.vue';
import {
  errorMessage,
  formatTime,
  shortName,
  statusCodeKeys,
  statusKeys,
  taskIcons,
  taskKeys,
  taskStatusKeys,
  useHousekeepingMessages,
  useServerClock,
} from '../composables/useHousekeepingMessages';
import { createDemoHousekeepingApi, demoDepartments, demoHotelId } from '../demo-api';
import { createLiveHousekeepingApi } from '../live-api';
import { taskTypes } from '../types';
import type {
  CleaningTask,
  HousekeepingSummary,
  Room,
  RoomAction,
  RoomInput,
  RoomStatus,
} from '../types';
import { elapsedSeconds, formatDuration, hotelToday } from '../validation';
import '../styles.css';

const props = withDefaults(defineProps<{ access?: ModuleAssignment[] }>(), { access: () => [] });
const emit = defineEmits<{ back: [] }>();
const messages = useHousekeepingMessages();
const api = runtime.demo ? createDemoHousekeepingApi() : createLiveHousekeepingApi();

// Demo mode grants every capability on a sample department; production uses server grants.
const scope = computed<ModuleAssignment[]>(() =>
  runtime.demo
    ? demoDepartments.map((d) => ({
        moduleId: 'housekeeping',
        hotelId: demoHotelId,
        hotelName: '',
        departmentId: d.id,
        departmentCode: d.id,
        departmentName: d.name,
        canRead: true,
        canWrite: true,
        canManage: true,
      }))
    : props.access.filter((row) => row.moduleId === 'housekeeping' && row.canRead),
);
const hotelId = computed(() => scope.value[0]?.hotelId ?? '');
const hotelScope = computed(() => scope.value.filter((row) => row.hotelId === hotelId.value));
const can = (departmentId: string, flag: 'canWrite' | 'canManage') =>
  hotelScope.value.some((row) => row.departmentId === departmentId && row[flag]);
const managedDepartments = computed(() => hotelScope.value.filter((row) => row.canManage));
const canManageAny = computed(() => managedDepartments.value.length > 0);

type Tab = 'board' | 'history';
type Filter = RoomStatus | 'in-progress' | null;
const tab = ref<Tab>('board');
const search = ref('');
const floor = ref<string | null>(null);
const departmentId = ref<string | null>(null);
const filter = ref<Filter>(null);
const showArchived = ref(false);

const rooms = ref<Room[]>([]);
const summary = ref<HousekeepingSummary | null>(null);
const loading = ref(true);
const failure = ref('');
const notice = ref('');
const offset = ref(0);
const now = useServerClock(() => offset.value);
const selected = ref<Room | null>(null);
const dialogOpen = ref(false);
let controller: AbortController | null = null;
let poll: number | undefined;

async function load(quiet = false) {
  if (!hotelId.value) return;
  controller?.abort();
  controller = new AbortController();
  const signal = controller.signal;
  if (!quiet) loading.value = true;
  try {
    const [list, figures] = await Promise.all([
      api.listRooms(hotelId.value, departmentId.value, showArchived.value, signal),
      api.summary(hotelId.value, departmentId.value, null, signal),
    ]);
    rooms.value = list;
    summary.value = figures;
    offset.value = Date.parse(figures.serverNow) - Date.now();
    failure.value = '';
    if (selected.value) selected.value = list.find((r) => r.id === selected.value!.id) ?? null;
  } catch (error) {
    if (!signal.aborted && !quiet) failure.value = errorMessage(messages.value, error);
  } finally {
    if (!signal.aborted) loading.value = false;
  }
}
watch([departmentId, showArchived], () => void load());
watch(hotelId, () => void load(), { immediate: true });
// The board refreshes every 30 seconds while visible so supervisors see live progress.
onMounted(() => {
  poll = window.setInterval(() => {
    if (document.visibilityState === 'visible' && !busyDialog.value) void load(true);
  }, 30000);
});
onBeforeUnmount(() => {
  controller?.abort();
  historyController?.abort();
  window.clearInterval(poll);
});

const floors = computed(() =>
  [...new Set(rooms.value.map((r) => r.floor))].sort((a, b) =>
    a.localeCompare(b, undefined, { numeric: true }),
  ),
);
const visibleRooms = computed(() => {
  const text = search.value?.trim().toUpperCase() ?? '';
  return rooms.value.filter(
    (r) =>
      (!text || r.number.includes(text)) &&
      (floor.value === null || r.floor === floor.value) &&
      (filter.value === null ||
        (filter.value === 'in-progress' ? !!r.openTask : r.status === filter.value)),
  );
});
const groups = computed(() => {
  const map = new Map<string, Room[]>();
  for (const room of visibleRooms.value)
    map.set(room.floor, [...(map.get(room.floor) ?? []), room]);
  return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0], undefined, { numeric: true }));
});
const myTask = computed(() => rooms.value.find((r) => r.openTask?.mine) ?? null);
const hasFilters = computed(
  () => !!search.value || floor.value !== null || filter.value !== null || !!departmentId.value,
);
function resetFilters() {
  search.value = '';
  floor.value = null;
  filter.value = null;
  departmentId.value = null;
}
const tiles = computed(() => {
  const s = summary.value?.statuses;
  if (!s) return [];
  return (
    [
      ['vacant-ready', 'statusVacantReady'],
      ['vacant-clean', 'statusVacantClean'],
      ['vacant-dirty', 'statusVacantDirty'],
      ['in-progress', 'statusInProgress'],
      ['occupied', 'statusOccupied'],
      ['out-of-order', 'statusOutOfOrder'],
    ] as const
  ).map(([key, label]) => ({ key, label: messages.value[label], count: s[key] }));
});

// Room dialog and actions
const refreshKey = ref(0);
const busyDialog = computed(() => dialogOpen.value || formOpen.value || importOpen.value);
function openRoom(room: Room) {
  selected.value = room;
  dialogOpen.value = true;
}
const loadRoomTasks = (roomId: string, signal: AbortSignal) =>
  api.listTasks(
    { hotelId: hotelId.value, departmentId: null, day: null, roomId, after: null, limit: 10 },
    signal,
  );
async function run(action: RoomAction) {
  const room = selected.value;
  if (!room) return;
  try {
    switch (action.kind) {
      case 'start':
        await api.startTask(hotelId.value, room, action.type);
        notice.value = messages.value.taskStarted;
        break;
      case 'decline':
        await api.startTask(hotelId.value, room, 'make-up', action.outcome);
        notice.value = messages.value.declinedDone;
        break;
      case 'task':
        await api.updateTask(
          hotelId.value,
          action.task,
          action.action,
          action.outcome,
          action.notes,
        );
        notice.value =
          action.action === 'pause'
            ? messages.value.taskPausedDone
            : action.action === 'resume'
              ? messages.value.taskResumed
              : action.action === 'cancel'
                ? messages.value.taskCancelledDone
                : action.outcome === 'done'
                  ? messages.value.taskFinished
                  : messages.value.declinedDone;
        break;
      case 'status':
        await api.setStatus(hotelId.value, room, action.status, action.note);
        notice.value = messages.value.statusDone;
        break;
      case 'inspect':
        await api.inspect(hotelId.value, room, action.result, action.reason);
        notice.value = messages.value.inspected;
        break;
      case 'archive':
        await api.setRoomArchived(hotelId.value, room, action.archived);
        notice.value = action.archived ? messages.value.archivedDone : messages.value.restoredDone;
        break;
    }
  } catch (error) {
    // Someone else changed the room: show the current board before reporting the error.
    if (error instanceof ModuleRequestError && error.code !== 'ACCESS_DENIED') await load(true);
    throw error;
  }
  await load(true);
  refreshKey.value++;
  if (action.kind === 'archive' && action.archived && !showArchived.value) dialogOpen.value = false;
}
async function myTaskAction(action: 'pause' | 'resume' | 'finish') {
  const room = myTask.value;
  if (!room?.openTask) return;
  try {
    await api.updateTask(hotelId.value, room.openTask, action, 'done');
    notice.value =
      action === 'pause'
        ? messages.value.taskPausedDone
        : action === 'resume'
          ? messages.value.taskResumed
          : messages.value.taskFinished;
  } catch (error) {
    notice.value = errorMessage(messages.value, error);
  }
  await load(true);
}

// Room master
const formOpen = ref(false);
const importOpen = ref(false);
const editing = ref<Room | null>(null);
function openForm(room: Room | null = null) {
  editing.value = room;
  formOpen.value = true;
}
const masterDepartment = () =>
  editing.value?.departmentId ?? managedDepartments.value[0].departmentId;
async function saveRoom(input: RoomInput) {
  await api.saveRoom(hotelId.value, masterDepartment(), input, editing.value ?? undefined);
  notice.value = messages.value.saved;
  await load(true);
}
const importRows = (rows: RoomInput[]) =>
  api.importRooms(hotelId.value, managedDepartments.value[0].departmentId, rows);
async function imported(text: string) {
  notice.value = text;
  await load(true);
}

// History
const day = ref(hotelToday());
const history = ref<CleaningTask[]>([]);
const historySummary = ref<HousekeepingSummary | null>(null);
const historyCursor = ref<string | null>(null);
const historyLoading = ref(false);
const historyFailure = ref('');
let historyController: AbortController | null = null;
async function loadHistory(after: string | null = null) {
  if (!hotelId.value || !day.value) return;
  historyController?.abort();
  historyController = new AbortController();
  const signal = historyController.signal;
  historyLoading.value = true;
  historyFailure.value = '';
  try {
    const [page, figures] = await Promise.all([
      api.listTasks(
        {
          hotelId: hotelId.value,
          departmentId: departmentId.value,
          day: day.value,
          roomId: null,
          after,
        },
        signal,
      ),
      after
        ? Promise.resolve(historySummary.value)
        : api.summary(hotelId.value, departmentId.value, day.value, signal),
    ]);
    history.value = after ? [...history.value, ...page.data] : page.data;
    historyCursor.value = page.nextCursor;
    historySummary.value = figures;
  } catch (error) {
    if (!signal.aborted) historyFailure.value = errorMessage(messages.value, error);
  } finally {
    if (!signal.aborted) historyLoading.value = false;
  }
}
watch([tab, day, departmentId], () => {
  if (tab.value === 'history') void loadHistory();
});
const typeRows = computed(() =>
  taskTypes
    .map((type) => ({ type, totals: historySummary.value?.taskTypes[type] }))
    .filter((row) => row.totals && (row.totals.done || row.totals.declined)),
);

const searchField = ref<FocusableField | null>(null);
const shortcutsOpen = ref(false);
useShortcuts(() => [
  { key: '/', run: () => focusFieldInput(searchField.value) },
  { key: '?', shift: true, run: () => (shortcutsOpen.value = true) },
]);
const shortcutRows = computed(() => [
  { keys: '/', label: messages.value.search },
  { keys: '?', label: t('shortcutList') },
  { keys: 'Esc', label: t('shortcutClose') },
]);
const floorItems = computed(() => [
  { value: null, title: messages.value.allFloors },
  ...floors.value.map((value) => ({ value, title: value || '—' })),
]);
const departmentItems = computed(() => [
  { value: null, title: messages.value.allDepartments },
  ...hotelScope.value.map((row) => ({ value: row.departmentId, title: row.departmentName })),
]);
</script>
<template>
  <div class="hk-module">
    <button
      class="hk-breadcrumb"
      @click="emit('back')"
    >
      <v-icon
        icon="mdi-arrow-left"
        size="16"
      />{{ messages.back }}
    </button>
    <ModulePage
      :title="messages.title"
      :description="rooms.length + ' ' + messages.rooms"
      :loading="loading"
      :error="failure"
      :empty="tab === 'board' && !visibleRooms.length"
      :empty-title="hasFilters ? messages.noResults : messages.emptyTitle"
      :empty-description="
        hasFilters
          ? messages.noResultsHint
          : canManageAny
            ? messages.emptyDescription
            : messages.emptyReadOnly
      "
      :retry-label="messages.retry"
      @retry="load()"
    >
      <template #actions>
        <v-menu v-if="canManageAny"
          ><template #activator="{ props: menu }"
            ><v-btn
              v-bind="menu"
              variant="tonal"
              color="primary"
              prepend-icon="mdi-door"
              append-icon="mdi-chevron-down"
              >{{ messages.manageRooms }}</v-btn
            ></template
          ><v-list density="compact"
            ><v-list-item
              prepend-icon="mdi-plus"
              :title="messages.addRoom"
              @click="openForm()" /><v-list-item
              prepend-icon="mdi-table-arrow-down"
              :title="messages.importRooms"
              @click="importOpen = true" /><v-list-item
              :prepend-icon="showArchived ? 'mdi-eye-off-outline' : 'mdi-archive-eye-outline'"
              :title="showArchived ? messages.hideArchived : messages.showArchived"
              @click="showArchived = !showArchived" /></v-list
        ></v-menu>
      </template>
      <template #toolbar>
        <v-alert
          v-if="runtime.demo"
          type="info"
          variant="tonal"
          density="compact"
          icon="mdi-broom"
          class="hk-notice"
          >{{ messages.demoNotice }}</v-alert
        >
        <div
          v-if="myTask?.openTask"
          class="hk-my-task"
          role="status"
        >
          <div>
            <small>{{ messages.myTask }}</small>
            <strong
              >{{ messages.room }} {{ myTask.number }} ·
              {{ messages[taskKeys[myTask.openTask.type]] }}</strong
            >
            <span class="hk-my-timer"
              >{{ formatDuration(elapsedSeconds(myTask.openTask, now)) }}
              <small v-if="myTask.openTask.status === 'paused'">{{
                messages.taskPaused
              }}</small></span
            >
          </div>
          <div class="hk-button-row">
            <v-btn
              color="primary"
              prepend-icon="mdi-check"
              @click="myTaskAction('finish')"
              >{{ messages.finish }}</v-btn
            ><v-btn
              v-if="myTask.openTask.status === 'active'"
              variant="tonal"
              color="primary"
              prepend-icon="mdi-pause"
              @click="myTaskAction('pause')"
              >{{ messages.pause }}</v-btn
            ><v-btn
              v-else
              variant="tonal"
              color="primary"
              prepend-icon="mdi-play"
              @click="myTaskAction('resume')"
              >{{ messages.resume }}</v-btn
            ><v-btn
              variant="text"
              color="primary"
              @click="openRoom(myTask)"
              >{{ messages.moreActions }}</v-btn
            >
          </div>
        </div>
        <div
          v-if="tiles.length"
          class="hk-tiles"
          role="group"
          :aria-label="messages.roomActions"
        >
          <button
            v-for="tile in tiles"
            :key="tile.key"
            type="button"
            class="hk-tile"
            :class="'hk-tile--' + tile.key"
            :aria-pressed="filter === tile.key"
            @click="
              filter = filter === tile.key ? null : tile.key;
              tab = 'board';
            "
          >
            <strong>{{ tile.count }}</strong>
            <span>{{ tile.label }}</span>
          </button>
        </div>
        <v-tabs
          v-model="tab"
          color="primary"
          density="compact"
          class="hk-tabs"
        >
          <v-tab
            value="board"
            prepend-icon="mdi-view-grid-outline"
            >{{ messages.tabBoard }}</v-tab
          >
          <v-tab
            value="history"
            prepend-icon="mdi-history"
            >{{ messages.tabHistory }}</v-tab
          >
        </v-tabs>
        <div
          v-if="tab === 'board'"
          class="hk-toolbar"
        >
          <v-text-field
            ref="searchField"
            v-model="search"
            class="hk-search"
            :placeholder="messages.search"
            :aria-label="messages.search"
            prepend-inner-icon="mdi-magnify"
            single-line
            clearable
            maxlength="10"
          />
          <v-select
            v-model="floor"
            :items="floorItems"
            :label="messages.floor"
          />
          <v-select
            v-if="hotelScope.length > 1"
            v-model="departmentId"
            :items="departmentItems"
            :label="messages.department"
          />
        </div>
        <div
          v-else
          class="hk-toolbar"
        >
          <v-text-field
            v-model="day"
            type="date"
            :label="messages.day"
            :max="hotelToday()"
            min="2000-01-01"
          />
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
          v-else-if="canManageAny"
          variant="tonal"
          color="primary"
          prepend-icon="mdi-table-arrow-down"
          @click="importOpen = true"
          >{{ messages.importRooms }}</v-btn
        >
      </template>

      <div v-if="tab === 'board'">
        <section
          v-for="[floorName, list] in groups"
          :key="floorName"
          class="hk-floor"
          :aria-label="messages.floor + ' ' + (floorName || '—')"
        >
          <h2 v-if="floors.length > 1 || floorName">{{ messages.floor }} {{ floorName || '—' }}</h2>
          <div class="hk-grid">
            <button
              v-for="room in list"
              :key="room.id"
              type="button"
              class="hk-card"
              :class="[
                'hk-card--' + room.status,
                { 'hk-card--busy': !!room.openTask, 'hk-card--archived': room.archived },
              ]"
              :aria-label="
                messages.room +
                ' ' +
                room.number +
                ', ' +
                messages[statusKeys[room.status]] +
                (room.openTask ? ', ' + messages[taskKeys[room.openTask.type]] : '')
              "
              @click="openRoom(room)"
            >
              <span class="hk-card-head">
                <strong>{{ room.number }}</strong>
                <span
                  class="hk-status"
                  :class="'hk-status--' + room.status"
                  >{{ messages[statusCodeKeys[room.status]] }}</span
                >
              </span>
              <small class="hk-card-type">{{
                room.roomType || messages[statusKeys[room.status]]
              }}</small>
              <span
                v-if="room.openTask"
                class="hk-card-task"
                ><v-icon
                  :icon="
                    room.openTask.status === 'paused'
                      ? 'mdi-pause-circle-outline'
                      : taskIcons[room.openTask.type]
                  "
                  size="14"
                />{{ formatDuration(elapsedSeconds(room.openTask, now)) }} ·
                {{ shortName(room.openTask.attendantEmail) }}</span
              >
              <small
                v-else-if="room.statusNote"
                class="hk-card-note"
                >{{ room.statusNote }}</small
              >
              <small
                v-else
                class="hk-card-type"
                >{{ messages[statusKeys[room.status]] }}</small
              >
            </button>
          </div>
        </section>
      </div>

      <div v-else>
        <v-alert
          v-if="historyFailure"
          type="error"
          variant="tonal"
          role="alert"
          >{{ historyFailure
          }}<v-btn
            variant="text"
            @click="loadHistory()"
            >{{ messages.retry }}</v-btn
          ></v-alert
        >
        <v-skeleton-loader
          v-else-if="historyLoading && !history.length"
          type="table"
        />
        <template v-else>
          <div
            v-if="historySummary"
            class="hk-history-summary"
          >
            <section class="hk-panel">
              <h2>{{ messages.byType }}</h2>
              <p
                v-if="!typeRows.length"
                class="hk-muted"
              >
                {{ messages.noHistory }}
              </p>
              <table
                v-else
                class="hk-table"
              >
                <thead>
                  <tr>
                    <th scope="col">{{ messages.taskColumn }}</th>
                    <th
                      scope="col"
                      class="hk-number"
                    >
                      {{ messages.cleaned }}
                    </th>
                    <th
                      scope="col"
                      class="hk-number"
                    >
                      {{ messages.avgTime }}
                    </th>
                    <th
                      scope="col"
                      class="hk-number"
                    >
                      {{ messages.declined }}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  <tr
                    v-for="row in typeRows"
                    :key="row.type"
                  >
                    <td>{{ messages[taskKeys[row.type]] }}</td>
                    <td class="hk-number">{{ row.totals!.done }}</td>
                    <td class="hk-number">
                      {{ row.totals!.done ? formatDuration(row.totals!.avgSeconds) : '—' }}
                    </td>
                    <td class="hk-number">{{ row.totals!.declined }}</td>
                  </tr>
                </tbody>
              </table>
              <p class="hk-muted mt-2">
                {{ messages.inspectionsLabel }}: {{ historySummary.inspections.pass }}
                {{ messages.passed }} · {{ historySummary.inspections.redo }} {{ messages.redone }}
              </p>
            </section>
            <section class="hk-panel">
              <h2>{{ messages.attendants }}</h2>
              <p
                v-if="!historySummary.attendants.length"
                class="hk-muted"
              >
                {{ messages.noHistory }}
              </p>
              <table
                v-else
                class="hk-table"
              >
                <thead>
                  <tr>
                    <th scope="col">{{ messages.attendant }}</th>
                    <th
                      scope="col"
                      class="hk-number"
                    >
                      {{ messages.cleaned }}
                    </th>
                    <th
                      scope="col"
                      class="hk-number"
                    >
                      {{ messages.avgTime }}
                    </th>
                    <th
                      scope="col"
                      class="hk-number"
                    >
                      {{ messages.totalTime }}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  <tr
                    v-for="person in historySummary.attendants"
                    :key="person.email"
                  >
                    <td :title="person.email">{{ shortName(person.email) }}</td>
                    <td class="hk-number">{{ person.done }}</td>
                    <td class="hk-number">{{ formatDuration(person.avgSeconds) }}</td>
                    <td class="hk-number">{{ formatDuration(person.totalSeconds) }}</td>
                  </tr>
                </tbody>
              </table>
            </section>
          </div>
          <p
            v-if="!history.length"
            class="hk-muted"
          >
            {{ messages.noHistory }}
          </p>
          <ul
            v-else
            class="hk-history"
          >
            <li
              v-for="entry in history"
              :key="entry.id"
            >
              <strong class="hk-history-room">{{ entry.roomNumber }}</strong>
              <div>
                <span
                  ><v-icon
                    :icon="taskIcons[entry.type]"
                    size="15"
                  />{{ messages[taskKeys[entry.type]] }}</span
                >
                <small
                  >{{ formatTime(entry.startedAt)
                  }}<template v-if="entry.finishedAt">
                    – {{ formatTime(entry.finishedAt) }}</template
                  >
                  · {{ shortName(entry.attendantEmail) }}</small
                >
                <small v-if="entry.notes">{{ entry.notes }}</small>
              </div>
              <span
                class="hk-history-result"
                :class="'hk-history-result--' + entry.status"
                >{{
                  entry.status === 'done' && entry.durationSeconds !== null
                    ? formatDuration(entry.durationSeconds)
                    : entry.status === 'active' || entry.status === 'paused'
                      ? formatDuration(elapsedSeconds(entry, now))
                      : messages[taskStatusKeys[entry.status]]
                }}</span
              >
            </li>
          </ul>
          <v-btn
            v-if="historyCursor"
            variant="text"
            color="primary"
            class="mt-3"
            :loading="historyLoading"
            @click="loadHistory(historyCursor)"
            >{{ messages.loadMore }}</v-btn
          >
        </template>
      </div>
    </ModulePage>

    <RoomDialog
      v-model="dialogOpen"
      :room="selected"
      :can-write="!!selected && can(selected.departmentId, 'canWrite')"
      :can-manage="!!selected && can(selected.departmentId, 'canManage')"
      :now="now"
      :refresh-key="refreshKey"
      :load-tasks="loadRoomTasks"
      :run="run"
      @edit="openForm(selected)"
    />
    <RoomForm
      v-model="formOpen"
      :room="editing"
      :save="saveRoom"
    />
    <ImportRooms
      v-model="importOpen"
      :save="importRows"
      @done="imported"
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
