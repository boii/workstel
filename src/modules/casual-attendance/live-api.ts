import { ModuleRequestError, moduleRpc, parseCursor, uuidPattern } from '../../core/module-rpc';
import type { CasualAttendanceApi } from './api';
import {
  attendanceStatuses,
  confirmationModes,
  personTypes,
  recordSources,
  shifts,
  verifications,
} from './types';
import type {
  AttendanceRecord,
  DayRow,
  DepartmentSettings,
  LinkCode,
  Person,
  RecapRow,
  SelfPerson,
  SelfStatus,
} from './types';
import { isDate } from './validation';

type Rpc = typeof moduleRpc;
type Raw = Record<string, unknown>;
const invalid = () => new ModuleRequestError('INVALID_RESPONSE');
const isText = (value: unknown): value is string => typeof value === 'string';
const isTime = (value: unknown): value is string =>
  isText(value) && !Number.isNaN(Date.parse(value));
const isDay = (value: unknown): value is string => isText(value) && isDate(value);
const isCount = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0;
const isObject = (value: unknown): value is Raw =>
  !!value && typeof value === 'object' && !Array.isArray(value);

export function parsePeople(data: unknown, hotelId: string): Person[] {
  if (!Array.isArray(data) || data.length > 100) throw invalid();
  return data.map((raw: unknown) => {
    if (
      !isObject(raw) ||
      !['id', 'hotel_id', 'department_id', 'department_name', 'name', 'origin', 'notes'].every(
        (key) => isText(raw[key]),
      ) ||
      raw.hotel_id !== hotelId ||
      !uuidPattern.test(String(raw.id)) ||
      !personTypes.includes(raw.person_type as never) ||
      !shifts.includes(raw.shift as never) ||
      !isDay(raw.start_date) ||
      !(raw.end_date === null || isDay(raw.end_date)) ||
      !['active', 'archived'].includes(String(raw.status)) ||
      !Number.isInteger(raw.version) ||
      !isTime(raw.updated_at) ||
      !(raw.linked === undefined || typeof raw.linked === 'boolean')
    )
      throw invalid();
    return {
      id: String(raw.id),
      hotelId,
      departmentId: String(raw.department_id),
      departmentName: String(raw.department_name),
      name: String(raw.name),
      type: raw.person_type as Person['type'],
      origin: String(raw.origin),
      startDate: raw.start_date,
      endDate: (raw.end_date as string | null) ?? null,
      shift: raw.shift as Person['shift'],
      notes: String(raw.notes),
      status: raw.status as Person['status'],
      version: Number(raw.version),
      updatedAt: raw.updated_at,
      linked: raw.linked === true,
    };
  });
}

export function parseRecord(raw: unknown, personId: string): AttendanceRecord {
  if (
    !isObject(raw) ||
    !isText(raw.id) ||
    !uuidPattern.test(raw.id) ||
    raw.person_id !== personId ||
    !isDay(raw.work_date) ||
    !attendanceStatuses.includes(raw.status as never) ||
    !shifts.includes(raw.shift as never) ||
    !(raw.check_in === null || isTime(raw.check_in)) ||
    !(raw.check_out === null || isTime(raw.check_out)) ||
    (raw.check_out !== null && raw.check_in === null) ||
    !isText(raw.note) ||
    typeof raw.corrected !== 'boolean' ||
    !Number.isInteger(raw.version) ||
    // Servers before the self check-in migration omit these three fields.
    !(raw.source === undefined || recordSources.includes(raw.source as never)) ||
    !(
      raw.verification === undefined ||
      raw.verification === null ||
      verifications.includes(raw.verification as never)
    ) ||
    !(raw.review_note === undefined || isText(raw.review_note))
  )
    throw invalid();
  return {
    id: raw.id,
    personId,
    workDate: raw.work_date,
    status: raw.status as AttendanceRecord['status'],
    shift: raw.shift as AttendanceRecord['shift'],
    checkIn: (raw.check_in as string | null) ?? null,
    checkOut: (raw.check_out as string | null) ?? null,
    note: raw.note,
    corrected: raw.corrected,
    version: Number(raw.version),
    source: (raw.source as AttendanceRecord['source'] | undefined) ?? 'supervisor',
    verification: (raw.verification as AttendanceRecord['verification'] | undefined) ?? null,
    reviewNote: (raw.review_note as string | undefined) ?? '',
  };
}

export function parseSettings(data: unknown): DepartmentSettings[] {
  if (!Array.isArray(data) || data.length > 500) throw invalid();
  return data.map((raw: unknown) => {
    if (
      !isObject(raw) ||
      !isText(raw.department_id) ||
      !uuidPattern.test(raw.department_id) ||
      !isText(raw.department_name) ||
      typeof raw.self_enabled !== 'boolean' ||
      !confirmationModes.includes(raw.confirmation as never) ||
      !isCount(raw.version)
    )
      throw invalid();
    return {
      departmentId: raw.department_id,
      departmentName: raw.department_name,
      selfEnabled: raw.self_enabled,
      confirmation: raw.confirmation as DepartmentSettings['confirmation'],
      version: Number(raw.version),
    };
  });
}

export function parseLinkCode(data: unknown): LinkCode {
  if (!isObject(data) || !isText(data.code) || !/^[A-HJKMNP-Z2-9]{6}$/.test(data.code))
    throw invalid();
  if (!isTime(data.expires_at)) throw invalid();
  return { code: data.code, expiresAt: data.expires_at };
}

export function parseSelfStatus(data: unknown): SelfStatus {
  if (!isObject(data) || typeof data.linked !== 'boolean') throw invalid();
  if (!data.linked) return { linked: false };
  const person = data.person;
  if (
    !isObject(person) ||
    !isText(person.id) ||
    !uuidPattern.test(person.id) ||
    !isText(person.hotel_id) ||
    !uuidPattern.test(person.hotel_id) ||
    !isText(person.name) ||
    !isText(person.department_name) ||
    !shifts.includes(person.shift as never) ||
    typeof person.active !== 'boolean' ||
    !isDay(data.work_date) ||
    typeof data.scheduled !== 'boolean' ||
    typeof data.self_enabled !== 'boolean' ||
    !Array.isArray(data.history) ||
    data.history.length > 14
  )
    throw invalid();
  const personId = person.id;
  return {
    linked: true,
    person: {
      id: personId,
      hotelId: person.hotel_id,
      name: person.name,
      departmentName: person.department_name,
      shift: person.shift as SelfPerson['shift'],
      active: person.active,
    },
    workDate: data.work_date,
    scheduled: data.scheduled,
    selfEnabled: data.self_enabled,
    record: data.record === null ? null : parseRecord(data.record, personId),
    history: data.history.map((raw: unknown) => parseRecord(raw, personId)),
  };
}

export function parseDay(data: unknown): DayRow[] {
  if (!Array.isArray(data) || data.length > 500) throw invalid();
  return data.map((raw: unknown) => {
    if (
      !isObject(raw) ||
      !isText(raw.id) ||
      !uuidPattern.test(raw.id) ||
      !['department_id', 'department_name', 'name', 'origin'].every((key) => isText(raw[key])) ||
      !personTypes.includes(raw.person_type as never) ||
      !shifts.includes(raw.shift as never)
    )
      throw invalid();
    return {
      person: {
        id: raw.id,
        name: String(raw.name),
        type: raw.person_type as DayRow['person']['type'],
        origin: String(raw.origin),
        departmentId: String(raw.department_id),
        departmentName: String(raw.department_name),
        shift: raw.shift as DayRow['person']['shift'],
      },
      record: raw.record === null ? null : parseRecord(raw.record, raw.id),
    };
  });
}

export function parseRecap(data: unknown): RecapRow[] {
  if (!Array.isArray(data) || data.length > 500) throw invalid();
  return data.map((raw: unknown) => {
    if (
      !isObject(raw) ||
      !isText(raw.person_id) ||
      !uuidPattern.test(raw.person_id) ||
      !['name', 'origin', 'department_name'].every((key) => isText(raw[key])) ||
      !personTypes.includes(raw.person_type as never) ||
      !['present', 'late', 'leave', 'sick', 'absent', 'minutes'].every((key) =>
        isCount(raw[key]),
      ) ||
      !['needs_review', 'rejected'].every((key) => raw[key] === undefined || isCount(raw[key]))
    )
      throw invalid();
    return {
      personId: raw.person_id,
      name: String(raw.name),
      type: raw.person_type as RecapRow['type'],
      origin: String(raw.origin),
      departmentName: String(raw.department_name),
      present: Number(raw.present),
      late: Number(raw.late),
      leave: Number(raw.leave),
      sick: Number(raw.sick),
      absent: Number(raw.absent),
      needsReview: Number(raw.needs_review ?? 0),
      rejected: Number(raw.rejected ?? 0),
      minutes: Number(raw.minutes),
    };
  });
}

export function createLiveCasualAttendanceApi(rpc: Rpc = moduleRpc): CasualAttendanceApi {
  return {
    async listPeople(query, signal) {
      const result = await rpc(
        'casual_attendance_list_people',
        {
          p_hotel_id: query.hotelId,
          p_department_id: query.departmentId,
          p_type: query.type,
          p_period: query.period,
          p_search: query.search.trim().slice(0, 100),
          p_after: query.after,
          p_limit: 50,
        },
        signal,
      );
      return {
        data: parsePeople(result.data, query.hotelId),
        nextCursor: parseCursor(result.meta),
      };
    },
    async savePerson(hotelId, input, existing) {
      await rpc('casual_attendance_save_person', {
        p_hotel_id: hotelId,
        p_department_id: input.departmentId,
        p_input: {
          name: input.name.trim(),
          type: input.type,
          origin: input.origin.trim(),
          startDate: input.startDate,
          endDate: input.endDate || null,
          shift: input.shift,
          notes: input.notes.trim(),
        },
        p_person_id: existing?.id ?? null,
        p_expected_version: existing?.version ?? null,
        p_action: 'save',
      });
    },
    async setArchived(hotelId, person, archived) {
      await rpc('casual_attendance_save_person', {
        p_hotel_id: hotelId,
        p_department_id: person.departmentId,
        p_input: null,
        p_person_id: person.id,
        p_expected_version: person.version,
        p_action: archived ? 'archive' : 'restore',
      });
    },
    async listDay(query, signal) {
      const result = await rpc(
        'casual_attendance_day',
        { p_hotel_id: query.hotelId, p_department_id: query.departmentId, p_day: query.day },
        signal,
      );
      return parseDay(result.data);
    },
    async mark(hotelId, personId, day, action, expectedVersion, note = '') {
      const result = await rpc('casual_attendance_mark', {
        p_hotel_id: hotelId,
        p_person_id: personId,
        p_day: day,
        p_action: action,
        p_expected_version: expectedVersion,
        p_note: note.trim(),
      });
      return result.data === null ? null : parseRecord(result.data, personId);
    },
    async correct(hotelId, personId, day, input, expectedVersion) {
      const result = await rpc('casual_attendance_correct', {
        p_hotel_id: hotelId,
        p_person_id: personId,
        p_day: day,
        p_check_in: input.checkIn.trim(),
        p_check_out: input.checkOut.trim() || null,
        p_reason: input.reason.trim(),
        p_expected_version: expectedVersion,
      });
      return parseRecord(result.data, personId);
    },
    async recap(query, purpose, signal) {
      const result = await rpc(
        'casual_attendance_recap',
        {
          p_hotel_id: query.hotelId,
          p_department_id: query.departmentId,
          p_type: query.type,
          p_from: query.from,
          p_to: query.to,
          p_purpose: purpose,
        },
        signal,
      );
      return parseRecap(result.data);
    },
    async createLinkCode(hotelId, personId) {
      const result = await rpc('casual_attendance_person_link', {
        p_hotel_id: hotelId,
        p_person_id: personId,
        p_action: 'code',
      });
      return parseLinkCode(result.data);
    },
    async unlink(hotelId, personId) {
      await rpc('casual_attendance_person_link', {
        p_hotel_id: hotelId,
        p_person_id: personId,
        p_action: 'unlink',
      });
    },
    async listSettings(hotelId, departmentId, signal) {
      const result = await rpc(
        'casual_attendance_settings',
        { p_hotel_id: hotelId, p_department_id: departmentId },
        signal,
      );
      return parseSettings(result.data);
    },
    async saveSettings(hotelId, departmentId, input, expectedVersion) {
      await rpc('casual_attendance_save_settings', {
        p_hotel_id: hotelId,
        p_department_id: departmentId,
        p_input: { selfEnabled: input.selfEnabled, confirmation: input.confirmation },
        p_expected_version: expectedVersion,
      });
    },
    async selfStatus(signal) {
      const result = await rpc('casual_attendance_self_status', {}, signal);
      return parseSelfStatus(result.data);
    },
    async redeemLinkCode(code) {
      const result = await rpc('casual_attendance_redeem_link_code', {
        p_code: code.trim().slice(0, 20),
      });
      return parseSelfStatus(result.data);
    },
    async selfMark(action) {
      const result = await rpc('casual_attendance_self_mark', {
        p_action: action,
        p_location: null,
      });
      if (
        !isObject(result.data) ||
        !isText(result.data.person_id) ||
        !uuidPattern.test(result.data.person_id)
      )
        throw invalid();
      return parseRecord(result.data, result.data.person_id);
    },
  };
}
