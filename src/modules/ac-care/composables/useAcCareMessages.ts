import { computed } from 'vue';
import { locale } from '../../../i18n';
import { ModuleRequestError } from '../../../core/module-rpc';
import en from '../locales/en';
import id from '../locales/id';
import type {
  AttentionReason,
  ChecklistItem,
  ComplaintKind,
  Condition,
  Refrigerant,
  ServiceType,
  UnitType,
} from '../types';

export type AcCareMessages = Record<keyof typeof en, string>;
type Key = keyof typeof en;

export function useAcCareMessages() {
  return computed<AcCareMessages>(() => (locale.value === 'id' ? id : en));
}

export const serviceKeys: Record<ServiceType, Key> = {
  filter: 'serviceFilter',
  routine: 'serviceRoutine',
  major: 'serviceMajor',
  annual: 'serviceAnnual',
};
export const serviceIcons: Record<ServiceType, string> = {
  filter: 'mdi-air-filter',
  routine: 'mdi-spray-bottle',
  major: 'mdi-wrench-outline',
  annual: 'mdi-clipboard-check-outline',
};
export const unitTypeKeys: Record<UnitType, Key> = {
  split: 'typeSplit',
  cassette: 'typeCassette',
  standing: 'typeStanding',
  ceiling: 'typeCeiling',
  vrf: 'typeVrf',
  fcu: 'typeFcu',
  ahu: 'typeAhu',
  other: 'typeOther',
};
export const refrigerantKeys: Record<Refrigerant, Key> = {
  r32: 'refrigerantR32',
  r410a: 'refrigerantR410a',
  r22: 'refrigerantR22',
  other: 'refrigerantOther',
};
export const conditionKeys: Record<Condition, Key> = {
  normal: 'conditionNormal',
  attention: 'conditionAttention',
  broken: 'conditionBroken',
};
/** Shared status colours (list-row-chip plus .ac-chip--tone). */
export const conditionTones: Record<Condition, string> = {
  normal: 'success',
  attention: 'warning',
  broken: 'danger',
};
export const itemKeys: Record<ChecklistItem, Key> = {
  filter: 'itemFilter',
  evaporator: 'itemEvaporator',
  drain: 'itemDrain',
  noise: 'itemNoise',
  condenser: 'itemCondenser',
  leak: 'itemLeak',
  electrical: 'itemElectrical',
  mounting: 'itemMounting',
  insulation: 'itemInsulation',
};
export const complaintKeys: Record<ComplaintKind, Key> = {
  'not-cold': 'complaintNotCold',
  leak: 'complaintLeak',
  noise: 'complaintNoise',
  smell: 'complaintSmell',
  'not-on': 'complaintNotOn',
  other: 'complaintOther',
};
export const reasonKeys: Record<AttentionReason, Key> = {
  'item-issue': 'reasonItem',
  'temperature-drop': 'reasonDrop',
  pressure: 'reasonPressure',
  current: 'reasonCurrent',
  'repeat-refill': 'reasonRefill',
};

const errorKeys: Record<string, Key> = {
  ACCESS_DENIED: 'accessDenied',
  VERSION_CONFLICT: 'versionConflict',
  DUPLICATE_CODE: 'duplicateCode',
  UNIT_ARCHIVED: 'unitArchived',
  CLAIMED_BY_OTHER: 'claimedByOther',
  NOT_SCHEDULED: 'notScheduled',
  ASSIGNEE_INVALID: 'assigneeInvalid',
  READINGS_REQUIRED: 'readingsRequired',
  NOTES_REQUIRED: 'notesRequired',
};
/** Map a server error code to safe, localized copy; unknown failures stay generic. */
export function errorMessage(messages: AcCareMessages, error: unknown) {
  const code = error instanceof ModuleRequestError ? error.code : '';
  return messages[errorKeys[code] ?? 'loadError'];
}

/** Fills {name} placeholders. */
export function fill(template: string, values: Record<string, string | number>) {
  return template.replace(/\{(\w+)\}/g, (match, key: string) =>
    key in values ? String(values[key]) : match,
  );
}
/** The part of an email before @, as other modules show staff without a profile contract. */
export const shortName = (email: string) => email.split('@')[0] || email;

const tag = () => (locale.value === 'id' ? 'id-ID' : 'en-GB');
/** A hotel calendar day (YYYY-MM-DD). */
export function formatDay(value: string) {
  return new Intl.DateTimeFormat(tag(), { dateStyle: 'medium', timeZone: 'UTC' }).format(
    new Date(value + 'T00:00:00Z'),
  );
}
export function formatDateTime(value: string) {
  return new Intl.DateTimeFormat(tag(), {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Asia/Jakarta',
  }).format(new Date(value));
}
export function formatNumber(value: number) {
  return new Intl.NumberFormat(tag(), { maximumFractionDigits: 1 }).format(value);
}
/** "3 days overdue", "Due today", "Due in 5 days". */
export function dueLabel(messages: AcCareMessages, daysLeft: number) {
  if (daysLeft < -1) return fill(messages.overdueDays, { days: -daysLeft });
  if (daysLeft === -1) return messages.overdueOne;
  if (daysLeft === 0) return messages.dueToday;
  if (daysLeft === 1) return messages.dueTomorrow;
  return fill(messages.dueInDays, { days: daysLeft });
}
