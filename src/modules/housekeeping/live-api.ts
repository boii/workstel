import { ModuleRequestError, moduleRpc, parseCursor, uuidPattern } from '../../core/module-rpc';
import type { HousekeepingApi } from './api';
import { taskStatuses, taskTypes } from './types';
import type { CleaningTask, HousekeepingSummary, Room, TaskType } from './types';

type Rpc = typeof moduleRpc;
type Raw = Record<string, unknown>;
const invalid = () => new ModuleRequestError('INVALID_RESPONSE');
const isText = (value: unknown): value is string => typeof value === 'string';
const isTime = (value: unknown): value is string =>
  isText(value) && !Number.isNaN(Date.parse(value));
const isCount = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0;
const optionalTime = (value: unknown) => value === null || isTime(value);

export function parseTask(raw: Raw, roomNumber = ''): CleaningTask {
  if (
    !raw ||
    !isText(raw.id) ||
    !uuidPattern.test(raw.id) ||
    !isText(raw.room_id) ||
    !taskTypes.includes(raw.task_type as never) ||
    !taskStatuses.includes(raw.status as never) ||
    !isText(raw.attendant_email) ||
    typeof raw.mine !== 'boolean' ||
    !isTime(raw.started_at) ||
    !optionalTime(raw.paused_at) ||
    !isCount(raw.paused_seconds) ||
    !optionalTime(raw.finished_at) ||
    !(raw.duration_seconds === null || isCount(raw.duration_seconds)) ||
    (raw.room_number !== undefined && !isText(raw.room_number))
  )
    throw invalid();
  return {
    id: raw.id,
    roomId: raw.room_id,
    roomNumber: (raw.room_number as string | undefined) ?? roomNumber,
    type: raw.task_type as TaskType,
    status: raw.status as CleaningTask['status'],
    attendantEmail: raw.attendant_email,
    mine: raw.mine,
    startedAt: raw.started_at,
    pausedAt: (raw.paused_at as string | null) ?? null,
    pausedSeconds: raw.paused_seconds,
    finishedAt: (raw.finished_at as string | null) ?? null,
    durationSeconds: (raw.duration_seconds as number | null) ?? null,
  };
}

export function parseRooms(data: unknown, hotelId: string): Room[] {
  if (!Array.isArray(data) || data.length > 1000) throw invalid();
  return data.map((raw: Raw) => {
    const last = raw?.last_done as Raw | null | undefined;
    if (
      !raw ||
      ![
        'id',
        'hotel_id',
        'department_id',
        'department_name',
        'room_number',
        'floor',
        'room_type',
      ].every((key) => isText(raw[key])) ||
      raw.hotel_id !== hotelId ||
      !uuidPattern.test(String(raw.id)) ||
      typeof raw.archived !== 'boolean' ||
      !Number.isInteger(raw.version) ||
      !(raw.open_task === null || typeof raw.open_task === 'object') ||
      !(
        last === null ||
        (last &&
          taskTypes.includes(last.task_type as never) &&
          isTime(last.finished_at) &&
          isCount(last.duration_seconds))
      )
    )
      throw invalid();
    const number = String(raw.room_number);
    const task = raw.open_task ? parseTask(raw.open_task as Raw, number) : null;
    if (task && (task.roomId !== raw.id || !['active', 'paused'].includes(task.status)))
      throw invalid();
    return {
      id: String(raw.id),
      hotelId,
      departmentId: String(raw.department_id),
      departmentName: String(raw.department_name),
      number,
      floor: String(raw.floor),
      roomType: String(raw.room_type),
      archived: raw.archived,
      version: Number(raw.version),
      openTask: task,
      lastDone: last
        ? {
            type: last.task_type as TaskType,
            finishedAt: String(last.finished_at),
            durationSeconds: Number(last.duration_seconds),
          }
        : null,
    };
  });
}

export function parseSummary(data: unknown, meta: Raw | undefined): HousekeepingSummary {
  const raw = data as Raw | null;
  const totals = raw?.totals as Raw | undefined;
  const types = raw?.task_types as Record<string, Raw> | undefined;
  if (
    !raw ||
    !totals ||
    !isCount(totals.done) ||
    !isCount(totals.rooms) ||
    !isCount(totals.avg_seconds) ||
    !types ||
    typeof types !== 'object' ||
    !Object.entries(types).every(
      ([key, value]) =>
        taskTypes.includes(key as never) &&
        isCount(value?.done) &&
        isCount(value?.avg_seconds) &&
        isCount(value?.max_seconds),
    ) ||
    !Array.isArray(raw.attendants) ||
    !raw.attendants.every(
      (row: Raw) =>
        isText(row?.email) &&
        isCount(row.done) &&
        isCount(row.avg_seconds) &&
        isCount(row.total_seconds),
    ) ||
    !isText(meta?.day)
  )
    throw invalid();
  return {
    totals: {
      done: Number(totals.done),
      rooms: Number(totals.rooms),
      avgSeconds: Number(totals.avg_seconds),
    },
    taskTypes: Object.fromEntries(
      Object.entries(types).map(([key, value]) => [
        key as TaskType,
        {
          done: Number(value.done),
          avgSeconds: Number(value.avg_seconds),
          maxSeconds: Number(value.max_seconds),
        },
      ]),
    ),
    attendants: (raw.attendants as Raw[]).map((row) => ({
      email: String(row.email),
      done: Number(row.done),
      avgSeconds: Number(row.avg_seconds),
      totalSeconds: Number(row.total_seconds),
    })),
    day: meta.day,
  };
}

export function createLiveHousekeepingApi(rpc: Rpc = moduleRpc): HousekeepingApi {
  return {
    async listRooms(hotelId, departmentId, includeArchived, signal) {
      const result = await rpc(
        'housekeeping_rooms_list',
        { p_hotel_id: hotelId, p_department_id: departmentId, p_include_archived: includeArchived },
        signal,
      );
      if (!isTime(result.meta?.now)) throw invalid();
      return { rooms: parseRooms(result.data, hotelId), serverNow: String(result.meta.now) };
    },
    async saveRoom(hotelId, departmentId, input, existing) {
      await rpc('housekeeping_room_save', {
        p_hotel_id: hotelId,
        p_department_id: departmentId,
        p_input: {
          roomNumber: input.roomNumber.trim(),
          floor: input.floor.trim(),
          roomType: input.roomType.trim(),
        },
        p_room_id: existing?.id ?? null,
        p_expected_version: existing?.version ?? null,
        p_action: 'save',
      });
    },
    async setRoomArchived(hotelId, room, archived) {
      await rpc('housekeeping_room_save', {
        p_hotel_id: hotelId,
        p_department_id: room.departmentId,
        p_input: null,
        p_room_id: room.id,
        p_expected_version: room.version,
        p_action: archived ? 'archive' : 'restore',
      });
    },
    async importRooms(hotelId, departmentId, rows) {
      const result = await rpc('housekeeping_rooms_import', {
        p_hotel_id: hotelId,
        p_department_id: departmentId,
        p_rows: rows,
      });
      const data = result.data as Raw | null;
      if (!data || !isCount(data.added) || !isCount(data.skipped)) throw invalid();
      return { added: data.added, skipped: data.skipped };
    },
    async startTask(hotelId, room, type) {
      await rpc('housekeeping_task_start', {
        p_hotel_id: hotelId,
        p_room_id: room.id,
        p_task_type: type,
      });
    },
    async updateTask(hotelId, task, action) {
      await rpc('housekeeping_task_update', {
        p_hotel_id: hotelId,
        p_task_id: task.id,
        p_action: action,
      });
    },
    async listTasks(query, signal) {
      const result = await rpc(
        'housekeeping_tasks_list',
        {
          p_hotel_id: query.hotelId,
          p_department_id: query.departmentId,
          p_day: query.day,
          p_room_id: query.roomId,
          p_after: query.after,
          p_limit: query.limit ?? 50,
        },
        signal,
      );
      if (!Array.isArray(result.data) || result.data.length > 100) throw invalid();
      return {
        data: (result.data as Raw[]).map((row) => parseTask(row)),
        nextCursor: parseCursor(result.meta),
      };
    },
    async summary(hotelId, departmentId, day, signal) {
      const result = await rpc(
        'housekeeping_summary',
        { p_hotel_id: hotelId, p_department_id: departmentId, p_day: day },
        signal,
      );
      return parseSummary(result.data, result.meta);
    },
  };
}
