<script setup lang="ts">
import { dialogWidth } from '../../../shared/dialog-widths';
import { computed, ref, watch } from 'vue';
import ModuleDialog from '../../../shared/module-dialog.vue';
import {
  errorMessage,
  formatDateTime,
  formatTime,
  shortName,
  taskIcons,
  taskKeys,
  taskStatusKeys,
  useRoomTurnaroundMessages,
} from '../composables/useRoomTurnaroundMessages';
import { taskTypes } from '../types';
import type { CleaningTask, Page, Room, TaskAction, TaskType } from '../types';
import { elapsedSeconds, formatDuration } from '../validation';

const open = defineModel<boolean>({ required: true });
const props = defineProps<{
  room: Room | null;
  canWrite: boolean;
  canManage: boolean;
  now: number;
  loadTasks: (roomId: string, signal: AbortSignal) => Promise<Page<CleaningTask>>;
  start: (room: Room, type: TaskType) => Promise<void>;
  update: (task: CleaningTask, action: TaskAction) => Promise<void>;
}>();
const emit = defineEmits<{ edit: []; archive: [] }>();
const messages = useRoomTurnaroundMessages();
const busy = ref(false);
const failure = ref('');
const recent = ref<CleaningTask[]>([]);
let controller: AbortController | null = null;

watch(open, (value) => {
  if (!value) {
    controller?.abort();
    return;
  }
  failure.value = '';
  recent.value = [];
  if (!props.room) return;
  controller = new AbortController();
  const signal = controller.signal;
  props
    .loadTasks(props.room.id, signal)
    .then((page) => (recent.value = page.data.filter((t) => t.status === 'done')))
    .catch(() => {
      if (!signal.aborted) recent.value = [];
    });
});

const task = computed(() => props.room?.openTask ?? null);
const canControl = computed(
  () => !!task.value && ((task.value.mine && props.canWrite) || props.canManage),
);
async function act(run: () => Promise<void>, close: boolean) {
  if (busy.value) return;
  busy.value = true;
  failure.value = '';
  try {
    await run();
    if (close) open.value = false;
  } catch (error) {
    failure.value = errorMessage(messages.value, error);
  } finally {
    busy.value = false;
  }
}
const begin = (type: TaskType) => act(() => props.start(props.room!, type), true);
const control = (action: TaskAction) =>
  act(() => props.update(task.value!, action), action === 'finish' || action === 'cancel');
</script>
<template>
  <ModuleDialog
    v-model="open"
    sheet
    :title="room ? messages.room + ' ' + room.number : ''"
    :subtitle="
      room
        ? [room.roomType, room.floor && messages.floor + ' ' + room.floor]
            .filter(Boolean)
            .join(' · ')
        : ''
    "
    :busy="busy"
    :width="dialogWidth.base"
  >
    <template v-if="room">
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
        class="hk-running"
        aria-live="polite"
      >
        <span class="hk-running-type"
          ><v-icon
            :icon="taskIcons[task.type]"
            size="var(--workstel-icon-md)"
          />{{ messages[taskKeys[task.type]] }} · {{ messages[taskStatusKeys[task.status]] }}</span
        >
        <span class="hk-running-time">{{ formatDuration(elapsedSeconds(task, now)) }}</span>
        <small
          >{{ formatTime(task.startedAt) }} · {{ messages.busyBy }}
          {{ shortName(task.attendantEmail) }}</small
        >
        <div
          v-if="canControl"
          class="hk-running-actions"
        >
          <v-btn
            color="primary"
            size="large"
            prepend-icon="mdi-check"
            :loading="busy"
            @click="control('finish')"
            >{{ messages.finish }}</v-btn
          ><v-btn
            v-if="task.status === 'active'"
            variant="tonal"
            color="primary"
            size="large"
            prepend-icon="mdi-pause"
            :disabled="busy"
            @click="control('pause')"
            >{{ messages.pause }}</v-btn
          ><v-btn
            v-else
            variant="tonal"
            color="primary"
            size="large"
            prepend-icon="mdi-play"
            :disabled="busy"
            @click="control('resume')"
            >{{ messages.resume }}</v-btn
          >
        </div>
        <v-btn
          v-if="canControl"
          variant="text"
          size="small"
          class="hk-cancel"
          :disabled="busy"
          :title="messages.cancelHint"
          @click="control('cancel')"
          >{{ messages.cancelTask }}</v-btn
        >
      </section>

      <section
        v-else-if="canWrite && !room.archived"
        aria-labelledby="hk-choose-heading"
      >
        <h3
          id="hk-choose-heading"
          class="hk-section-title"
        >
          {{ messages.chooseTask }}
        </h3>
        <p class="hk-muted">{{ messages.chooseTaskHint }}</p>
        <div class="hk-choices">
          <v-btn
            v-for="type in taskTypes"
            :key="type"
            color="primary"
            :variant="type === 'other' ? 'tonal' : 'flat'"
            size="x-large"
            :prepend-icon="taskIcons[type]"
            :disabled="busy"
            @click="begin(type)"
            >{{ messages[taskKeys[type]] }}</v-btn
          >
        </div>
      </section>

      <section
        class="hk-section"
        aria-labelledby="hk-recent-heading"
      >
        <h3
          id="hk-recent-heading"
          class="hk-section-title"
        >
          {{ messages.roomHistory }}
        </h3>
        <p
          v-if="!recent.length"
          class="hk-muted"
        >
          {{ messages.noRoomHistory }}
        </p>
        <ol
          v-else
          class="hk-recent"
        >
          <li
            v-for="entry in recent"
            :key="entry.id"
          >
            <span
              ><v-icon
                :icon="taskIcons[entry.type]"
                size="15"
              />{{ messages[taskKeys[entry.type]] }}</span
            >
            <small
              >{{ formatDateTime(entry.startedAt) }} · {{ shortName(entry.attendantEmail) }}</small
            >
            <strong>{{ formatDuration(entry.durationSeconds ?? 0) }}</strong>
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
        @click="emit('archive')"
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
