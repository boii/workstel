<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import ListRow from '../../../shared/list-row.vue';
import ModuleDialog from '../../../shared/module-dialog.vue';
import ModulePage from '../../../shared/ModulePage.vue';
import UndoSnackbar from '../../../shared/undo-snackbar.vue';
import { runtime } from '../../../config/runtime';
import {
  errorMessage,
  formatClock,
  formatDate,
  formatDuration,
  shiftKeys,
  stateKeys,
  stateTones,
  useCasualAttendanceMessages,
  verificationKeys,
  verificationTones,
} from '../composables/useCasualAttendanceMessages';
import { sharedDemoCasualAttendanceApi } from '../demo-api';
import { createLiveCasualAttendanceApi } from '../live-api';
import type { AttendanceRecord, SelfAction, SelfStatus } from '../types';
import { dayState, lateMinutes, workedMinutes } from '../validation';
import '../styles.css';

/** Linked workers check themselves in and out. `attendanceOnly` is the shell state for
 * accounts without workspace access: no breadcrumb, and an unlinked account sees the code form. */
const props = withDefaults(defineProps<{ attendanceOnly?: boolean }>(), {
  attendanceOnly: false,
});
const messages = useCasualAttendanceMessages();
const router = useRouter();
const api = runtime.demo ? sharedDemoCasualAttendanceApi() : createLiveCasualAttendanceApi();

const status = ref<SelfStatus | null>(null);
const loading = ref(true);
const failure = ref('');
const busy = ref(false);
const actionError = ref('');
const confirmOut = ref(false);
const notice = ref('');
const code = ref('');
const codeError = ref('');
const linking = ref(false);
const now = ref(new Date());
let controller: AbortController | undefined;
const timer = window.setInterval(() => (now.value = new Date()), 30000);
onBeforeUnmount(() => {
  window.clearInterval(timer);
  controller?.abort();
});

async function load() {
  controller?.abort();
  controller = new AbortController();
  loading.value = !status.value;
  failure.value = '';
  try {
    status.value = await api.selfStatus(controller.signal);
  } catch (error) {
    if (controller.signal.aborted) return;
    failure.value = errorMessage(messages.value, error);
  } finally {
    loading.value = false;
  }
}
onMounted(load);

const linked = computed(() => (status.value?.linked ? status.value : null));
const record = computed(() => linked.value?.record ?? null);
const state = computed(() => dayState(record.value));
// The shift label already carries its hours, such as "Morning 07:00–15:00".
const shiftLine = computed(() => {
  const current = linked.value;
  if (!current) return '';
  return formatDate(current.workDate) + ' · ' + messages.value[shiftKeys[current.person.shift]];
});
/** The one action the worker can take now, if any. */
const action = computed<SelfAction | null>(() => {
  const current = linked.value;
  if (!current || !current.person.active || !current.selfEnabled) return null;
  if (state.value === 'pending') return current.scheduled ? 'check_in' : null;
  return state.value === 'onDuty' ? 'check_out' : null;
});
const headline = computed(() => {
  const m = messages.value;
  const current = linked.value;
  if (!current) return '';
  const rec = record.value;
  if (rec?.status === 'present' && rec.checkIn) {
    if (!rec.checkOut) return m.checkedInAt.replace('{time}', formatClock(rec.checkIn));
    return m.workedFor
      .replace('{range}', formatClock(rec.checkIn) + '–' + formatClock(rec.checkOut))
      .replace('{duration}', formatDuration(workedMinutes(rec), m));
  }
  if (rec) return m[stateKeys[state.value]];
  return m.notCheckedInYet;
});
const explanation = computed(() => {
  const m = messages.value;
  const current = linked.value;
  if (!current) return '';
  const rec = record.value;
  if (!current.person.active) return m.personInactive;
  if (rec && rec.status !== 'present') return m.markedBySupervisor;
  if (rec?.status === 'present' && !rec.checkOut)
    return formatDuration(workedMinutes(rec, now.value), m);
  if (rec) return '';
  if (!current.selfEnabled) return m.selfOff;
  if (!current.scheduled) return m.notScheduledToday;
  return '';
});
const needsContact = computed(
  () => record.value?.verification === 'needs_review' || record.value?.verification === 'rejected',
);

function chip(rec: AttendanceRecord) {
  const day = dayState(rec);
  if ((day === 'onDuty' || day === 'done') && lateMinutes(rec) > 0)
    return { label: messages.value.stateLate, tone: 'warning' };
  return { label: messages.value[stateKeys[day]], tone: stateTones[day] };
}
function times(rec: AttendanceRecord) {
  if (!rec.checkIn) return rec.note;
  const range = formatClock(rec.checkIn) + (rec.checkOut ? '–' + formatClock(rec.checkOut) : '');
  return rec.checkOut ? range + ' · ' + formatDuration(workedMinutes(rec), messages.value) : range;
}

async function mark(selfAction: SelfAction) {
  if (busy.value) return;
  busy.value = true;
  actionError.value = '';
  try {
    await api.selfMark(selfAction);
    confirmOut.value = false;
    notice.value =
      selfAction === 'check_in' ? messages.value.selfCheckedIn : messages.value.selfCheckedOut;
    await load();
  } catch (error) {
    confirmOut.value = false;
    actionError.value = errorMessage(messages.value, error);
    await load();
  } finally {
    busy.value = false;
  }
}
function press() {
  if (action.value === 'check_out') confirmOut.value = true;
  else if (action.value) void mark(action.value);
}
async function link() {
  if (linking.value) return;
  const value = code.value.replace(/[\s-]/g, '');
  codeError.value = value ? '' : messages.value.required;
  if (!value) return;
  linking.value = true;
  try {
    status.value = await api.redeemLinkCode(value);
    code.value = '';
    notice.value = messages.value.linkedDone;
  } catch (error) {
    codeError.value = errorMessage(messages.value, error);
  } finally {
    linking.value = false;
  }
}
</script>

<template>
  <div class="ca-module">
    <button
      v-if="!props.attendanceOnly"
      class="module-breadcrumb"
      @click="router.push({ name: 'casual-attendance' })"
    >
      <v-icon
        icon="mdi-arrow-left"
        size="var(--workstel-icon-sm)"
      />{{ messages.title }}
    </button>
    <ModulePage
      :title="status && !status.linked ? messages.linkTitle : messages.myAttendance"
      :description="
        linked
          ? linked.person.name + ' · ' + linked.person.departmentName
          : status && !status.linked
            ? messages.linkDescription
            : messages.myAttendanceDescription
      "
      empty-icon="mdi-account-clock-outline"
      :loading="loading"
      :error="failure"
      :empty="false"
      empty-title=""
      empty-description=""
      :retry-label="messages.retry"
      @retry="load()"
    >
      <template #toolbar>
        <v-alert
          v-if="runtime.demo"
          type="info"
          variant="tonal"
          density="compact"
          icon="mdi-account-clock-outline"
          class="module-notice"
          >{{ messages.demoNotice }}</v-alert
        >
      </template>

      <section
        v-if="status && !status.linked"
        class="ca-panel ca-link"
      >
        <v-form
          id="ca-link-form"
          @submit.prevent="link"
        >
          <label
            for="ca-link-code"
            class="field-label ca-first-label"
            >{{ messages.linkCode }}</label
          ><v-text-field
            id="ca-link-code"
            v-model="code"
            class="ca-code-field"
            :placeholder="messages.linkCodePlaceholder"
            :error-messages="codeError"
            :disabled="linking"
            maxlength="9"
            autocomplete="one-time-code"
            autocapitalize="characters"
            spellcheck="false"
          />
          <v-btn
            color="primary"
            type="submit"
            block
            class="ca-link-submit"
            :loading="linking"
            >{{ messages.link }}</v-btn
          >
        </v-form>
        <p class="ca-link-hint">{{ messages.linkStaffHint }}</p>
      </section>

      <template v-else-if="linked">
        <section
          class="ca-self"
          aria-live="polite"
        >
          <span class="ca-self-shift">{{ shiftLine }}</span>
          <span class="ca-self-headline">{{ headline }}</span>
          <small v-if="explanation">{{ explanation }}</small>
          <span
            v-if="record?.verification"
            class="list-row-chip"
            :class="'ca-chip--' + verificationTones[record.verification]"
            >{{ messages[verificationKeys[record.verification]] }}</span
          >
          <small v-if="needsContact">{{ messages.contactSupervisor }}</small>
          <v-alert
            v-if="actionError"
            type="error"
            variant="tonal"
            density="compact"
            role="alert"
            class="ca-self-error"
            >{{ actionError }}</v-alert
          >
          <v-btn
            v-if="action"
            color="primary"
            size="large"
            block
            class="ca-self-action"
            :prepend-icon="action === 'check_in' ? 'mdi-login' : 'mdi-logout'"
            :loading="busy"
            @click="press"
            >{{ action === 'check_in' ? messages.checkInNow : messages.checkOutNow }}</v-btn
          >
        </section>

        <h2 class="ca-section-title">{{ messages.history }}</h2>
        <p
          v-if="!linked.history.length"
          class="ca-muted"
        >
          {{ messages.noHistory }}
        </p>
        <ul
          v-else
          class="list-rows"
        >
          <ListRow
            v-for="rec in linked.history"
            :key="rec.id"
            icon="mdi-calendar-outline"
          >
            <strong>{{ formatDate(rec.workDate) }}</strong>
            <small>{{ times(rec) }}</small>
            <template #status>
              <span
                class="list-row-chip"
                :class="'ca-chip--' + chip(rec).tone"
                >{{ chip(rec).label }}</span
              >
              <small v-if="rec.verification">{{
                messages[verificationKeys[rec.verification]]
              }}</small>
            </template>
          </ListRow>
        </ul>
      </template>
    </ModulePage>
    <ModuleDialog
      v-model="confirmOut"
      :title="messages.checkOutTitle"
      :confirm-label="messages.checkOutNow"
      :busy="busy"
      @confirm="mark('check_out')"
    >
      <p>{{ messages.checkOutBody }}</p>
    </ModuleDialog>
    <UndoSnackbar
      :message="notice"
      :undo="null"
      @close="notice = ''"
    />
  </div>
</template>
