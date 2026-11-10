import type {
  AttendanceRecord,
  CorrectionInput,
  DayQuery,
  DayRow,
  MarkAction,
  Page,
  PeopleQuery,
  Person,
  PersonInput,
  RecapQuery,
  RecapRow,
} from './types';

/** Casual Attendance service contract. The server derives the actor from the session and
 * checks casual-attendance:read, :write and :manage per hotel department on every call.
 * Check-in and check-out times always come from the server clock. */
export interface CasualAttendanceApi {
  listPeople(query: PeopleQuery, signal?: AbortSignal): Promise<Page<Person>>;
  savePerson(
    hotelId: string,
    input: PersonInput,
    existing?: Pick<Person, 'id' | 'version'>,
  ): Promise<void>;
  setArchived(hotelId: string, person: Person, archived: boolean): Promise<void>;
  /** Everyone expected on `day`, with their record for that day when one exists. */
  listDay(query: DayQuery, signal?: AbortSignal): Promise<DayRow[]>;
  /** Returns the record after the change, or null after `reset`. */
  mark(
    hotelId: string,
    personId: string,
    day: string,
    action: MarkAction,
    expectedVersion: number | null,
    note?: string,
  ): Promise<AttendanceRecord | null>;
  /** Manager correction of recorded times; the server keeps the previous times. */
  correct(
    hotelId: string,
    personId: string,
    day: string,
    input: CorrectionInput,
    expectedVersion: number | null,
  ): Promise<AttendanceRecord>;
  /** Per-person totals; `export` is audited as an export. */
  recap(query: RecapQuery, purpose: 'view' | 'export', signal?: AbortSignal): Promise<RecapRow[]>;
}
