<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import ModuleDialog from '../../../shared/module-dialog.vue';
import ActionMenu from '../../../shared/action-menu.vue';
import ModulePage from '../../../shared/ModulePage.vue';
import EmptyFilterChips from '../../../shared/empty-filter-chips.vue';
import FilterGroup from '../../../shared/filter-group.vue';
import ListRow from '../../../shared/list-row.vue';
import UndoSnackbar from '../../../shared/undo-snackbar.vue';
import { useOptimisticArchive, useUndoNotice } from '../../../core/use-optimistic-archive';
import { runtime } from '../../../config/runtime';
import type { ModuleAssignment } from '../../../core/module-access';
import CorrectionForm from '../components/CorrectionForm.vue';
import LeaveForm from '../components/LeaveForm.vue';
import PersonForm from '../components/PersonForm.vue';
import SelfSettingsForm from '../components/SelfSettingsForm.vue';
import {
  errorMessage,
  formatClock,
  formatDate,
  formatDuration,
  isConflict,
  isReviewable,
  verificationKeys,
  shiftShortKeys,
  stateKeys,
  stateTones,
  typeKeys,
  useCasualAttendanceMessages,
} from '../composables/useCasualAttendanceMessages';
import { demoDepartments, demoHotelId, sharedDemoCasualAttendanceApi } from '../demo-api';
import { createLiveCasualAttendanceApi } from '../live-api';
import { personTypes } from '../types';
import type {
  AttendanceRecord,
  CorrectionInput,
  DayRow,
  LinkCode,
  MarkAction,
  PeriodFilter,
  Person,
  PersonInput,
  PersonType,
  RecapRow,
} from '../types';
import {
  addDays,
  canCheckInOn,
  dayState,
  daysBetween,
  hotelToday,
  lateMinutes,
  shiftStart,
  workedMinutes,
} from '../validation';
import type { DayState } from '../validation';
import '../styles.css';

const props = withDefaults(defineProps<{ access?: ModuleAssignment[] }>(), { access: () => [] });
const emit = defineEmits<{ back: [] }>();
const messages = useCasualAttendanceMessages();
const api = runtime.demo ? sharedDemoCasualAttendanceApi() : createLiveCasualAttendanceApi();
const router = useRouter();
// Staff who are also linked to a person reach My attendance from here.
const selfLinked = ref(false);
api
  .selfStatus()
  .then((status) => (selfLinked.value = status.linked))
  .catch(() => undefined);

// Demo mode grants every capability on sample departments; production uses server grants.
const scope = computed<ModuleAssignment[]>(() =>
  runtime.demo
    ? demoDepartments.map((d) => ({
        moduleId: 'casual-attendance',
        hotelId: demoHotelId,
        hotelName: '',
        departmentId: d.id,
        departmentCode: d.id,
        departmentName: d.name,
        canRead: true,
        canWrite: true,
        canManage: true,
      }))
    : props.access.filter((row) => row.moduleId === 'casual-attendance' && row.canRead),
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
const departmentName = (id: string) =>
  hotelScope.value.find((row) => row.departmentId === id)?.departmentName ?? id;

type Tab = 'today' | 'people' | 'recap';
const tab = ref<Tab>('today');
const today = ref(hotelToday());
const loading = ref(true);
const loadingMore = ref(false);
const failure = ref('');
const { notice, undoAction, show: showNotice } = useUndoNotice();
let controller: AbortController | null = null;
let searchTimer: ReturnType<typeof setTimeout> | undefined;

// Shared filters
const departmentId = ref<string | null>(null);
const search = ref('');
// Today
const day = ref(today.value);
type StatusFilter = 'all' | 'pending' | 'onDuty' | 'late' | 'done' | 'away' | 'absent' | 'review';
const statusFilter = ref<StatusFilter>('all');
const dayRows = ref<DayRow[]>([]);
// People
const people = ref<Person[]>([]);
const nextCursor = ref<string | null>(null);
const typeFilter = ref<PersonType | null>(null);
const period = ref<PeriodFilter>('current');
// Recap
const recapFrom = ref(today.value.slice(0, 8) + '01');
const recapTo = ref(today.value);
const recapRows = ref<RecapRow[]>([]);

async function load(after: string | null = null) {
  if (!hotelId.value) return;
  controller?.abort();
  controller = new AbortController();
  const signal = controller.signal;
  if (after) loadingMore.value = true;
  else loading.value = true;
  failure.value = '';
  try {
    if (tab.value === 'today') {
      dayRows.value = await api.listDay(
        { hotelId: hotelId.value, departmentId: departmentId.value, day: day.value },
        signal,
      );
    } else if (tab.value === 'people') {
      const page = await api.listPeople(
        {
          hotelId: hotelId.value,
          departmentId: departmentId.value,
          type: typeFilter.value,
          period: period.value,
          search: search.value,
          after,
        },
        signal,
      );
      people.value = after ? [...people.value, ...page.data] : page.data;
      nextCursor.value = page.nextCursor;
    } else {
      recapRows.value = await api.recap(recapQuery(), 'view', signal);
    }
  } catch (error) {
    if (!signal.aborted) failure.value = errorMessage(messages.value, error);
  } finally {
    if (!signal.aborted) {
      loading.value = false;
      loadingMore.value = false;
    }
  }
}
const recapQuery = () => ({
  hotelId: hotelId.value,
  departmentId: departmentId.value,
  type: typeFilter.value,
  from: recapFrom.value,
  to: recapTo.value,
});
watch([tab, departmentId, day, typeFilter, period, recapFrom, recapTo], () => {
  today.value = hotelToday();
  void load();
});
// Only the People list searches on the server; the day list filters what it has.
watch(search, () => {
  if (tab.value !== 'people') return;
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => void load(), 300);
});
watch(hotelId, () => void load(), { immediate: true });
onBeforeUnmount(() => {
  controller?.abort();
  clearTimeout(searchTimer);
});

// ---- Today ----
type ViewRow = DayRow & { state: DayState; late: number };
const viewRows = computed<ViewRow[]>(() =>
  dayRows.value.map((row) => ({
    ...row,
    state: dayState(row.record),
    late: row.record ? lateMinutes(row.record) : 0,
  })),
);
const matchesStatus = (row: ViewRow) => {
  switch (statusFilter.value) {
    case 'all':
      return true;
    case 'late':
      return row.late > 0;
    case 'away':
      return row.state === 'leave' || row.state === 'sick';
    case 'review':
      return isReviewable(row.record?.verification ?? null);
    default:
      return row.state === statusFilter.value;
  }
};
const visibleDayRows = computed(() => {
  const term = search.value.trim().toLowerCase();
  return viewRows.value.filter(
    (row) => matchesStatus(row) && (!term || row.person.name.toLowerCase().includes(term)),
  );
});
const dayCounts = computed(() => {
  const rows = viewRows.value;
  return {
    scheduled: rows.length,
    checkedIn: rows.filter((row) => row.state === 'onDuty' || row.state === 'done').length,
    late: rows.filter((row) => row.late > 0).length,
  };
});
function chip(row: ViewRow) {
  if (row.state === 'onDuty' && row.late)
    return {
      tone: 'warning',
      label: `${messages.value.stateLate} ${formatDuration(row.late, messages.value)}`,
    };
  return { tone: stateTones[row.state], label: messages.value[stateKeys[row.state]] };
}
function detail(row: ViewRow) {
  const record = row.record;
  const start = shiftStart[row.person.shift];
  const expected =
    String(Math.floor(start / 60)).padStart(2, '0') + ':' + String(start % 60).padStart(2, '0');
  if (!record) return `${messages.value.expectedAt} ${expected}`;
  if (record.status !== 'present') return record.note;
  // Self check-ins say so, with their review state, in the same line as the times.
  const suffix =
    (record.corrected ? ` · ${messages.value.corrected}` : '') +
    (record.source === 'self' ? ` · ${messages.value.source}` : '') +
    (record.verification ? ` · ${messages.value[verificationKeys[record.verification]]}` : '');
  if (!record.checkOut) return `${messages.value.inAt} ${formatClock(record.checkIn!)}${suffix}`;
  const late = row.late
    ? ` · ${messages.value.stateLate.toLowerCase()} ${formatDuration(row.late, messages.value)}`
    : '';
  return `${formatClock(record.checkIn!)}–${formatClock(record.checkOut)} · ${formatDuration(
    workedMinutes(record),
    messages.value,
  )}${late}${suffix}`;
}
const identityLine = (person: DayRow['person']) =>
  [
    messages.value[typeKeys[person.type]],
    person.origin,
    messages.value[shiftShortKeys[person.shift]],
    hotelScope.value.length > 1 && !departmentId.value ? person.departmentName : '',
  ]
    .filter(Boolean)
    .join(' · ');

const busyRows = ref(new Set<string>());
function replaceRecord(personId: string, record: AttendanceRecord | null) {
  dayRows.value = dayRows.value.map((row) =>
    row.person.id === personId ? { ...row, record } : row,
  );
}
async function act(
  row: DayRow,
  action: MarkAction,
  note = '',
  options: { rethrow?: boolean } = {},
) {
  const personId = row.person.id;
  if (busyRows.value.has(personId)) return;
  busyRows.value.add(personId);
  const workDay = day.value;
  try {
    const record = await api.mark(
      hotelId.value,
      personId,
      workDay,
      action,
      row.record?.version ?? null,
      note,
    );
    if (workDay === day.value) replaceRecord(personId, record);
    announce(row.person.name, action, record, workDay);
  } catch (error) {
    if (options.rethrow && !isConflict(error)) throw error;
    showNotice(errorMessage(messages.value, error));
    if (isConflict(error)) await load();
  } finally {
    busyRows.value.delete(personId);
  }
}
/** Notice for a change, with an Undo that reverses it. */
function announce(
  name: string,
  action: MarkAction,
  record: AttendanceRecord | null,
  workDay: string,
) {
  const undo = (reverse: MarkAction) => () => {
    const current = dayRows.value.find((row) => row.person.id === record?.personId);
    if (current && workDay === day.value) void act(current, reverse);
  };
  switch (action) {
    case 'check_in':
      return showNotice(
        `${name} ${messages.value.checkedIn} ${formatClock(record!.checkIn!)}`,
        undo('reset'),
      );
    case 'check_out':
      return showNotice(
        `${name} ${messages.value.checkedOut} ${formatClock(record!.checkOut!)}`,
        undo('reopen'),
      );
    case 'leave':
      return showNotice(`${name} ${messages.value.markedLeave}`, undo('reset'));
    case 'sick':
      return showNotice(`${name} ${messages.value.markedSick}`, undo('reset'));
    case 'absent':
      return showNotice(`${name} ${messages.value.markedAbsent}`, undo('reset'));
    case 'reopen':
      return showNotice(messages.value.reopened);
    case 'reset':
      return showNotice(messages.value.cleared);
    case 'approve':
      return showNotice(`${name}: ${messages.value.approved}`);
    case 'reject':
      return showNotice(`${name}: ${messages.value.rejected}`);
  }
}
/** Approve is the row's main action once the day is closed and only review is left. */
const canApproveNow = (row: ViewRow) =>
  row.state === 'done' &&
  isReviewable(row.record?.verification ?? null) &&
  can(row.person.departmentId, 'canWrite');
const rejectOpen = ref(false);
const rejecting = ref<ViewRow | null>(null);
function openReject(row: ViewRow) {
  rejecting.value = row;
  rejectOpen.value = true;
}
async function confirmReject() {
  const row = rejecting.value;
  rejectOpen.value = false;
  if (row) await act(row, 'reject');
}
const canCheckIn = computed(() => canCheckInOn(day.value, today.value));
/** Leave, sick and absent can be marked a week back and a month ahead. */
const canMarkAway = computed(
  () => day.value >= addDays(today.value, -7) && day.value <= addDays(today.value, 30),
);
const canCorrect = computed(
  () => day.value <= today.value && day.value >= addDays(today.value, -62),
);
function menuItems(row: ViewRow) {
  const write = can(row.person.departmentId, 'canWrite');
  const manage = can(row.person.departmentId, 'canManage');
  const items: { key: string; icon: string; title: string; run: () => void }[] = [];
  const verification = row.record?.verification ?? null;
  if (write && (isReviewable(verification) || verification === 'rejected') && !canApproveNow(row))
    items.push({
      key: 'approve',
      icon: 'mdi-check-decagram-outline',
      title: messages.value.approve,
      run: () => void act(row, 'approve'),
    });
  if (write && isReviewable(verification))
    items.push({
      key: 'reject',
      icon: 'mdi-close-octagon-outline',
      title: messages.value.reject,
      run: () => openReject(row),
    });
  if (write && row.state === 'pending' && canMarkAway.value) {
    items.push({
      key: 'leave',
      icon: 'mdi-note-text-outline',
      title: messages.value.markLeave,
      run: () => openLeave(row),
    });
    items.push({
      key: 'absent',
      icon: 'mdi-close-circle-outline',
      title: messages.value.markAbsent,
      run: () => void act(row, 'absent'),
    });
  }
  if (manage && canCorrect.value && row.state !== 'leave' && row.state !== 'sick')
    items.push({
      key: 'correct',
      icon: 'mdi-clock-edit-outline',
      title: messages.value.correctTime,
      run: () => openCorrection(row),
    });
  if (write && row.state === 'done')
    items.push({
      key: 'reopen',
      icon: 'mdi-undo',
      title: messages.value.reopen,
      run: () => void act(row, 'reopen'),
    });
  if (write && row.record && row.state !== 'done')
    items.push({
      key: 'reset',
      icon: 'mdi-eraser',
      title: messages.value.clearMark,
      run: () => void act(row, 'reset'),
    });
  return items;
}

const leaveOpen = ref(false);
const correctionOpen = ref(false);
const selectedRow = ref<DayRow | null>(null);
function openLeave(row: DayRow) {
  selectedRow.value = row;
  leaveOpen.value = true;
}
function openCorrection(row: DayRow) {
  selectedRow.value = row;
  correctionOpen.value = true;
}
async function saveLeave(kind: 'leave' | 'sick', note: string) {
  await act(selectedRow.value!, kind, note, { rethrow: true });
}
async function saveCorrection(input: CorrectionInput) {
  const row = selectedRow.value!;
  const record = await api.correct(
    hotelId.value,
    row.person.id,
    day.value,
    input,
    row.record?.version ?? null,
  );
  replaceRecord(row.person.id, record);
  showNotice(messages.value.correctedDone);
}

// ---- People ----
function personChip(person: Person) {
  if (person.status === 'archived')
    return { tone: 'neutral', label: messages.value.personArchived };
  if (person.startDate > today.value)
    return {
      tone: 'neutral',
      label: `${messages.value.personUpcoming} ${formatDate(person.startDate)}`,
    };
  if (person.endDate !== null && person.endDate < today.value)
    return { tone: 'neutral', label: messages.value.personEnded };
  if (person.endDate !== null) {
    const left = daysBetween(today.value, person.endDate);
    if (left === 0) return { tone: 'warning', label: messages.value.personEndsToday };
    if (left <= 3)
      return {
        tone: 'warning',
        label: `${messages.value.personEndsIn} ${left} ${messages.value.daysUnit}`,
      };
  }
  return { tone: 'info', label: messages.value.personActive };
}
// Self check-in links
const linkCode = ref<(LinkCode & { name: string }) | null>(null);
const linkCodeOpen = ref(false);
const unlinkOpen = ref(false);
const unlinking = ref<Person | null>(null);
const linkBusy = ref(false);
async function createLinkCode(person: Person) {
  if (linkBusy.value) return;
  linkBusy.value = true;
  try {
    linkCode.value = { ...(await api.createLinkCode(hotelId.value, person.id)), name: person.name };
    linkCodeOpen.value = true;
  } catch (error) {
    showNotice(errorMessage(messages.value, error));
  } finally {
    linkBusy.value = false;
  }
}
async function copyLinkCode() {
  if (!linkCode.value) return;
  try {
    await navigator.clipboard.writeText(linkCode.value.code);
    showNotice(messages.value.codeCopied);
  } catch {
    // The code stays on screen to read out or type.
  }
}
function openUnlink(person: Person) {
  unlinking.value = person;
  unlinkOpen.value = true;
}
async function confirmUnlink() {
  const person = unlinking.value;
  if (!person || linkBusy.value) return;
  linkBusy.value = true;
  try {
    await api.unlink(hotelId.value, person.id);
    unlinkOpen.value = false;
    showNotice(messages.value.unlinked);
    await load();
  } catch (error) {
    unlinkOpen.value = false;
    showNotice(errorMessage(messages.value, error));
  } finally {
    linkBusy.value = false;
  }
}
const settingsOpen = ref(false);
async function settingsSaved() {
  showNotice(messages.value.settingsSaved);
}
const periodText = (person: Person) =>
  person.endDate
    ? `${formatDate(person.startDate)} – ${formatDate(person.endDate)}`
    : `${messages.value.from2} ${formatDate(person.startDate)} · ${messages.value.noEndDate}`;

const formOpen = ref(false);
const editing = ref<Person | null>(null);
function openForm(person: Person | null = null) {
  editing.value = person;
  formOpen.value = true;
}
async function savePerson(input: PersonInput) {
  await api.savePerson(hotelId.value, input, editing.value ?? undefined);
  showNotice(messages.value.saved);
  await load();
}
const { toggle: toggleArchive } = useOptimisticArchive({
  rows: people,
  statusFilter: () =>
    period.value === 'archived' ? 'archived' : period.value === 'all' ? 'all' : 'active',
  commit: (person, archived) => api.setArchived(hotelId.value, person, archived),
  show: showNotice,
  messages: () => ({
    archived: messages.value.archivedDone,
    restored: messages.value.restoredDone,
  }),
  errorMessage: (error) => errorMessage(messages.value, error),
  reload: () => load(),
});

// ---- Recap ----
const recapTotals = computed(() => recapRows.value.length);
/** Review columns appear only when the range has self check-ins to review or rejected days. */
const reviewColumns = computed(() =>
  recapRows.value.some((row) => row.needsReview > 0 || row.rejected > 0),
);
const exporting = ref(false);
/** Cells that start like a formula are prefixed so spreadsheets show them as text. */
const csvCell = (value: string | number) => {
  const text = String(value);
  const safe = /^[=+\-@\t\r]/.test(text) ? "'" + text : text;
  return /[",\n;]/.test(safe) ? '"' + safe.replace(/"/g, '""') + '"' : safe;
};
async function exportRecap() {
  if (exporting.value) return;
  exporting.value = true;
  try {
    const rows = await api.recap(recapQuery(), 'export');
    const m = messages.value;
    const lines = [
      [
        m.name,
        m.type,
        m.origin,
        m.department,
        m.present,
        m.late,
        m.leave,
        m.sick,
        m.absent,
        m.needsReview,
        m.rejectedDays,
        m.totalHours,
      ],
      ...rows.map((row) => [
        row.name,
        m[typeKeys[row.type]],
        row.origin,
        row.departmentName,
        row.present,
        row.late,
        row.leave,
        row.sick,
        row.absent,
        row.needsReview,
        row.rejected,
        (row.minutes / 60).toFixed(2),
      ]),
    ].map((line) => line.map(csvCell).join(','));
    const blob = new window.Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const link = document.createElement('a');
    link.href = window.URL.createObjectURL(blob);
    link.download = `casual-attendance-${recapFrom.value}-${recapTo.value}.csv`;
    link.click();
    window.URL.revokeObjectURL(link.href);
    showNotice(m.exported);
  } catch (error) {
    showNotice(errorMessage(messages.value, error));
  } finally {
    exporting.value = false;
  }
}

// ---- Page frame ----
const description = computed(() => {
  const m = messages.value;
  if (tab.value === 'today') {
    const c = dayCounts.value;
    return [
      `${c.scheduled} ${m.scheduledCount}`,
      `${c.checkedIn} ${m.checkedInCount}`,
      c.late ? `${c.late} ${m.lateCount}` : '',
    ]
      .filter(Boolean)
      .join(' · ');
  }
  if (tab.value === 'people')
    return `${people.value.length} ${people.value.length === 1 ? m.peopleOne : m.peopleMany}`;
  return `${m.recapRange} ${formatDate(recapFrom.value)} – ${formatDate(recapTo.value)} · ${
    recapTotals.value
  } ${recapTotals.value === 1 ? m.peopleOne : m.peopleMany}`;
});
const filterCount = computed(() => {
  const department = departmentId.value ? 1 : 0;
  if (tab.value === 'today') return department + (statusFilter.value !== 'all' ? 1 : 0);
  if (tab.value === 'people')
    return department + (typeFilter.value ? 1 : 0) + (period.value !== 'current' ? 1 : 0);
  return department + (typeFilter.value ? 1 : 0);
});
const hasFilters = computed(
  () => filterCount.value > 0 || (tab.value !== 'recap' && !!search.value.trim()),
);
const isEmpty = computed(() =>
  tab.value === 'today'
    ? !visibleDayRows.value.length
    : tab.value === 'people'
      ? !people.value.length
      : !recapRows.value.length,
);
const emptyTitle = computed(() => {
  const m = messages.value;
  if (hasFilters.value) return m.noResults;
  return tab.value === 'today'
    ? m.emptyDayTitle
    : tab.value === 'people'
      ? m.emptyPeopleTitle
      : m.emptyRecapTitle;
});
const emptyDescription = computed(() => {
  const m = messages.value;
  if (hasFilters.value) return m.noResultsHint;
  if (tab.value === 'recap') return m.emptyRecapDescription;
  const manage = manageableDepartments.value.length > 0;
  if (tab.value === 'today') return manage ? m.emptyDayDescription : m.emptyDayReadOnly;
  return manage ? m.emptyPeopleDescription : m.emptyPeopleReadOnly;
});
const activeFilters = computed(() => {
  const m = messages.value;
  const rows: { key: string; label: string; clear: () => void }[] = [];
  if (tab.value !== 'recap' && search.value.trim())
    rows.push({
      key: 'search',
      label: `${m.searchName}: “${search.value.trim()}”`,
      clear: () => (search.value = ''),
    });
  if (departmentId.value)
    rows.push({
      key: 'department',
      label: `${m.department}: ${departmentName(departmentId.value)}`,
      clear: () => (departmentId.value = null),
    });
  if (tab.value === 'today' && statusFilter.value !== 'all')
    rows.push({
      key: 'status',
      label: `${m.status}: ${statusItems.value.find((i) => i.value === statusFilter.value)?.title}`,
      clear: () => (statusFilter.value = 'all'),
    });
  if (tab.value !== 'today' && typeFilter.value)
    rows.push({
      key: 'type',
      label: `${m.type}: ${m[typeKeys[typeFilter.value]]}`,
      clear: () => (typeFilter.value = null),
    });
  if (tab.value === 'people' && period.value !== 'current')
    rows.push({
      key: 'period',
      label: `${m.period}: ${periodItems.value.find((i) => i.value === period.value)?.title}`,
      clear: () => (period.value = 'current'),
    });
  return rows;
});
function resetFilterGroup() {
  departmentId.value = null;
  statusFilter.value = 'all';
  typeFilter.value = null;
  period.value = 'current';
}
function resetFilters() {
  search.value = '';
  resetFilterGroup();
}

const departmentItems = computed(() => [
  { value: null, title: messages.value.allDepartments },
  ...hotelScope.value.map((row) => ({ value: row.departmentId, title: row.departmentName })),
]);
const statusItems = computed(() => {
  const m = messages.value;
  return [
    { value: 'all', title: m.allStatuses },
    { value: 'pending', title: m.statePending },
    { value: 'onDuty', title: m.stateOnDuty },
    { value: 'late', title: m.stateLate },
    { value: 'done', title: m.stateDone },
    { value: 'away', title: m.stateLeave + ' / ' + m.stateSick },
    { value: 'absent', title: m.stateAbsent },
    { value: 'review', title: m.needsReviewFilter },
  ];
});
const typeItems = computed(() => [
  { value: null, title: messages.value.allTypes },
  ...personTypes.map((type) => ({ value: type, title: messages.value[typeKeys[type]] })),
]);
const periodItems = computed(() => {
  const m = messages.value;
  return [
    { value: 'current', title: m.periodCurrent },
    { value: 'ended', title: m.periodEnded },
    { value: 'archived', title: m.periodArchived },
    { value: 'all', title: m.periodAll },
  ];
});
</script>
<template>
  <div class="ca-module">
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
      :empty-icon="hasFilters ? 'mdi-filter-off-outline' : 'mdi-account-clock-outline'"
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
          v-if="tab === 'recap' && recapRows.length"
          variant="text"
          prepend-icon="mdi-download"
          :loading="exporting"
          @click="exportRecap"
          >{{ messages.export }}</v-btn
        ><v-btn
          v-if="selfLinked"
          variant="text"
          prepend-icon="mdi-account-clock-outline"
          @click="router.push({ name: 'casual-attendance-me' })"
          >{{ messages.myAttendance }}</v-btn
        ><v-btn
          v-if="manageableDepartments.length"
          variant="text"
          prepend-icon="mdi-cellphone-check"
          @click="settingsOpen = true"
          >{{ messages.selfSettings }}</v-btn
        ><v-btn
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
          icon="mdi-account-clock-outline"
          class="module-notice"
          >{{ messages.demoNotice }}</v-alert
        >
        <div class="ca-controls">
          <v-tabs
            v-model="tab"
            color="primary"
            density="compact"
            class="ca-tabs"
            :aria-label="messages.sections"
          >
            <v-tab
              value="today"
              prepend-icon="mdi-clock-outline"
              >{{ messages.tabToday }}</v-tab
            >
            <v-tab
              value="people"
              prepend-icon="mdi-account-multiple-outline"
              >{{ messages.tabPeople }}</v-tab
            >
            <v-tab
              value="recap"
              prepend-icon="mdi-chart-bar"
              >{{ messages.tabRecap }}</v-tab
            >
          </v-tabs>
          <div class="ca-toolbar">
            <template v-if="tab === 'today'">
              <v-text-field
                v-model="day"
                class="ca-date"
                type="date"
                :label="messages.day"
                :max="addDays(today, 30)"
                min="2000-01-01"
              />
              <v-text-field
                v-model="search"
                class="ca-search"
                :placeholder="messages.searchName"
                :aria-label="messages.searchName"
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
                  v-if="hotelScope.length > 1"
                  v-model="departmentId"
                  :items="departmentItems"
                  :label="messages.department"
                />
                <v-select
                  v-model="statusFilter"
                  :items="statusItems"
                  :label="messages.status"
                />
              </FilterGroup>
            </template>
            <template v-else-if="tab === 'people'">
              <v-text-field
                v-model="search"
                class="ca-search"
                :placeholder="messages.searchPeople"
                :aria-label="messages.searchPeople"
                prepend-inner-icon="mdi-magnify"
                single-line
                clearable
                maxlength="100"
                @update:model-value="search = $event ?? ''"
              />
              <FilterGroup
                :count="filterCount"
                @reset="resetFilterGroup"
              >
                <v-select
                  v-model="typeFilter"
                  :items="typeItems"
                  :label="messages.type"
                />
                <v-select
                  v-if="hotelScope.length > 1"
                  v-model="departmentId"
                  :items="departmentItems"
                  :label="messages.department"
                />
                <v-select
                  v-model="period"
                  :items="periodItems"
                  :label="messages.period"
                />
              </FilterGroup>
            </template>
            <template v-else>
              <v-text-field
                v-model="recapFrom"
                class="ca-date"
                type="date"
                :label="messages.from"
                :max="recapTo"
                min="2000-01-01"
              />
              <v-text-field
                v-model="recapTo"
                class="ca-date"
                type="date"
                :label="messages.to"
                :min="recapFrom"
                :max="today"
              />
              <FilterGroup
                :count="filterCount"
                @reset="resetFilterGroup"
              >
                <v-select
                  v-model="typeFilter"
                  :items="typeItems"
                  :label="messages.type"
                />
                <v-select
                  v-if="hotelScope.length > 1"
                  v-model="departmentId"
                  :items="departmentItems"
                  :label="messages.department"
                />
              </FilterGroup>
            </template>
          </div>
        </div>
      </template>
      <template #empty-action>
        <EmptyFilterChips
          v-if="activeFilters.length"
          :filters="activeFilters"
          :reset-label="messages.reset"
          @reset="resetFilters"
        /><v-btn
          v-else-if="tab !== 'recap' && manageableDepartments.length"
          variant="tonal"
          color="primary"
          prepend-icon="mdi-plus"
          @click="openForm()"
          >{{ messages.add }}</v-btn
        >
      </template>

      <ul
        v-if="tab === 'today'"
        class="list-rows"
      >
        <ListRow
          v-for="row in visibleDayRows"
          :key="row.person.id"
          icon="mdi-account-outline"
        >
          <strong>{{ row.person.name }}</strong>
          <small>{{ identityLine(row.person) }}</small>
          <template #status>
            <span
              class="list-row-chip"
              :class="'ca-chip--' + chip(row).tone"
              >{{ chip(row).label }}</span
            >
            <small v-if="detail(row)">{{ detail(row) }}</small>
          </template>
          <template #actions>
            <v-btn
              v-if="
                row.state === 'pending' && canCheckIn && can(row.person.departmentId, 'canWrite')
              "
              variant="tonal"
              class="row-primary-action"
              prepend-icon="mdi-login"
              :loading="busyRows.has(row.person.id)"
              :aria-label="messages.checkIn + ' — ' + row.person.name"
              @click="act(row, 'check_in')"
              >{{ messages.checkIn }}</v-btn
            ><v-btn
              v-else-if="row.state === 'onDuty' && can(row.person.departmentId, 'canWrite')"
              variant="tonal"
              class="row-primary-action"
              prepend-icon="mdi-logout"
              :loading="busyRows.has(row.person.id)"
              :aria-label="messages.checkOut + ' — ' + row.person.name"
              @click="act(row, 'check_out')"
              >{{ messages.checkOut }}</v-btn
            ><v-btn
              v-else-if="canApproveNow(row)"
              variant="tonal"
              class="row-primary-action"
              prepend-icon="mdi-check-decagram-outline"
              :loading="busyRows.has(row.person.id)"
              :aria-label="messages.approve + ' — ' + row.person.name"
              @click="act(row, 'approve')"
              >{{ messages.approve }}</v-btn
            ><ActionMenu
              v-if="menuItems(row).length"
              :label="messages.moreActions + ' — ' + row.person.name"
              ><v-list-item
                v-for="item in menuItems(row)"
                :key="item.key"
                :prepend-icon="item.icon"
                :title="item.title"
                @click="item.run()"
            /></ActionMenu>
          </template>
        </ListRow>
      </ul>

      <template v-else-if="tab === 'people'">
        <ul class="list-rows">
          <ListRow
            v-for="person in people"
            :key="person.id"
            icon="mdi-account-outline"
            :archived="person.status === 'archived'"
          >
            <strong>{{ person.name }}</strong>
            <small>{{
              [messages[typeKeys[person.type]], person.origin, person.departmentName]
                .filter(Boolean)
                .join(' · ')
            }}</small>
            <template #status>
              <span
                class="list-row-chip"
                :class="'ca-chip--' + personChip(person).tone"
                >{{ personChip(person).label }}</span
              >
              <small
                >{{ periodText(person) }} ·
                {{ person.linked ? messages.linkedAccount : messages.notLinkedYet }}</small
              >
            </template>
            <template #actions>
              <v-btn
                v-if="can(person.departmentId, 'canManage')"
                variant="tonal"
                class="row-primary-action"
                prepend-icon="mdi-pencil-outline"
                :aria-label="messages.edit + ' — ' + person.name"
                @click="openForm(person)"
                >{{ messages.edit }}</v-btn
              ><ActionMenu
                v-if="can(person.departmentId, 'canManage')"
                :label="messages.moreActions + ' — ' + person.name"
                ><v-list-item
                  :prepend-icon="
                    person.status === 'active'
                      ? 'mdi-archive-outline'
                      : 'mdi-archive-arrow-up-outline'
                  "
                  :title="person.status === 'active' ? messages.archive : messages.restore"
                  @click="toggleArchive(person)" /><v-list-item
                  v-if="person.status === 'active' && !person.linked"
                  prepend-icon="mdi-link-variant"
                  :title="messages.createLinkCode"
                  :disabled="linkBusy"
                  @click="createLinkCode(person)" /><v-list-item
                  v-if="person.linked"
                  prepend-icon="mdi-link-variant-off"
                  :title="messages.unlink"
                  @click="openUnlink(person)"
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
      </template>

      <section
        v-else
        class="ca-panel stack-table-container"
        :aria-label="messages.tabRecap"
      >
        <table
          class="ca-table stack-table"
          style="--stack-columns: 2"
        >
          <thead>
            <tr>
              <th scope="col">{{ messages.name }}</th>
              <th scope="col">{{ messages.type }}</th>
              <th scope="col">{{ messages.department }}</th>
              <th
                scope="col"
                class="ca-number"
              >
                {{ messages.present }}
              </th>
              <th
                scope="col"
                class="ca-number"
              >
                {{ messages.late }}
              </th>
              <th
                scope="col"
                class="ca-number"
              >
                {{ messages.leave }}
              </th>
              <th
                scope="col"
                class="ca-number"
              >
                {{ messages.sick }}
              </th>
              <th
                scope="col"
                class="ca-number"
              >
                {{ messages.absent }}
              </th>
              <template v-if="reviewColumns">
                <th
                  scope="col"
                  class="ca-number"
                >
                  {{ messages.needsReview }}
                </th>
                <th
                  scope="col"
                  class="ca-number"
                >
                  {{ messages.rejectedDays }}
                </th>
              </template>
              <th
                scope="col"
                class="ca-number"
              >
                {{ messages.totalHours }}
              </th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="row in recapRows"
              :key="row.personId"
            >
              <td class="stack-table-primary">{{ row.name }}</td>
              <td :data-label="messages.type">
                {{ messages[typeKeys[row.type]]
                }}<span
                  v-if="row.origin"
                  class="ca-muted"
                >
                  · {{ row.origin }}</span
                >
              </td>
              <td :data-label="messages.department">{{ row.departmentName }}</td>
              <td
                class="ca-number"
                :data-label="messages.present"
              >
                {{ row.present }}
              </td>
              <td
                class="ca-number"
                :data-label="messages.late"
              >
                {{ row.late }}
              </td>
              <td
                class="ca-number"
                :data-label="messages.leave"
              >
                {{ row.leave }}
              </td>
              <td
                class="ca-number"
                :data-label="messages.sick"
              >
                {{ row.sick }}
              </td>
              <td
                class="ca-number"
                :data-label="messages.absent"
              >
                {{ row.absent }}
              </td>
              <template v-if="reviewColumns">
                <td
                  class="ca-number"
                  :data-label="messages.needsReview"
                >
                  {{ row.needsReview }}
                </td>
                <td
                  class="ca-number"
                  :data-label="messages.rejectedDays"
                >
                  {{ row.rejected }}
                </td>
              </template>
              <td
                class="ca-number"
                :data-label="messages.totalHours"
              >
                {{ formatDuration(row.minutes, messages) }}
              </td>
            </tr>
          </tbody>
        </table>
      </section>
    </ModulePage>
    <PersonForm
      v-model="formOpen"
      :person="editing"
      :departments="manageableDepartments"
      :save="savePerson"
    />
    <LeaveForm
      v-model="leaveOpen"
      :name="selectedRow?.person.name ?? ''"
      :day="day"
      :save="saveLeave"
    />
    <CorrectionForm
      v-model="correctionOpen"
      :name="selectedRow?.person.name ?? ''"
      :day="day"
      :record="selectedRow?.record ?? null"
      :save="saveCorrection"
    />
    <SelfSettingsForm
      v-model="settingsOpen"
      :api="api"
      :hotel-id="hotelId"
      :departments="manageableDepartments"
      @saved="settingsSaved"
    />
    <ModuleDialog
      v-model="linkCodeOpen"
      :title="messages.linkCodeTitle"
      :subtitle="linkCode?.name ?? ''"
    >
      <template v-if="linkCode">
        <p
          class="ca-link-code"
          aria-live="polite"
        >
          {{ linkCode.code }}
        </p>
        <p class="ca-hint">
          {{
            messages.linkCodeHint
              .replace('{name}', linkCode.name)
              .replace(
                '{expires}',
                formatDate(hotelToday(new Date(linkCode.expiresAt))) +
                  ' ' +
                  formatClock(linkCode.expiresAt),
              )
          }}
        </p>
      </template>
      <template #actions="{ close }">
        <v-btn
          variant="text"
          prepend-icon="mdi-content-copy"
          @click="copyLinkCode"
          >{{ messages.copyCode }}</v-btn
        ><v-btn
          color="primary"
          @click="close"
          >{{ messages.done }}</v-btn
        >
      </template>
    </ModuleDialog>
    <ModuleDialog
      v-model="unlinkOpen"
      :title="messages.unlinkTitle"
      :confirm-label="messages.unlink"
      destructive
      :busy="linkBusy"
      @confirm="confirmUnlink"
    >
      <p>{{ messages.unlinkBody.replace('{name}', unlinking?.name ?? '') }}</p>
    </ModuleDialog>
    <ModuleDialog
      v-model="rejectOpen"
      :title="messages.rejectTitle"
      :subtitle="rejecting?.person.name ?? ''"
      :confirm-label="messages.reject"
      destructive
      @confirm="confirmReject"
    >
      <p>{{ messages.rejectBody }}</p>
    </ModuleDialog>
    <UndoSnackbar
      :message="notice"
      :undo="undoAction"
      @close="showNotice('')"
    />
  </div>
</template>
