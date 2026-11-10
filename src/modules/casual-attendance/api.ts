import type {
  AttendanceRecord,
  CorrectionInput,
  DayQuery,
  DepartmentSettings,
  LinkCode,
  DayRow,
  MarkAction,
  Page,
  PeopleQuery,
  Person,
  PersonInput,
  RecapQuery,
  RecapRow,
  SelfAction,
  SelfStatus,
  SettingsInput,
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
  /** Manager: a one-time code that links an account to the person; replaces an unused one. */
  createLinkCode(hotelId: string, personId: string): Promise<LinkCode>;
  /** Manager: end the person's link; the account loses self check-in at once. */
  unlink(hotelId: string, personId: string): Promise<void>;
  /** Self check-in settings for each readable department. */
  listSettings(
    hotelId: string,
    departmentId: string | null,
    signal?: AbortSignal,
  ): Promise<DepartmentSettings[]>;
  /** Manager: save a department's settings; `expectedVersion` is 0 before the first save. */
  saveSettings(
    hotelId: string,
    departmentId: string,
    input: SettingsInput,
    expectedVersion: number,
  ): Promise<void>;
  /** The signed-in account's link and attendance. Needs no module grant. */
  selfStatus(signal?: AbortSignal): Promise<SelfStatus>;
  /** Link the signed-in account with a manager's code. */
  redeemLinkCode(code: string): Promise<SelfStatus>;
  /** Check the linked person in or out with the server clock. */
  selfMark(action: SelfAction): Promise<AttendanceRecord>;
}
