import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { locale } from '../../../i18n';
import { ModuleRequestError } from '../../../core/module-rpc';
import en from '../locales/en';
import id from '../locales/id';
import type { RoomStatus, TaskStatus, TaskType } from '../types';

export type HousekeepingMessages = Record<keyof typeof en, string>;
type Key = keyof typeof en;

export function useHousekeepingMessages() {
  return computed<HousekeepingMessages>(() => (locale.value === 'id' ? id : en));
}

export const statusKeys: Record<RoomStatus, Key> = {
  'vacant-dirty': 'statusVacantDirty',
  'vacant-clean': 'statusVacantClean',
  'vacant-ready': 'statusVacantReady',
  occupied: 'statusOccupied',
  'out-of-order': 'statusOutOfOrder',
};
export const statusCodeKeys: Record<RoomStatus, Key> = {
  'vacant-dirty': 'codeVacantDirty',
  'vacant-clean': 'codeVacantClean',
  'vacant-ready': 'codeVacantReady',
  occupied: 'codeOccupied',
  'out-of-order': 'codeOutOfOrder',
};
export const taskKeys: Record<TaskType, Key> = {
  departure: 'taskDeparture',
  'make-up': 'taskMakeUp',
  turndown: 'taskTurndown',
  'pre-arrival': 'taskPreArrival',
  'deep-clean': 'taskDeepClean',
};
export const taskIcons: Record<TaskType, string> = {
  departure: 'mdi-bed-empty',
  'make-up': 'mdi-spray-bottle',
  turndown: 'mdi-weather-night',
  'pre-arrival': 'mdi-star-outline',
  'deep-clean': 'mdi-vacuum-outline',
};
export const taskStatusKeys: Record<TaskStatus, Key> = {
  active: 'taskActive',
  paused: 'taskPaused',
  done: 'taskDone',
  dnd: 'taskDnd',
  refused: 'taskRefused',
  cancelled: 'taskCancelled',
};

const errorKeys: Record<string, Key> = {
  ACCESS_DENIED: 'accessDenied',
  VERSION_CONFLICT: 'versionConflict',
  ROOM_BUSY: 'roomBusy',
  ATTENDANT_BUSY: 'attendantBusy',
  WRONG_ROOM_STATUS: 'wrongRoomStatus',
  TASK_OPEN: 'taskOpen',
  TASK_CLOSED: 'taskClosed',
  DUPLICATE_ROOM: 'duplicateRoom',
  NOTE_REQUIRED: 'noteRequired',
};
/** Map a server error code to safe, localized copy; unknown failures stay generic. */
export function errorMessage(messages: HousekeepingMessages, error: unknown) {
  const code = error instanceof ModuleRequestError ? error.code : '';
  return messages[errorKeys[code] ?? 'loadError'];
}

const tag = () => (locale.value === 'id' ? 'id-ID' : 'en-GB');
export function formatTime(value: string) {
  return new Intl.DateTimeFormat(tag(), {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Asia/Jakarta',
  }).format(new Date(value));
}
export function formatDateTime(value: string) {
  return new Intl.DateTimeFormat(tag(), {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Asia/Jakarta',
  }).format(new Date(value));
}
/** Shows an attendant by the part of the email before @, which is how staff know each other. */
export const shortName = (email: string) => email.split('@')[0] || email;

/** A clock that ticks every second while mounted, corrected by the server time offset. */
export function useServerClock(offsetMs: () => number) {
  const now = ref(Date.now() + offsetMs());
  let timer: number | undefined;
  onMounted(() => {
    timer = window.setInterval(() => (now.value = Date.now() + offsetMs()), 1000);
  });
  onBeforeUnmount(() => window.clearInterval(timer));
  return now;
}
