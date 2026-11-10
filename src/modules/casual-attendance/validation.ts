import type { AttendanceRecord, CorrectionInput, PersonInput, Shift } from './types';

export type PersonField = 'name' | 'origin' | 'departmentId' | 'startDate' | 'endDate' | 'notes';
export type CorrectionField = 'checkIn' | 'checkOut' | 'reason';
export type ValidationError =
  'required' | 'tooLong' | 'invalidDate' | 'endBeforeStart' | 'invalidTime' | 'tooLongShift';

/** Hotel time zone. Asia/Jakarta has no daylight saving, so its offset is fixed. */
export const hotelTimeZone = 'Asia/Jakarta';
const hotelOffsetMinutes = 7 * 60;
/** Check-ins later than this many minutes after the shift start count as late. */
export const lateGraceMinutes = 5;
/** Longest stretch a correction may record between check-in and check-out. */
export const maxShiftMinutes = 16 * 60;

/** Shift start as minutes after midnight on the work date. Every shift lasts 8 hours. */
export const shiftStart: Record<Shift, number> = {
  morning: 7 * 60,
  afternoon: 15 * 60,
  night: 23 * 60,
};

const datePattern = /^\d{4}-\d{2}-\d{2}$/;
const clockPattern = /^([01]\d|2[0-3]):([0-5]\d)$/;

export function isDate(value: string) {
  if (!datePattern.test(value)) return false;
  const date = new Date(value + 'T00:00:00Z');
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
/** Today's date at the hotel, YYYY-MM-DD. */
export function hotelToday(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: hotelTimeZone }).format(now);
}
export function addDays(day: string, days: number) {
  const date = new Date(day + 'T00:00:00Z');
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}
export function daysBetween(from: string, to: string) {
  return Math.round((Date.parse(to + 'T00:00:00Z') - Date.parse(from + 'T00:00:00Z')) / 86400000);
}
/** "HH:MM" as minutes after midnight, or undefined when it is not a valid time. */
export function parseClock(value: string) {
  const match = clockPattern.exec(value.trim());
  return match ? Number(match[1]) * 60 + Number(match[2]) : undefined;
}
/** The instant of a hotel wall-clock time, in minutes after midnight of `day`. */
export function hotelInstant(day: string, minutes: number) {
  const [year, month, date] = day.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, date, 0, minutes - hotelOffsetMinutes)).toISOString();
}
/** Hotel wall-clock time "HH:MM" of an instant. */
export function hotelClock(value: string) {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: hotelTimeZone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(new Date(value));
}

/** Minutes late against the shift start, or 0 within the grace period. Mirrors the server. */
export function lateMinutes(record: Pick<AttendanceRecord, 'workDate' | 'shift' | 'checkIn'>) {
  if (!record.checkIn) return 0;
  const start = Date.parse(hotelInstant(record.workDate, shiftStart[record.shift]));
  const late = Math.floor((Date.parse(record.checkIn) - start) / 60000);
  return late > lateGraceMinutes ? late : 0;
}
export function workedMinutes(
  record: Pick<AttendanceRecord, 'checkIn' | 'checkOut'>,
  now = new Date(),
) {
  if (!record.checkIn) return 0;
  const end = record.checkOut ? Date.parse(record.checkOut) : now.getTime();
  return Math.max(0, Math.floor((end - Date.parse(record.checkIn)) / 60000));
}

/** What a day row shows, derived from its record. */
export type DayState = 'pending' | 'onDuty' | 'done' | 'leave' | 'sick' | 'absent';
export function dayState(record: AttendanceRecord | null): DayState {
  if (!record) return 'pending';
  if (record.status !== 'present') return record.status;
  return record.checkOut ? 'done' : 'onDuty';
}

/** Check-in is open for today, and for yesterday so a night shift can still be recorded. */
export function canCheckInOn(day: string, today = hotelToday()) {
  return day === today || day === addDays(today, -1);
}

export function validatePerson(input: PersonInput) {
  const errors: Partial<Record<PersonField, ValidationError>> = {};
  if (!input.name.trim()) errors.name = 'required';
  else if (input.name.trim().length > 80) errors.name = 'tooLong';
  if (input.origin.trim().length > 100) errors.origin = 'tooLong';
  if (!input.departmentId) errors.departmentId = 'required';
  if (!input.startDate) errors.startDate = 'required';
  else if (!isDate(input.startDate)) errors.startDate = 'invalidDate';
  if (input.endDate) {
    if (!isDate(input.endDate)) errors.endDate = 'invalidDate';
    else if (isDate(input.startDate) && input.endDate < input.startDate)
      errors.endDate = 'endBeforeStart';
  }
  if (input.notes.trim().length > 500) errors.notes = 'tooLong';
  return errors;
}

/** Instants for a correction; a check-out earlier than the check-in is on the next day. */
export function correctionTimes(day: string, input: Pick<CorrectionInput, 'checkIn' | 'checkOut'>) {
  const start = parseClock(input.checkIn);
  if (start === undefined) return undefined;
  const checkIn = hotelInstant(day, start);
  if (!input.checkOut.trim()) return { checkIn, checkOut: null };
  const end = parseClock(input.checkOut);
  if (end === undefined) return undefined;
  return { checkIn, checkOut: hotelInstant(day, end <= start ? end + 24 * 60 : end) };
}

export function validateCorrection(input: CorrectionInput) {
  const errors: Partial<Record<CorrectionField, ValidationError>> = {};
  const start = parseClock(input.checkIn);
  if (!input.checkIn.trim()) errors.checkIn = 'required';
  else if (start === undefined) errors.checkIn = 'invalidTime';
  if (input.checkOut.trim()) {
    const end = parseClock(input.checkOut);
    if (end === undefined) errors.checkOut = 'invalidTime';
    else if (start !== undefined && (end <= start ? end + 1440 : end) - start > maxShiftMinutes)
      errors.checkOut = 'tooLongShift';
  }
  if (!input.reason.trim()) errors.reason = 'required';
  else if (input.reason.trim().length > 200) errors.reason = 'tooLong';
  return errors;
}
