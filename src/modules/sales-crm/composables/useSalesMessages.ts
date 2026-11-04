import { computed } from 'vue';
import { locale } from '../../../i18n';
import { ModuleRequestError } from '../../../core/module-rpc';
import en from '../locales/en';
import id from '../locales/id';
import type { AccountType, ActivityType, Segment, Stage } from '../types';

export type SalesMessages = Record<keyof typeof en, string>;
type Key = keyof typeof en;

export function useSalesMessages() {
  return computed<SalesMessages>(() => (locale.value === 'id' ? id : en));
}

export const stageKeys: Record<Stage, Key> = {
  lead: 'stageLead',
  proposal: 'stageProposal',
  negotiation: 'stageNegotiation',
  won: 'stageWon',
  lost: 'stageLost',
};
export const accountTypeKeys: Record<AccountType, Key> = {
  corporate: 'typeCorporate',
  'travel-agent': 'typeTravelAgent',
  government: 'typeGovernment',
  mice: 'typeMice',
  wedding: 'typeWedding',
  other: 'typeOther',
};
export const segmentKeys: Record<Segment, Key> = {
  corporate: 'segmentCorporate',
  group: 'segmentGroup',
  mice: 'segmentMice',
  wedding: 'segmentWedding',
  'long-stay': 'segmentLongStay',
  other: 'segmentOther',
};
export const activityKeys: Record<ActivityType, Key> = {
  call: 'activityCall',
  email: 'activityEmail',
  visit: 'activityVisit',
  meeting: 'activityMeeting',
  'site-inspection': 'activitySiteInspection',
  note: 'activityNote',
};
export const activityIcons: Record<ActivityType, string> = {
  call: 'mdi-phone-outline',
  email: 'mdi-email-outline',
  visit: 'mdi-briefcase-outline',
  meeting: 'mdi-account-group-outline',
  'site-inspection': 'mdi-map-marker-radius-outline',
  note: 'mdi-note-text-outline',
};
export const accountTypeIcons: Record<AccountType, string> = {
  corporate: 'mdi-office-building-outline',
  'travel-agent': 'mdi-airplane',
  government: 'mdi-bank-outline',
  mice: 'mdi-presentation',
  wedding: 'mdi-ring',
  other: 'mdi-account-outline',
};

const errorKeys: Record<string, Key> = {
  ACCESS_DENIED: 'accessDenied',
  VERSION_CONFLICT: 'versionConflict',
  INVALID_EMAIL: 'invalidEmail',
  INVALID_PHONE: 'invalidPhone',
  LOST_REASON_REQUIRED: 'lostReason',
  ACCOUNT_ARCHIVED: 'accountArchivedError',
  DEAL_CLOSED: 'dealClosedError',
};
/** Map a server error code to safe, localized copy; unknown failures stay generic. */
export function errorMessage(messages: SalesMessages, error: unknown) {
  const code = error instanceof ModuleRequestError ? error.code : '';
  if (code === 'LOST_REASON_REQUIRED') return messages.lostReason + ': ' + messages.required;
  return messages[errorKeys[code] ?? 'loadError'];
}

const tag = () => (locale.value === 'id' ? 'id-ID' : 'en-GB');
export function formatMoney(value: number, compact = false) {
  return new Intl.NumberFormat(tag(), {
    style: 'currency',
    currency: 'IDR',
    maximumFractionDigits: compact ? 1 : 0,
    notation: compact ? 'compact' : 'standard',
  }).format(value);
}
/** Calendar days are formatted without a time zone shift. */
export function formatDay(value: string) {
  return new Intl.DateTimeFormat(tag(), { dateStyle: 'medium', timeZone: 'UTC' }).format(
    new Date(value + 'T00:00:00Z'),
  );
}
export function formatStay(arrival: string | null, departure: string | null) {
  if (!arrival) return '';
  return departure && departure !== arrival
    ? formatDay(arrival) + ' – ' + formatDay(departure)
    : formatDay(arrival);
}
