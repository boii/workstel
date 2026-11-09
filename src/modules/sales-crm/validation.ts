import {
  accountTypes,
  activityOutcomes,
  activityTypes,
  outcomeRequiredTypes,
  segments,
  stages,
} from './types';
import type { AccountInput, ActivityInput, DealInput, EntryTiming } from './types';

export type ValidationError =
  | 'required'
  | 'tooLong'
  | 'invalidEmail'
  | 'invalidPhone'
  | 'invalidAmount'
  | 'invalidDate'
  | 'departureBeforeArrival'
  | 'futureDate';
type Errors<T> = Partial<Record<keyof T, ValidationError>>;

/** Same rule as the server: a real calendar day between 2000 and 2100. */
export function isCalendarDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(value + 'T00:00:00Z');
  return (
    !Number.isNaN(date.getTime()) &&
    date.toISOString().slice(0, 10) === value &&
    value >= '2000-01-01' &&
    value <= '2100-12-31'
  );
}
export const isEmail = (value: string) =>
  value.length <= 254 && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value);
export const isPhone = (value: string) => /^[0-9+() .-]{4,40}$/.test(value);

/** The current calendar day at the hotel (Western Indonesia Time), as the server uses. */
export function hotelToday(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' }).format(now);
}
export function addDays(day: string, days: number) {
  return new Date(Date.parse(day + 'T00:00:00Z') + days * 86400000).toISOString().slice(0, 10);
}

export function validateAccount(input: AccountInput) {
  const errors: Errors<AccountInput> = {};
  if (!input.name.trim()) errors.name = 'required';
  else if (input.name.trim().length > 150) errors.name = 'tooLong';
  if (!accountTypes.includes(input.type)) errors.type = 'required';
  if (input.contactName.trim().length > 100) errors.contactName = 'tooLong';
  if (input.contactPhone.trim() && !isPhone(input.contactPhone.trim()))
    errors.contactPhone = 'invalidPhone';
  if (input.contactEmail.trim() && !isEmail(input.contactEmail.trim()))
    errors.contactEmail = 'invalidEmail';
  if (input.notes.trim().length > 1000) errors.notes = 'tooLong';
  if (!input.departmentId) errors.departmentId = 'required';
  return errors;
}

export function validateDeal(input: DealInput) {
  const errors: Errors<DealInput> = {};
  if (!input.accountId) errors.accountId = 'required';
  if (!input.title.trim()) errors.title = 'required';
  else if (input.title.trim().length > 150) errors.title = 'tooLong';
  if (!segments.includes(input.segment)) errors.segment = 'required';
  if (!stages.includes(input.stage)) errors.stage = 'required';
  if (
    input.value === null ||
    !Number.isInteger(input.value) ||
    input.value < 0 ||
    input.value > 1e12
  )
    errors.value = 'invalidAmount';
  if (
    input.roomNights !== null &&
    (!Number.isInteger(input.roomNights) || input.roomNights < 1 || input.roomNights > 100000)
  )
    errors.roomNights = 'invalidAmount';
  for (const key of ['arrivalDate', 'departureDate', 'nextFollowUp'] as const) {
    const value = input[key];
    if (value !== null && !isCalendarDate(value)) errors[key] = 'invalidDate';
  }
  if (input.departureDate && !errors.departureDate && !errors.arrivalDate) {
    if (!input.arrivalDate) errors.arrivalDate = 'required';
    else if (input.departureDate < input.arrivalDate)
      errors.departureDate = 'departureBeforeArrival';
  }
  if (input.stage === 'lost' && !input.lostReason.trim()) errors.lostReason = 'required';
  else if (input.lostReason.trim().length > 300) errors.lostReason = 'tooLong';
  if (input.notes.trim().length > 1000) errors.notes = 'tooLong';
  return errors;
}

export function validateActivity(input: ActivityInput, today = hotelToday()) {
  const errors: Errors<ActivityInput> = {};
  if (!activityTypes.includes(input.type)) errors.type = 'required';
  if (!isCalendarDate(input.occurredOn)) errors.occurredOn = 'invalidDate';
  else if (input.occurredOn > today) errors.occurredOn = 'futureDate';
  if (!input.summary.trim()) errors.summary = 'required';
  else if (input.summary.trim().length > 1000) errors.summary = 'tooLong';
  if (input.nextFollowUp !== null && !isCalendarDate(input.nextFollowUp))
    errors.nextFollowUp = 'invalidDate';
  if (
    input.outcome === null
      ? outcomeRequiredTypes.includes(input.type)
      : !activityOutcomes.includes(input.outcome)
  )
    errors.outcome = 'required';
  if (input.metWith.trim().length > 100) errors.metWith = 'tooLong';
  if (input.reference.trim().length > 100) errors.reference = 'tooLong';
  return errors;
}

/**
 * Entry timing as the server computes it (migration 202611090001): 0 days on time,
 * 1-2 days late, 3 or more backdated. Used by the demo API and the form hint only;
 * live activity rows carry the server's own value.
 */
export function entryDelayDays(occurredOn: string, recordedOn: string) {
  const days = Math.round(
    (Date.parse(recordedOn + 'T00:00:00Z') - Date.parse(occurredOn + 'T00:00:00Z')) / 86_400_000,
  );
  return Math.max(days, 0);
}
export function entryTiming(delayDays: number): EntryTiming {
  if (delayDays <= 0) return 'on-time';
  return delayDays <= 2 ? 'late' : 'backdated';
}

export type FollowUpState = 'overdue' | 'today' | 'soon' | 'later' | 'none';
/** How urgent a follow-up day is compared with the hotel's current day. */
export function followUpState(day: string | null, today: string): FollowUpState {
  if (!day) return 'none';
  if (day < today) return 'overdue';
  if (day === today) return 'today';
  return day <= addDays(today, 6) ? 'soon' : 'later';
}
