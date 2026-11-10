export const personTypes = ['casual', 'trainee', 'daily'] as const;
export type PersonType = (typeof personTypes)[number];
export const shifts = ['morning', 'afternoon', 'night'] as const;
export type Shift = (typeof shifts)[number];
export type PersonStatus = 'active' | 'archived';
/** current: period includes today or is still ahead; ended: the end date has passed. */
export const periodFilters = ['current', 'ended', 'archived', 'all'] as const;
export type PeriodFilter = (typeof periodFilters)[number];

/** A casual, trainee or daily worker. They are records, not Workstel accounts. */
export interface Person {
  id: string;
  hotelId: string;
  departmentId: string;
  departmentName: string;
  name: string;
  type: PersonType;
  /** Agency, school or other source; free text entered by staff. */
  origin: string;
  /** Hotel calendar dates, YYYY-MM-DD. */
  startDate: string;
  endDate: string | null;
  shift: Shift;
  notes: string;
  status: PersonStatus;
  version: number;
  updatedAt: string;
}
export interface PersonInput {
  name: string;
  type: PersonType;
  origin: string;
  departmentId: string;
  startDate: string;
  endDate: string | null;
  shift: Shift;
  notes: string;
}
export interface PeopleQuery {
  hotelId: string;
  departmentId: string | null;
  type: PersonType | null;
  period: PeriodFilter;
  search: string;
  after: string | null;
}

export const attendanceStatuses = ['present', 'leave', 'sick', 'absent'] as const;
export type AttendanceStatus = (typeof attendanceStatuses)[number];
/** One person's attendance on one hotel calendar day. */
export interface AttendanceRecord {
  id: string;
  personId: string;
  workDate: string;
  status: AttendanceStatus;
  /** The shift that applied that day; it sets the expected start. */
  shift: Shift;
  checkIn: string | null;
  checkOut: string | null;
  note: string;
  /** A manager changed the recorded times; the original stays in the history. */
  corrected: boolean;
  version: number;
}
export interface DayRow {
  person: Pick<
    Person,
    'id' | 'name' | 'type' | 'origin' | 'departmentId' | 'departmentName' | 'shift'
  >;
  record: AttendanceRecord | null;
}
export interface DayQuery {
  hotelId: string;
  departmentId: string | null;
  day: string;
}
export const markActions = [
  'check_in',
  'check_out',
  'leave',
  'sick',
  'absent',
  'reopen',
  'reset',
] as const;
export type MarkAction = (typeof markActions)[number];
export interface CorrectionInput {
  /** HH:MM on the work date; a check-out before the check-in falls on the next day. */
  checkIn: string;
  checkOut: string;
  reason: string;
}
export interface RecapRow {
  personId: string;
  name: string;
  type: PersonType;
  origin: string;
  departmentName: string;
  present: number;
  late: number;
  leave: number;
  sick: number;
  absent: number;
  /** Worked minutes from completed check-in/check-out pairs. */
  minutes: number;
}
export interface RecapQuery {
  hotelId: string;
  departmentId: string | null;
  type: PersonType | null;
  from: string;
  to: string;
}
export interface Page<T> {
  data: T[];
  nextCursor: string | null;
}
