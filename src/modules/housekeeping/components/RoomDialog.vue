<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import ModuleDialog from '../../../shared/module-dialog.vue';
import {
  errorMessage,
  formatDateTime,
  formatTime,
  shortName,
  statusCodeKeys,
  statusKeys,
  taskIcons,
  taskKeys,
  taskStatusKeys,
  useHousekeepingMessages,
} from '../composables/useHousekeepingMessages';
import { roomStatuses } from '../types';
import type { CleaningTask, Page, Room, RoomAction, RoomStatus } from '../types';
import { allowedTasks, elapsedSeconds, formatDuration } from '../validation';

const open = defineModel<boolean>({ required: true });
const props = defineProps<{
  room: Room | null;
  canWrite: boolean;
  canManage: boolean;
  now: number;
  /** Changes whenever the page saved something, so recent tasks reload. */
  refreshKey: number;
  loadTasks: (roomId: string, signal: AbortSignal) => Promise<Page<CleaningTask>>;
  /** Runs one action; the page refreshes the board and reports the outcome. */
  run: (action: RoomAction) => Promise<void>;
}>();
const emit = defineEmits<{ edit: [] }>();
const messages = useHousekeepingMessages();
const busy = ref(false);
const failure = ref('');
const notes = ref('');
// Out of order, redo and overrides need a reason; the field opens only for them.
const reasonFor = ref<'out-of-order' | 'redo' | null>(null);
const reason = ref('');
const reasonError = ref('');
const override = ref<RoomStatus | null>(null);
const recent = ref<CleaningTask[]>([]);
let controller: AbortController | null = null;

async function loadRecent() {
  if (!props.room) return;
  controller?.abort();
  controller = new AbortController();
  try {
    recent.value = (await props.loadTasks(props.room.id, controller.signal)).data;
  } catch {
    if (!controller.signal.aborted) recent.value = [];
  }
}
watch(open, (value) => {
  if (value) {
    failure.value = '';
    notes.value = '';
    reasonFor.value = null;
    override.value = null;
    recent.value = [];
    void loadRecent();
  } else controller?.abort();
});
watch(
  () => props.refreshKey,
  () => {
    if (open.value) void loadRecent();
  },
);

const task = computed(() => props.room?.openTask ?? null);
const canActOnTask = computed(
  () => !!task.value && ((task.value.mine && props.canWrite) || props.canManage),
);
const startable = computed(() =>
  props.room && !task.value && !props.room.archived ? allowedTasks(props.room.status) : [],
);
async function act(action: RoomAction) {
  if (busy.value) return;
  busy.value = true;
  failure.value = '';
  try {
    await props.run(action);
    notes.value = '';
    reasonFor.value = null;
    reason.value = '';
    override.value = null;
  } catch (error) {
    failure.value = errorMessage(messages.value, error);
  } finally {
    busy.value = false;
  }
}
function askReason(kind: 'out-of-order' | 'redo') {
  reasonFor.value = kind;
  reason.value = '';
  reasonError.value = '';
}
function confirmReason() {
  if (!reason.value.trim()) {
    reasonError.value = messages.value.noteRequired;
    document.getElementById('hk-reason')?.focus();
    return;
  }
  if (reasonFor.value === 'redo')
    void act({ kind: 'inspect', result: 'redo', reason: reason.value });
  else void act({ kind: 'status', status: 'out-of-order', note: reason.value });
}
const overrideItems = computed(() =>
  roomStatuses
    .filter((s) => s !== props.room?.status)
    .map((value) => ({ value, title: messages.value[statusKeys[value]] })),
);
</script>
<template>
  <ModuleDialog
    v-model="open"
    :title="room ? messages.room + ' ' + room.number : ''"
    :subtitle="
      room
        ? [room.roomType, room.floor && messages.floor + ' ' + room.floor]
            .filter(Boolean)
            .join(' · ')
        : ''
    "
    :busy="busy"
    :width="600"
  >
    <template v-if="room">
      <div class="hk-dialog-status">
        <span
          class="hk-status"
          :class="'hk-status--' + room.status"
          >{{ messages[statusCodeKeys[room.status]] }}</span
        >
        <div>
          <strong>{{ messages[statusKeys[room.status]] }}</strong>
          <small v-if="room.statusNote">{{ room.statusNote }}</small>
          <small v-if="room.lastCleanedAt"
            >{{ messages.lastCleaned }} {{ formatDateTime(room.lastCleanedAt) }}</small
          >
        </div>
      </div>
      <v-alert
        v-if="failure"
        type="error"
        variant="tonal"
        role="alert"
        class="mb-3"
        >{{ failure }}</v-alert
      >

      <section
        v-if="task"
        class="hk-dialog-section hk-open-task"
        aria-labelledby="hk-open-task-heading"
      >
        <h3 id="hk-open-task-heading">
          <v-icon
            :icon="taskIcons[task.type]"
            size="18"
          />{{ messages[taskKeys[task.type]] }}
        </h3>
        <p class="hk-timer">
          <span :aria-label="messages.duration">{{
            formatDuration(elapsedSeconds(task, now))
          }}</span>
          <small
            >{{ messages[taskStatusKeys[task.status]] }} · {{ messages.started }}
            {{ formatTime(task.startedAt) }} · {{ messages.by }}
            {{ shortName(task.attendantEmail) }}</small
          >
        </p>
        <template v-if="canActOnTask">
          <label
            for="hk-task-notes"
            class="field-label"
            >{{ messages.notes }}</label
          ><v-text-field
            id="hk-task-notes"
            v-model="notes"
            :disabled="busy"
            maxlength="500"
            :placeholder="messages.notesPlaceholder"
          />
          <div class="hk-button-row">
            <v-btn
              color="primary"
              prepend-icon="mdi-check"
              :loading="busy"
              @click="act({ kind: 'task', task, action: 'finish', outcome: 'done', notes })"
              >{{ messages.finish }}</v-btn
            ><v-btn
              v-if="task.status === 'active'"
              variant="tonal"
              color="primary"
              prepend-icon="mdi-pause"
              :disabled="busy"
              @click="act({ kind: 'task', task, action: 'pause' })"
              >{{ messages.pause }}</v-btn
            ><v-btn
              v-else
              variant="tonal"
              color="primary"
              prepend-icon="mdi-play"
              :disabled="busy"
              @click="act({ kind: 'task', task, action: 'resume' })"
              >{{ messages.resume }}</v-btn
            >
            <template v-if="task.type === 'make-up' || task.type === 'turndown'">
              <v-btn
                variant="outlined"
                :disabled="busy"
                @click="act({ kind: 'task', task, action: 'finish', outcome: 'dnd', notes })"
                >{{ messages.markDnd }}</v-btn
              ><v-btn
                variant="outlined"
                :disabled="busy"
                @click="act({ kind: 'task', task, action: 'finish', outcome: 'refused', notes })"
                >{{ messages.markRefused }}</v-btn
              >
            </template>
            <v-btn
              variant="text"
              :disabled="busy"
              @click="act({ kind: 'task', task, action: 'cancel' })"
              >{{ messages.cancelTask }}</v-btn
            >
          </div>
        </template>
      </section>

      <section
        v-else-if="canWrite && startable.length"
        class="hk-dialog-section"
        aria-labelledby="hk-start-heading"
      >
        <h3 id="hk-start-heading">{{ messages.startTask }}</h3>
        <div class="hk-start-grid">
          <v-btn
            v-for="type in startable"
            :key="type"
            color="primary"
            :variant="type === startable[0] ? 'flat' : 'tonal'"
            :prepend-icon="taskIcons[type]"
            :loading="busy"
            @click="act({ kind: 'start', type })"
            >{{ messages[taskKeys[type]] }}</v-btn
          >
        </div>
        <template v-if="room.status === 'occupied'">
          <h3 class="hk-subheading">{{ messages.declineService }}</h3>
          <div class="hk-button-row">
            <v-btn
              variant="outlined"
              prepend-icon="mdi-door-closed-lock"
              :disabled="busy"
              @click="act({ kind: 'decline', outcome: 'dnd' })"
              >{{ messages.markDnd }}</v-btn
            ><v-btn
              variant="outlined"
              prepend-icon="mdi-hand-back-left-outline"
              :disabled="busy"
              @click="act({ kind: 'decline', outcome: 'refused' })"
              >{{ messages.markRefused }}</v-btn
            >
          </div>
        </template>
      </section>

      <section
        v-if="canManage && room.status === 'vacant-clean' && !task"
        class="hk-dialog-section"
        aria-labelledby="hk-inspect-heading"
      >
        <h3 id="hk-inspect-heading">{{ messages.inspection }}</h3>
        <p class="hk-muted">{{ messages.inspectionHint }}</p>
        <div class="hk-button-row">
          <v-btn
            color="primary"
            prepend-icon="mdi-check-decagram-outline"
            :loading="busy"
            @click="act({ kind: 'inspect', result: 'pass', reason: '' })"
            >{{ messages.inspectPass }}</v-btn
          ><v-btn
            variant="tonal"
            color="primary"
            prepend-icon="mdi-restart"
            :disabled="busy"
            @click="askReason('redo')"
            >{{ messages.inspectRedo }}</v-btn
          >
        </div>
      </section>

      <section
        v-if="canWrite && !task && !room.archived"
        class="hk-dialog-section"
        aria-labelledby="hk-status-heading"
      >
        <h3 id="hk-status-heading">{{ messages.roomActions }}</h3>
        <div class="hk-button-row">
          <v-btn
            v-if="room.status === 'occupied'"
            variant="tonal"
            color="primary"
            prepend-icon="mdi-logout"
            :disabled="busy"
            @click="act({ kind: 'status', status: 'vacant-dirty', note: '' })"
            >{{ messages.checkOut }}</v-btn
          ><v-btn
            v-if="room.status === 'vacant-ready' || room.status === 'vacant-clean'"
            variant="tonal"
            color="primary"
            prepend-icon="mdi-login"
            :disabled="busy"
            @click="act({ kind: 'status', status: 'occupied', note: '' })"
            >{{ messages.checkIn }}</v-btn
          ><v-btn
            v-if="room.status === 'out-of-order'"
            variant="tonal"
            color="primary"
            prepend-icon="mdi-wrench-check-outline"
            :disabled="busy"
            @click="act({ kind: 'status', status: 'vacant-dirty', note: '' })"
            >{{ messages.backInService }}</v-btn
          ><v-btn
            v-else
            variant="outlined"
            prepend-icon="mdi-alert-octagon-outline"
            :disabled="busy"
            @click="askReason('out-of-order')"
            >{{ messages.outOfOrder }}</v-btn
          >
        </div>
        <div
          v-if="canManage"
          class="hk-override"
        >
          <v-select
            v-model="override"
            :items="overrideItems"
            :label="messages.override"
            :hint="messages.overrideHint"
            persistent-hint
            :disabled="busy"
          /><v-btn
            variant="tonal"
            color="primary"
            :disabled="!override || override === 'out-of-order' || busy"
            @click="override && act({ kind: 'status', status: override, note: '' })"
            >{{ messages.override }}</v-btn
          >
        </div>
      </section>

      <section
        v-if="reasonFor"
        class="hk-dialog-section"
      >
        <label
          for="hk-reason"
          class="field-label hk-first-label"
          >{{ messages.reason }}</label
        ><v-text-field
          id="hk-reason"
          v-model="reason"
          :disabled="busy"
          :maxlength="reasonFor === 'redo' ? 300 : 200"
          autofocus
          :placeholder="reasonFor === 'redo' ? messages.redoPlaceholder : messages.oooPlaceholder"
          :error-messages="reasonError"
          @keydown.enter.prevent="confirmReason"
        />
        <div class="hk-button-row">
          <v-btn
            color="primary"
            :loading="busy"
            @click="confirmReason"
            >{{ reasonFor === 'redo' ? messages.inspectRedo : messages.outOfOrder }}</v-btn
          ><v-btn
            variant="text"
            :disabled="busy"
            @click="reasonFor = null"
            >{{ messages.cancel }}</v-btn
          >
        </div>
      </section>

      <section
        class="hk-dialog-section"
        aria-labelledby="hk-recent-heading"
      >
        <h3 id="hk-recent-heading">{{ messages.recentTasks }}</h3>
        <p
          v-if="!recent.length"
          class="hk-muted"
        >
          {{ messages.noTasks }}
        </p>
        <ol
          v-else
          class="hk-recent"
        >
          <li
            v-for="entry in recent"
            :key="entry.id"
          >
            <v-icon
              :icon="taskIcons[entry.type]"
              size="16"
            />
            <div>
              <strong>{{ messages[taskKeys[entry.type]] }}</strong>
              <small
                >{{ formatDateTime(entry.startedAt) }} ·
                {{ messages[taskStatusKeys[entry.status]] }}
                <template v-if="entry.durationSeconds !== null && entry.status === 'done'">
                  · {{ formatDuration(entry.durationSeconds) }}</template
                >
                · {{ shortName(entry.attendantEmail) }}</small
              >
              <small v-if="entry.notes">{{ entry.notes }}</small>
            </div>
          </li>
        </ol>
      </section>
    </template>
    <template
      v-if="room && canManage"
      #actions
    >
      <v-btn
        variant="text"
        :prepend-icon="room.archived ? 'mdi-archive-arrow-up-outline' : 'mdi-archive-outline'"
        :disabled="busy || !!task"
        @click="act({ kind: 'archive', archived: !room.archived })"
        >{{ room.archived ? messages.restoreRoom : messages.archiveRoom }}</v-btn
      ><v-btn
        variant="tonal"
        color="primary"
        prepend-icon="mdi-pencil-outline"
        :disabled="busy"
        @click="emit('edit')"
        >{{ messages.editRoom }}</v-btn
      >
    </template>
  </ModuleDialog>
</template>
