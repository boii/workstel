import type { CleaningTask, RoomInput, RoomStatus, TaskType } from './types';

export type ValidationError = 'required' | 'tooLong' | 'invalidRoomNumber' | 'invalidFloor';

/** Same rules as the server. */
export const isRoomNumber = (value: string) => /^[A-Za-z0-9-]{1,10}$/.test(value.trim());
export const isFloor = (value: string) => /^[A-Za-z0-9 -]{0,10}$/.test(value.trim());

export function validateRoom(input: RoomInput) {
  const errors: Partial<Record<keyof RoomInput, ValidationError>> = {};
  if (!input.roomNumber.trim()) errors.roomNumber = 'required';
  else if (!isRoomNumber(input.roomNumber)) errors.roomNumber = 'invalidRoomNumber';
  if (!isFloor(input.floor)) errors.floor = 'invalidFloor';
  if (input.roomType.trim().length > 50) errors.roomType = 'tooLong';
  return errors;
}

/** Parses pasted lines of "number, floor, type" (tab, comma or semicolon separated). */
export function parseRoomLines(text: string) {
  const rows: RoomInput[] = [];
  const invalid: number[] = [];
  text.split(/\r?\n/).forEach((line, index) => {
    if (!line.trim()) return;
    const [roomNumber = '', floor = '', ...rest] = line.split(/\t|;|,/).map((part) => part.trim());
    const row = { roomNumber, floor, roomType: rest.join(' ').trim() };
    if (Object.keys(validateRoom(row)).length) invalid.push(index + 1);
    else rows.push({ ...row, roomNumber: roomNumber.toUpperCase() });
  });
  return { rows, invalid };
}

/** Which task types can start from a room status, as enforced by the server. */
export function allowedTasks(status: RoomStatus): TaskType[] {
  switch (status) {
    case 'vacant-dirty':
      return ['departure', 'deep-clean'];
    case 'vacant-clean':
    case 'vacant-ready':
      return ['pre-arrival', 'deep-clean'];
    case 'occupied':
      return ['make-up', 'turndown'];
    default:
      return [];
  }
}

/** Working seconds of a task at a moment: elapsed time minus pauses. */
export function elapsedSeconds(task: CleaningTask, nowMs: number) {
  if (task.durationSeconds !== null) return task.durationSeconds;
  const end = task.pausedAt ? Date.parse(task.pausedAt) : nowMs;
  return Math.max(0, Math.floor((end - Date.parse(task.startedAt)) / 1000) - task.pausedSeconds);
}

export function formatDuration(seconds: number) {
  const total = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const rest = total % 60;
  const pad = (value: number) => String(value).padStart(2, '0');
  return hours ? hours + ':' + pad(minutes) + ':' + pad(rest) : minutes + ':' + pad(rest);
}

/** The current calendar day at the hotel (Western Indonesia Time), as the server uses. */
export function hotelToday(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' }).format(now);
}
