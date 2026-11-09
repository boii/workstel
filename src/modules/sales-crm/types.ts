export const accountTypes = [
  'corporate',
  'travel-agent',
  'government',
  'mice',
  'wedding',
  'other',
] as const;
export type AccountType = (typeof accountTypes)[number];
export const segments = ['corporate', 'group', 'mice', 'wedding', 'long-stay', 'other'] as const;
export type Segment = (typeof segments)[number];
export const openStages = ['lead', 'proposal', 'negotiation'] as const;
export type OpenStage = (typeof openStages)[number];
export const stages = [...openStages, 'won', 'lost'] as const;
export type Stage = (typeof stages)[number];
export const activityTypes = [
  'call',
  'email',
  'visit',
  'meeting',
  'site-inspection',
  'note',
] as const;
export type ActivityType = (typeof activityTypes)[number];
/** How long after the activity it was logged; the server decides it from its own clock. */
export const entryTimings = ['on-time', 'late', 'backdated'] as const;
export type EntryTiming = (typeof entryTimings)[number];
export type RecordStatus = 'active' | 'archived';
export type StageFilter = 'open' | 'all' | Stage;
export type FollowUpFilter = 'any' | 'overdue' | 'week';

/** A company, agent or other buyer with one main contact (PIC). */
export interface SalesAccount {
  id: string;
  hotelId: string;
  departmentId: string;
  departmentName: string;
  name: string;
  type: AccountType;
  contactName: string;
  contactPhone: string;
  contactEmail: string;
  notes: string;
  status: RecordStatus;
  version: number;
  updatedAt: string;
  openDeals: number;
  openValue: number;
  nextFollowUp: string | null;
  lastActivityOn: string | null;
}
export interface AccountInput {
  name: string;
  type: AccountType;
  contactName: string;
  contactPhone: string;
  contactEmail: string;
  notes: string;
  departmentId: string;
}
/** A sales opportunity on an account. Dates are calendar days (YYYY-MM-DD). */
export interface Deal {
  id: string;
  hotelId: string;
  departmentId: string;
  departmentName: string;
  accountId: string;
  accountName: string;
  title: string;
  segment: Segment;
  stage: Stage;
  value: number;
  roomNights: number | null;
  arrivalDate: string | null;
  departureDate: string | null;
  nextFollowUp: string | null;
  lostReason: string;
  notes: string;
  closedAt: string | null;
  version: number;
  updatedAt: string;
}
export interface DealInput {
  accountId: string;
  title: string;
  segment: Segment;
  stage: Stage;
  value: number | null;
  roomNights: number | null;
  arrivalDate: string | null;
  departureDate: string | null;
  nextFollowUp: string | null;
  lostReason: string;
  notes: string;
}
export interface Activity {
  id: string;
  accountId: string;
  dealId: string | null;
  dealTitle: string;
  type: ActivityType;
  occurredOn: string;
  summary: string;
  /** Server time of logging, never sent by the client. */
  createdAt: string;
  createdByEmail: string;
  /** Hotel calendar day of createdAt (YYYY-MM-DD). */
  recordedOn: string;
  /** Calendar days between occurredOn and recordedOn, never negative. */
  entryDelayDays: number;
  entryTiming: EntryTiming;
}
export interface ActivityInput {
  type: ActivityType;
  occurredOn: string;
  summary: string;
  dealId: string | null;
  nextFollowUp: string | null;
}
export interface StageTotal {
  count: number;
  value: number;
}
export interface SalesSummary {
  openCount: number;
  openValue: number;
  overdue: number;
  dueWeek: number;
  wonMonthCount: number;
  wonMonthValue: number;
  stages: Record<OpenStage, StageTotal>;
  today: string;
}
export interface Page<T> {
  data: T[];
  nextCursor: string | null;
}
export interface AccountQuery {
  hotelId: string;
  departmentId: string | null;
  status: RecordStatus | 'all';
  type: AccountType | null;
  search: string;
  after: string | null;
}
export interface DealQuery {
  hotelId: string;
  departmentId: string | null;
  stage: StageFilter;
  accountId: string | null;
  followUp: FollowUpFilter;
  search: string;
  after: string | null;
}
