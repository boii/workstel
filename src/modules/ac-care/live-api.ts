import { ModuleRequestError, moduleRpc, uuidPattern } from '../../core/module-rpc';
import type { AcCareApi } from './api';
import {
  attentionReasons,
  checklistItems,
  complaintKinds,
  conditions,
  refrigerants,
  serviceTypes,
  unitTypes,
} from './types';
import type {
  AcUnit,
  AreaList,
  ChecklistItem,
  HistoryEntry,
  HistoryPage,
  ScheduleEntry,
  ServiceOutcome,
  ServiceType,
  ItemState,
  Work,
} from './types';
import { normalizeCode } from './validation';

type Rpc = typeof moduleRpc;
type Raw = Record<string, unknown>;
const invalid = () => new ModuleRequestError('INVALID_RESPONSE');
const isText = (value: unknown): value is string => typeof value === 'string';
const isTime = (value: unknown): value is string =>
  isText(value) && !Number.isNaN(Date.parse(value));
const isDay = (value: unknown): value is string =>
  isText(value) && /^\d{4}-\d{2}-\d{2}$/.test(value);
const isCount = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0;
const isNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);
const optional = <T>(value: unknown, check: (value: unknown) => value is T) =>
  value === null || check(value);
const oneOf = <T extends string>(list: readonly T[], value: unknown): value is T =>
  list.includes(value as T);
const isUuid = (value: unknown): value is string => isText(value) && uuidPattern.test(value);
const isObject = (value: unknown): value is Raw =>
  !!value && typeof value === 'object' && !Array.isArray(value);

function parseItems(value: unknown) {
  if (
    !isObject(value) ||
    !Object.entries(value).every(
      ([key, state]) => oneOf(checklistItems, key) && (state === 'ok' || state === 'issue'),
    )
  )
    throw invalid();
  return value as Partial<Record<ChecklistItem, ItemState>>;
}
function parseReasons(value: unknown) {
  if (!Array.isArray(value) || !value.every((reason) => oneOf(attentionReasons, reason)))
    throw invalid();
  return value as ServiceOutcome['reasons'];
}

function parseWork(raw: unknown): Work | null {
  if (raw === null || raw === undefined) return null;
  if (
    !isObject(raw) ||
    !(raw.state === 'claimed' || raw.state === 'postponed') ||
    !isText(raw.user_email) ||
    typeof raw.mine !== 'boolean' ||
    !isText(raw.note) ||
    !isTime(raw.at) ||
    !optional(raw.expires_at, isTime) ||
    typeof raw.assigned !== 'boolean'
  )
    throw invalid();
  return {
    state: raw.state,
    userEmail: raw.user_email,
    mine: raw.mine,
    note: raw.note,
    at: raw.at,
    expiresAt: (raw.expires_at as string | null) ?? null,
    assigned: raw.assigned,
  };
}

function parseSchedule(value: unknown): ScheduleEntry[] {
  if (!Array.isArray(value) || value.length > serviceTypes.length) throw invalid();
  return value.map((raw: unknown) => {
    if (
      !isObject(raw) ||
      !oneOf(serviceTypes, raw.type) ||
      !isCount(raw.interval_days) ||
      !optional(raw.last_done_at, isTime) ||
      !isDay(raw.due_on)
    )
      throw invalid();
    return {
      type: raw.type,
      intervalDays: raw.interval_days,
      lastDoneAt: (raw.last_done_at as string | null) ?? null,
      dueOn: raw.due_on,
      work: parseWork(raw.work),
    };
  });
}

export function parseUnit(raw: unknown, hotelId: string): AcUnit {
  if (
    !isObject(raw) ||
    !isUuid(raw.id) ||
    raw.hotel_id !== hotelId ||
    !['department_id', 'department_name', 'code', 'location', 'area', 'brand', 'capacity'].every(
      (key) => isText(raw[key]),
    ) ||
    !oneOf(unitTypes, raw.unit_type) ||
    !oneOf(refrigerants, raw.refrigerant) ||
    !optional(raw.rated_current, isNumber) ||
    !optional(raw.installed_on, isDay) ||
    !optional(raw.warranty_until, isDay) ||
    !['filter_days', 'routine_days', 'major_days', 'annual_days'].every((key) =>
      isCount(raw[key]),
    ) ||
    !oneOf(conditions, raw.condition) ||
    typeof raw.archived !== 'boolean' ||
    !Number.isInteger(raw.version) ||
    typeof raw.area_mine !== 'boolean' ||
    !isCount(raw.complaints_60d) ||
    !isCount(raw.refills_90d)
  )
    throw invalid();
  const last = raw.last_service;
  if (
    last !== null &&
    !(
      isObject(last) &&
      oneOf(serviceTypes, last.service_type) &&
      isTime(last.done_at) &&
      (last.result === 'normal' || last.result === 'attention')
    )
  )
    throw invalid();
  return {
    id: raw.id,
    hotelId,
    departmentId: String(raw.department_id),
    departmentName: String(raw.department_name),
    code: String(raw.code),
    location: String(raw.location),
    area: String(raw.area),
    unitType: raw.unit_type,
    brand: String(raw.brand),
    capacity: String(raw.capacity),
    refrigerant: raw.refrigerant,
    ratedCurrent: (raw.rated_current as number | null) ?? null,
    installedOn: (raw.installed_on as string | null) ?? null,
    warrantyUntil: (raw.warranty_until as string | null) ?? null,
    intervals: {
      filter: Number(raw.filter_days),
      routine: Number(raw.routine_days),
      major: Number(raw.major_days),
      annual: Number(raw.annual_days),
    },
    condition: raw.condition,
    archived: raw.archived,
    version: Number(raw.version),
    areaMine: raw.area_mine,
    complaints60d: raw.complaints_60d,
    refills90d: raw.refills_90d,
    lastService: last
      ? {
          type: (last as Raw).service_type as ServiceType,
          doneAt: String((last as Raw).done_at),
          result: (last as Raw).result as 'normal' | 'attention',
        }
      : null,
    schedule: parseSchedule(raw.schedule),
  };
}

export function parseUnits(data: unknown, hotelId: string): AcUnit[] {
  if (!Array.isArray(data) || data.length > 1000) throw invalid();
  return data.map((raw) => parseUnit(raw, hotelId));
}

export function parseHistory(data: unknown, meta: Raw | undefined): HistoryPage {
  if (!Array.isArray(data) || data.length > 50) throw invalid();
  const entries = data.map((raw: unknown): HistoryEntry => {
    if (!isObject(raw) || !isUuid(raw.id) || !isTime(raw.at) || !isText(raw.by_email))
      throw invalid();
    if (raw.kind === 'complaint') {
      if (!oneOf(complaintKinds, raw.complaint) || !isText(raw.notes)) throw invalid();
      return {
        kind: 'complaint',
        id: raw.id,
        at: raw.at,
        byEmail: raw.by_email,
        complaint: raw.complaint,
        notes: raw.notes,
      };
    }
    if (
      raw.kind !== 'service' ||
      !oneOf(serviceTypes, raw.service_type) ||
      !['return_temp', 'supply_temp', 'pressure_psi', 'current_amp'].every((key) =>
        optional(raw[key], isNumber),
      ) ||
      typeof raw.refrigerant_added !== 'boolean' ||
      !(raw.result === 'normal' || raw.result === 'attention') ||
      !isText(raw.notes)
    )
      throw invalid();
    return {
      kind: 'service',
      id: raw.id,
      at: raw.at,
      byEmail: raw.by_email,
      serviceType: raw.service_type,
      items: parseItems(raw.items),
      returnTemp: (raw.return_temp as number | null) ?? null,
      supplyTemp: (raw.supply_temp as number | null) ?? null,
      pressurePsi: (raw.pressure_psi as number | null) ?? null,
      currentAmp: (raw.current_amp as number | null) ?? null,
      refrigerantAdded: raw.refrigerant_added,
      result: raw.result,
      reasons: parseReasons(raw.reasons),
      notes: raw.notes,
    };
  });
  const cursor = meta?.nextCursor;
  if (
    cursor !== null &&
    cursor !== undefined &&
    !(isObject(cursor) && isTime(cursor.at) && isUuid(cursor.id))
  )
    throw invalid();
  return {
    data: entries,
    nextCursor: isObject(cursor) ? { at: String(cursor.at), id: String(cursor.id) } : null,
  };
}

export function parseAreas(data: unknown): AreaList {
  const raw = data as Raw | null;
  const people = (value: unknown) => {
    if (!Array.isArray(value) || value.length > 500) throw invalid();
    return value.map((row: unknown) => {
      if (!isObject(row) || !isUuid(row.user_id) || !isText(row.email)) throw invalid();
      return { userId: row.user_id, email: row.email, backup: row.backup === true };
    });
  };
  if (!isObject(raw) || !Array.isArray(raw.areas) || raw.areas.length > 1000) throw invalid();
  return {
    areas: raw.areas.map((row: unknown) => {
      if (!isObject(row) || !isText(row.area) || !isCount(row.units)) throw invalid();
      return { area: row.area, units: row.units, members: people(row.members) };
    }),
    technicians: people(raw.technicians).map(({ userId, email }) => ({ userId, email })),
  };
}

export function createLiveAcCareApi(rpc: Rpc = moduleRpc): AcCareApi {
  return {
    async listUnits(hotelId, departmentId, includeArchived, signal) {
      const result = await rpc(
        'ac_care_units_list',
        { p_hotel_id: hotelId, p_department_id: departmentId, p_include_archived: includeArchived },
        signal,
      );
      if (!isTime(result.meta?.now) || !isDay(result.meta?.today)) throw invalid();
      return {
        units: parseUnits(result.data, hotelId),
        today: String(result.meta.today),
        serverNow: String(result.meta.now),
      };
    },
    async saveUnit(hotelId, departmentId, input, existing) {
      await rpc('ac_care_unit_save', {
        p_hotel_id: hotelId,
        p_department_id: departmentId,
        p_input: {
          code: normalizeCode(input.code),
          location: input.location.trim(),
          area: input.area.trim(),
          unitType: input.unitType,
          brand: input.brand.trim(),
          capacity: input.capacity.trim(),
          refrigerant: input.refrigerant,
          ratedCurrent: input.ratedCurrent,
          installedOn: input.installedOn,
          warrantyUntil: input.warrantyUntil,
          filterDays: input.intervals.filter,
          routineDays: input.intervals.routine,
          majorDays: input.intervals.major,
          annualDays: input.intervals.annual,
        },
        p_unit_id: existing?.id ?? null,
        p_expected_version: existing?.version ?? null,
        p_action: 'save',
      });
    },
    async setUnitState(hotelId, unit, action) {
      await rpc('ac_care_unit_save', {
        p_hotel_id: hotelId,
        p_department_id: unit.departmentId,
        p_input: null,
        p_unit_id: unit.id,
        p_expected_version: unit.version,
        p_action: action,
      });
    },
    async importUnits(hotelId, departmentId, rows) {
      const result = await rpc('ac_care_units_import', {
        p_hotel_id: hotelId,
        p_department_id: departmentId,
        p_rows: rows,
      });
      const data = result.data as Raw | null;
      if (!data || !isCount(data.added) || !isCount(data.skipped)) throw invalid();
      return { added: data.added, skipped: data.skipped };
    },
    async setWork(hotelId, unit, type, action, options = {}) {
      await rpc('ac_care_work_set', {
        p_hotel_id: hotelId,
        p_unit_id: unit.id,
        p_service_type: type,
        p_action: action,
        p_note: options.note?.trim() ?? '',
        p_user_id: options.userId ?? null,
      });
    },
    async recordService(hotelId, unit, input, idempotencyKey) {
      const result = await rpc('ac_care_service_record', {
        p_hotel_id: hotelId,
        p_unit_id: unit.id,
        p_input: { ...input, notes: input.notes.trim() },
        p_idempotency_key: idempotencyKey,
      });
      const data = result.data as Raw | null;
      if (!data || !isUuid(data.id) || !(data.result === 'normal' || data.result === 'attention'))
        throw invalid();
      return { id: data.id, result: data.result, reasons: parseReasons(data.reasons) };
    },
    async recordComplaint(hotelId, unit, kind, note, idempotencyKey) {
      await rpc('ac_care_complaint_record', {
        p_hotel_id: hotelId,
        p_unit_id: unit.id,
        p_kind: kind,
        p_note: note.trim(),
        p_idempotency_key: idempotencyKey,
      });
    },
    async unitHistory(hotelId, unit, before, signal) {
      const result = await rpc(
        'ac_care_unit_history',
        {
          p_hotel_id: hotelId,
          p_unit_id: unit.id,
          p_before_at: before?.at ?? null,
          p_before_id: before?.id ?? null,
          p_limit: 20,
        },
        signal,
      );
      return parseHistory(result.data, result.meta);
    },
    async listAreas(hotelId, departmentId, signal) {
      const result = await rpc(
        'ac_care_areas_list',
        { p_hotel_id: hotelId, p_department_id: departmentId },
        signal,
      );
      return parseAreas(result.data);
    },
    async setAreaMember(hotelId, departmentId, area, userId, action, backup) {
      await rpc('ac_care_area_member_set', {
        p_hotel_id: hotelId,
        p_department_id: departmentId,
        p_area: area.trim(),
        p_user_id: userId,
        p_action: action,
        p_backup: backup,
      });
    },
  };
}
