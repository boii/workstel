import { computed } from 'vue';
import { locale } from '../../../i18n';
import { ModuleRequestError } from '../../../core/module-rpc';
import en from '../locales/en';
import id from '../locales/id';
import type { ConfirmationMode, PersonType, Shift, Verification } from '../types';
import type { DayState } from '../validation';
import { hotelTimeZone } from '../validation';

export type Messages = Record<keyof typeof en, string>;
export function useCasualAttendanceMessages() {
  return computed<Messages>(() => (locale.value === 'id' ? id : en));
}

export const typeKeys: Record<PersonType, keyof typeof en> = {
  casual: 'typeCasual',
  trainee: 'typeTrainee',
  daily: 'typeDaily',
};
export const shiftKeys: Record<Shift, keyof typeof en> = {
  morning: 'shiftMorning',
  afternoon: 'shiftAfternoon',
  night: 'shiftNight',
};
export const shiftShortKeys: Record<Shift, keyof typeof en> = {
  morning: 'shiftShortMorning',
  afternoon: 'shiftShortAfternoon',
  night: 'shiftShortNight',
};
export const stateKeys: Record<DayState, keyof typeof en> = {
  pending: 'statePending',
  onDuty: 'stateOnDuty',
  done: 'stateDone',
  leave: 'stateLeave',
  sick: 'stateSick',
  absent: 'stateAbsent',
};
/** Day states mapped to the shared status colours (src/styles.css). */
export const stateTones: Record<DayState, 'neutral' | 'info' | 'success' | 'danger'> = {
  pending: 'neutral',
  onDuty: 'info',
  done: 'success',
  leave: 'neutral',
  sick: 'neutral',
  absent: 'danger',
};

const errorKeys: Record<string, keyof typeof en> = {
  ACCESS_DENIED: 'accessDenied',
  VERSION_CONFLICT: 'versionConflict',
  ALREADY_MARKED: 'alreadyMarked',
  NOT_SCHEDULED: 'notScheduled',
  DAY_CLOSED: 'dayClosed',
  NOT_CHECKED_IN: 'notCheckedIn',
  RECORD_CLOSED: 'recordClosed',
  DEPARTMENT_LOCKED: 'departmentLocked',
  RANGE_TOO_LONG: 'rangeTooLong',
  NOT_LINKED: 'notLinked',
  ALREADY_LINKED: 'alreadyLinked',
  CODE_INVALID: 'codeInvalid',
  TOO_MANY_ATTEMPTS: 'tooManyAttempts',
  SELF_DISABLED: 'selfDisabled',
  NOT_REVIEWABLE: 'notReviewable',
};
export const verificationKeys: Record<Verification, keyof typeof en> = {
  verified: 'verifyVerified',
  needs_review: 'verifyNeedsReview',
  unverified: 'verifyUnverified',
  rejected: 'verifyRejected',
};
export const verificationTones: Record<Verification, 'success' | 'warning' | 'danger'> = {
  verified: 'success',
  needs_review: 'warning',
  unverified: 'warning',
  rejected: 'danger',
};
export const confirmationKeys: Record<ConfirmationMode, keyof typeof en> = {
  off: 'confirmationOff',
  on_fail: 'confirmationOnFail',
  always: 'confirmationAlways',
};
export const confirmationHintKeys: Record<ConfirmationMode, keyof typeof en> = {
  off: 'confirmationOffHint',
  on_fail: 'confirmationOnFailHint',
  always: 'confirmationAlwaysHint',
};
/** A self check-in day a supervisor can still approve or reject. */
export const isReviewable = (verification: Verification | null) =>
  verification === 'needs_review' || verification === 'unverified';
/** Map a server error code to safe, localized copy; unknown failures stay generic. */
export function errorMessage(messages: Messages, error: unknown) {
  const code = error instanceof ModuleRequestError ? error.code : '';
  return messages[errorKeys[code] ?? 'loadError'];
}
export const isConflict = (error: unknown) =>
  error instanceof ModuleRequestError && error.code === 'VERSION_CONFLICT';

const tag = () => (locale.value === 'id' ? 'id-ID' : 'en-GB');
/** "07:18" in the hotel's time zone. */
export function formatClock(value: string) {
  return new Intl.DateTimeFormat(tag(), {
    timeZone: hotelTimeZone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(new Date(value));
}
/** A hotel calendar date, such as "10 Nov 2026". */
export function formatDate(day: string) {
  return new Intl.DateTimeFormat(tag(), { dateStyle: 'medium', timeZone: 'UTC' }).format(
    new Date(day + 'T00:00:00Z'),
  );
}
/** Worked time, such as "8 h 03 min". */
export function formatDuration(minutes: number, messages: Messages) {
  const hours = Math.floor(minutes / 60);
  const rest = String(minutes % 60).padStart(2, '0');
  return hours
    ? `${hours} ${messages.hoursShort} ${rest} ${messages.minutesShort}`
    : `${minutes} ${messages.minutesShort}`;
}
