<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import ModulePage from '../../../shared/ModulePage.vue';
import KeyboardShortcuts from '../../../shared/keyboard-shortcuts.vue';
import { runtime } from '../../../config/runtime';
import { t } from '../../../i18n';
import type { ModuleAssignment } from '../../../core/module-access';
import { useShortcuts } from '../../../core/use-shortcuts';
import { focusFieldInput } from '../../../core/focus-field';
import type { FocusableField } from '../../../core/focus-field';
import ImportRooms from '../components/ImportRooms.vue';
import RoomForm from '../components/RoomForm.vue';
import RoomTimer from '../components/RoomTimer.vue';
import {
  errorMessage,
  formatTime,
  shortName,
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
  RoomInput,
  TaskAction,
  TaskType,
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

const tab = ref<'rooms' | 'history'>('rooms');
const search = ref('');
const floor = ref<string | null>(null);
const departmentId = ref<string | null>(null);
const showArchived = ref(false);

const rooms = ref<Room[]>([]);
const loading = ref(true);
const failure = ref('');
const notice = ref('');
const offset = ref(0);
const now = useServerClock(() => offset.value);
const selected = ref<Room | null>(null);
const timerOpen = ref(false);
const formOpen = ref(false);
const importOpen = ref(false);
let controller: AbortController | null = null;
let poll: number | undefined;

async function load(quiet = false) {
  if (!hotelId.value) return;
  controller?.abort();
  controller = new AbortController();
  const signal = controller.signal;
  if (!quiet) loading.value = true;
  try {
    const list = await api.listRooms(hotelId.value, departmentId.value, showArchived.value, signal);
    rooms.value = list.rooms;
    offset.value = Date.parse(list.serverNow) - Date.now();
    failure.value = '';
    if (selected.value)
      selected.value = list.rooms.find((r) => r.id === selected.value!.id) ?? null;
  } catch (error) {
    if (!signal.aborted && !quiet) failure.value = errorMessage(messages.value, error);
  } finally {
    if (!signal.aborted) loading.value = false;
  }
}
watch([departmentId, showArchived], () => void load());
watch(hotelId, () => void load(), { immediate: true });
// The list refreshes every 30 seconds while visible so supervisors see who is cleaning.
onMounted(() => {
  poll = window.setInterval(() => {
    if (document.visibilityState === 'visible' && !formOpen.value && !importOpen.value)
      void load(true);
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
const groups = computed(() => {
  const text = search.value?.trim().toUpperCase() ?? '';
  const map = new Map<string, Room[]>();
  for (const room of rooms.value)
    if (
      (!text || room.number.includes(text)) &&
      (floor.value === null || room.floor === floor.value)
    )
      map.set(room.floor, [...(map.get(room.floor) ?? []), room]);
  return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0], undefined, { numeric: true }));
});
const visibleCount = computed(() => groups.value.reduce((sum, [, list]) => sum + list.length, 0));
const myRoom = computed(() => rooms.value.find((r) => r.openTask?.mine) ?? null);
const hasFilters = computed(() => !!search.value || floor.value !== null || !!departmentId.value);
function resetFilters() {
  search.value = '';
  floor.value = null;
  departmentId.value = null;
}

function openRoom(room: Room) {
  selected.value = room;
  timerOpen.value = true;
}
const loadRoomTasks = (roomId: string, signal: AbortSignal) =>
  api.listTasks(
    { hotelId: hotelId.value, departmentId: null, day: null, roomId, after: null, limit: 10 },
    signal,
  );
async function startTimer(room: Room, type: TaskType) {
  try {
    await api.startTask(hotelId.value, room, type);
    notice.value = messages.value.started;
  } finally {
    await load(true);
  }
}
async function updateTimer(task: CleaningTask, action: TaskAction) {
  // The server measures the final time; this only shows the time seen at the moment of finishing.
  const seen = elapsedSeconds(task, now.value);
  try {
    await api.updateTask(hotelId.value, task, action);
    notice.value =
      action === 'finish'
        ? messages.value.finished.replace('{time}', formatDuration(seen))
        : action === 'pause'
          ? messages.value.pausedDone
          : action === 'resume'
            ? messages.value.resumed
            : messages.value.cancelledDone;
  } finally {
    await load(true);
    if (tab.value === 'history') void loadHistory();
  }
}
async function quickAction(action: TaskAction) {
  if (!myRoom.value?.openTask) return;
  try {
    await updateTimer(myRoom.value.openTask, action);
  } catch (error) {
    notice.value = errorMessage(messages.value, error);
  }
}

// Room list (manage)
const editing = ref<Room | null>(null);
function openForm(room: Room | null = null) {
  editing.value = room;
  formOpen.value = true;
}
async function saveRoom(input: RoomInput) {
  const department = editing.value?.departmentId ?? managedDepartments.value[0].departmentId;
  await api.saveRoom(hotelId.value, department, input, editing.value ?? undefined);
  notice.value = messages.value.saved;
  await load(true);
}
const importRows = (rows: RoomInput[]) =>
  api.importRooms(hotelId.value, managedDepartments.value[0].departmentId, rows);
async function imported(text: string) {
  notice.value = text;
  await load(true);
}
async function toggleArchive() {
  const room = selected.value;
  if (!room) return;
  try {
    await api.setRoomArchived(hotelId.value, room, !room.archived);
    notice.value = room.archived ? messages.value.restoredDone : messages.value.archivedDone;
    if (!room.archived && !showArchived.value) timerOpen.value = false;
  } catch (error) {
    notice.value = errorMessage(messages.value, error);
  }
  await load(true);
}

// History
const day = ref(hotelToday());
const history = ref<CleaningTask[]>([]);
const summary = ref<HousekeepingSummary | null>(null);
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
    const query = {
      hotelId: hotelId.value,
      departmentId: departmentId.value,
      day: day.value,
      roomId: null,
      after,
    };
    const [page, figures] = await Promise.all([
      api.listTasks(query, signal),
      after
        ? Promise.resolve(summary.value)
        : api.summary(hotelId.value, departmentId.value, day.value, signal),
    ]);
    history.value = after ? [...history.value, ...page.data] : page.data;
    historyCursor.value = page.nextCursor;
    summary.value = figures;
  } catch (error) {
    if (!signal.aborted) historyFailure.value = errorMessage(messages.value, error);
  } finally {
    if (!signal.aborted) historyLoading.value = false;
  }
}
watch([tab, day, departmentId], () => {
  if (tab.value === 'history') void loadHistory();
});
const typeTiles = computed(() =>
  taskTypes
    .map((type) => ({ type, totals: summary.value?.taskTypes[type] }))
    .filter((row) => row.totals?.done),
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
      :empty="tab === 'rooms' && !visibleCount"
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
          v-if="myRoom?.openTask"
          class="hk-mine"
          role="status"
        >
          <div class="hk-mine-text">
            <small>{{ messages.myTask }}</small>
            <strong
              >{{ messages.room }} {{ myRoom.number }} ·
              {{ messages[taskKeys[myRoom.openTask.type]] }}</strong
            >
          </div>
          <span
            class="hk-mine-time"
            :class="{ 'hk-mine-time--paused': myRoom.openTask.status === 'paused' }"
            >{{ formatDuration(elapsedSeconds(myRoom.openTask, now)) }}</span
          >
          <div class="hk-mine-actions">
            <v-btn
              color="primary"
              prepend-icon="mdi-check"
              @click="quickAction('finish')"
              >{{ messages.finish }}</v-btn
            ><v-btn
              v-if="myRoom.openTask.status === 'active'"
              variant="tonal"
              color="primary"
              prepend-icon="mdi-pause"
              @click="quickAction('pause')"
              >{{ messages.pause }}</v-btn
            ><v-btn
              v-else
              variant="tonal"
              color="primary"
              prepend-icon="mdi-play"
              @click="quickAction('resume')"
              >{{ messages.resume }}</v-btn
            >
          </div>
        </div>
        <v-tabs
          v-model="tab"
          color="primary"
          density="compact"
          class="hk-tabs"
        >
          <v-tab
            value="rooms"
            prepend-icon="mdi-door"
            >{{ messages.tabRooms }}</v-tab
          >
          <v-tab
            value="history"
            prepend-icon="mdi-history"
            >{{ messages.tabHistory }}</v-tab
          >
        </v-tabs>
        <div
          v-if="tab === 'rooms'"
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
            v-if="floors.length > 1"
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

      <div v-if="tab === 'rooms'">
        <section
          v-for="[floorName, list] in groups"
          :key="floorName"
          class="hk-floor"
        >
          <h2 v-if="floors.length > 1">{{ messages.floor }} {{ floorName || '—' }}</h2>
          <div class="hk-grid">
            <button
              v-for="room in list"
              :key="room.id"
              type="button"
              class="hk-card"
              :class="{
                'hk-card--busy': !!room.openTask,
                'hk-card--paused': room.openTask?.status === 'paused',
                'hk-card--archived': room.archived,
              }"
              :aria-label="
                messages.room +
                ' ' +
                room.number +
                (room.openTask
                  ? ', ' +
                    messages[taskKeys[room.openTask.type]] +
                    ' ' +
                    formatDuration(elapsedSeconds(room.openTask, now))
                  : '')
              "
              @click="openRoom(room)"
            >
              <strong class="hk-card-number">{{ room.number }}</strong>
              <template v-if="room.openTask">
                <span class="hk-card-time"
                  ><v-icon
                    :icon="
                      room.openTask.status === 'paused'
                        ? 'mdi-pause-circle-outline'
                        : taskIcons[room.openTask.type]
                    "
                    size="14"
                  />{{ formatDuration(elapsedSeconds(room.openTask, now)) }}</span
                >
                <small>{{ shortName(room.openTask.attendantEmail) }}</small>
              </template>
              <template v-else-if="room.lastDone">
                <span class="hk-card-last"
                  >{{ messages.last }} {{ formatDuration(room.lastDone.durationSeconds) }}</span
                >
                <small>{{ messages[taskKeys[room.lastDone.type]] }}</small>
              </template>
              <small v-else>{{ room.roomType || messages.notCleaned }}</small>
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
            v-if="summary && summary.totals.done"
            class="hk-stats"
          >
            <div class="hk-stat">
              <span>{{ messages.roomsCleaned }}</span>
              <strong>{{ summary.totals.rooms }}</strong>
              <small>{{ messages.average }} {{ formatDuration(summary.totals.avgSeconds) }}</small>
            </div>
            <div
              v-for="tile in typeTiles"
              :key="tile.type"
              class="hk-stat"
            >
              <span>{{ messages[taskKeys[tile.type]] }} · {{ messages.average }}</span>
              <strong>{{ formatDuration(tile.totals!.avgSeconds) }}</strong>
              <small
                >{{ tile.totals!.done }} {{ messages.rooms }} · {{ messages.longest }}
                {{ formatDuration(tile.totals!.maxSeconds) }}</small
              >
            </div>
          </div>
          <section
            v-if="summary && summary.attendants.length"
            class="hk-panel"
          >
            <h2>{{ messages.attendants }}</h2>
            <table class="hk-table">
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
                    {{ messages.average }}
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
                  v-for="person in summary.attendants"
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
              :class="{ 'hk-history--cancelled': entry.status === 'cancelled' }"
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
              </div>
              <span class="hk-history-time">{{
                entry.status === 'cancelled'
                  ? messages[taskStatusKeys[entry.status]]
                  : formatDuration(elapsedSeconds(entry, now))
              }}</span>
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

    <RoomTimer
      v-model="timerOpen"
      :room="selected"
      :can-write="!!selected && can(selected.departmentId, 'canWrite')"
      :can-manage="!!selected && can(selected.departmentId, 'canManage')"
      :now="now"
      :load-tasks="loadRoomTasks"
      :start="startTimer"
      :update="updateTimer"
      @edit="openForm(selected)"
      @archive="toggleArchive"
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
