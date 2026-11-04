import { ModuleRequestError } from '../../core/module-rpc';
import type { HousekeepingApi } from './api';
import type { CleaningTask, HousekeepingSummary, Room, TaskType, TypeTotals } from './types';
import { hotelToday, isFloor, isRoomNumber } from './validation';

export const demoHotelId = 'demo-hotel';
export const demoDepartments = [{ id: 'housekeeping', name: 'Housekeeping' }];
const me = 'demo@example.com';
const isOpen = (task: CleaningTask) => task.status === 'active' || task.status === 'paused';

/** In-memory demo that mirrors the server rules; it resets on reload. */
export function createDemoHousekeepingApi(): HousekeepingApi {
  const department = demoDepartments[0];
  const now = () => new Date().toISOString();
  const minutesAgo = (minutes: number) => new Date(Date.now() - minutes * 60000).toISOString();
  const rooms: Room[] = [];
  for (const floor of ['1', '2'])
    for (let index = 1; index <= 8; index++)
      rooms.push({
        id: 'demo-room-' + floor + index,
        hotelId: demoHotelId,
        departmentId: department.id,
        departmentName: department.name,
        number: floor + '0' + index,
        floor,
        roomType: index > 6 ? 'Suite' : index % 2 ? 'Deluxe' : 'Superior',
        archived: false,
        version: 1,
        openTask: null,
        lastDone: null,
      });
  const tasks: CleaningTask[] = [];
  const add = (room: Room, type: TaskType, minutes: number, email: string, done: number | null) => {
    tasks.push({
      id: crypto.randomUUID(),
      roomId: room.id,
      roomNumber: room.number,
      type,
      status: done === null ? 'active' : 'done',
      attendantEmail: email,
      mine: email === me,
      startedAt: minutesAgo(minutes),
      pausedAt: null,
      pausedSeconds: 0,
      finishedAt: done === null ? null : minutesAgo(minutes - done),
      durationSeconds: done === null ? null : done * 60 + 17,
    });
  };
  add(rooms[0], 'departure', 12, 'siti@example.com', null);
  add(rooms[9], 'make-up', 6, 'budi@example.com', null);
  (
    [
      [1, 'departure', 200, 'siti@example.com', 31],
      [2, 'make-up', 170, 'siti@example.com', 18],
      [4, 'departure', 150, 'budi@example.com', 27],
      [5, 'make-up', 120, 'budi@example.com', 16],
      [8, 'departure', 100, 'siti@example.com', 35],
      [11, 'make-up', 80, 'budi@example.com', 21],
      [13, 'other', 60, 'siti@example.com', 45],
    ] as const
  ).forEach(([index, type, minutes, email, done]) => add(rooms[index], type, minutes, email, done));

  const room = (id: string) => {
    const found = rooms.find((r) => r.id === id);
    if (!found) throw new ModuleRequestError('ACCESS_DENIED');
    return found;
  };
  const view = (target: Room): Room => {
    const last = tasks
      .filter((t) => t.roomId === target.id && t.status === 'done')
      .sort((a, b) => b.finishedAt!.localeCompare(a.finishedAt!))[0];
    return {
      ...target,
      openTask: tasks.find((t) => t.roomId === target.id && isOpen(t)) ?? null,
      lastDone: last
        ? { type: last.type, finishedAt: last.finishedAt!, durationSeconds: last.durationSeconds! }
        : null,
    };
  };
  return {
    async listRooms(_hotelId, _departmentId, includeArchived) {
      return {
        rooms: rooms
          .filter((r) => includeArchived || !r.archived)
          .sort((a, b) => a.floor.localeCompare(b.floor) || a.number.localeCompare(b.number))
          .map(view),
        serverNow: now(),
      };
    },
    async saveRoom(_hotelId, _departmentId, input, existing) {
      const number = input.roomNumber.trim().toUpperCase();
      if (!isRoomNumber(number) || !isFloor(input.floor))
        throw new ModuleRequestError('INVALID_INPUT');
      if (rooms.some((r) => r.number === number && r.id !== existing?.id))
        throw new ModuleRequestError('DUPLICATE_ROOM');
      const fields = { number, floor: input.floor.trim(), roomType: input.roomType.trim() };
      if (!existing) {
        rooms.push({
          ...fields,
          id: crypto.randomUUID(),
          hotelId: demoHotelId,
          departmentId: department.id,
          departmentName: department.name,
          archived: false,
          version: 1,
          openTask: null,
          lastDone: null,
        });
        return;
      }
      const target = room(existing.id);
      if (target.version !== existing.version) throw new ModuleRequestError('VERSION_CONFLICT');
      Object.assign(target, fields, { version: target.version + 1 });
    },
    async setRoomArchived(_hotelId, entry, archived) {
      const target = room(entry.id);
      if (target.version !== entry.version) throw new ModuleRequestError('VERSION_CONFLICT');
      if (archived && tasks.some((t) => t.roomId === target.id && isOpen(t)))
        throw new ModuleRequestError('TASK_OPEN');
      Object.assign(target, { archived, version: target.version + 1 });
    },
    async importRooms(hotelId, departmentId, rows) {
      let added = 0;
      for (const row of rows) {
        if (rooms.some((r) => r.number === row.roomNumber.trim().toUpperCase())) continue;
        await this.saveRoom(hotelId, departmentId, row);
        added++;
      }
      return { added, skipped: rows.length - added };
    },
    async startTask(_hotelId, entry, type) {
      const target = room(entry.id);
      if (target.archived) throw new ModuleRequestError('INVALID_INPUT');
      if (tasks.some((t) => t.roomId === target.id && isOpen(t)))
        throw new ModuleRequestError('ROOM_BUSY');
      if (tasks.some((t) => t.mine && isOpen(t))) throw new ModuleRequestError('ATTENDANT_BUSY');
      tasks.push({
        id: crypto.randomUUID(),
        roomId: target.id,
        roomNumber: target.number,
        type,
        status: 'active',
        attendantEmail: me,
        mine: true,
        startedAt: now(),
        pausedAt: null,
        pausedSeconds: 0,
        finishedAt: null,
        durationSeconds: null,
      });
    },
    async updateTask(_hotelId, entry, action) {
      const task = tasks.find((t) => t.id === entry.id);
      if (!task) throw new ModuleRequestError('ACCESS_DENIED');
      if (
        !isOpen(task) ||
        (action === 'pause' && task.status !== 'active') ||
        (action === 'resume' && task.status !== 'paused')
      )
        throw new ModuleRequestError('TASK_CLOSED');
      const at = Date.now();
      const paused =
        task.pausedSeconds +
        (task.pausedAt ? Math.floor((at - Date.parse(task.pausedAt)) / 1000) : 0);
      if (action === 'pause') Object.assign(task, { status: 'paused', pausedAt: now() });
      else if (action === 'resume')
        Object.assign(task, { status: 'active', pausedAt: null, pausedSeconds: paused });
      else
        Object.assign(task, {
          status: action === 'cancel' ? 'cancelled' : 'done',
          pausedAt: null,
          pausedSeconds: paused,
          finishedAt: now(),
          durationSeconds:
            action === 'cancel'
              ? null
              : Math.max(0, Math.floor((at - Date.parse(task.startedAt)) / 1000) - paused),
        });
    },
    async listTasks(query) {
      const data = tasks
        .filter(
          (t) =>
            (!query.roomId || t.roomId === query.roomId) &&
            (!query.day || hotelToday(new Date(t.startedAt)) === query.day),
        )
        .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
        .slice(0, query.limit ?? 50)
        .map((t) => ({ ...t }));
      return { data, nextCursor: null };
    },
    async summary(_hotelId, _departmentId, day) {
      const target = day ?? hotelToday();
      const done = tasks.filter(
        (t) => t.status === 'done' && hotelToday(new Date(t.startedAt)) === target,
      );
      const seconds = (list: CleaningTask[]) => list.map((t) => t.durationSeconds ?? 0);
      const avg = (values: number[]) =>
        values.length ? Math.round(values.reduce((a, b) => a + b, 0) / values.length) : 0;
      const taskTypes: Partial<Record<TaskType, TypeTotals>> = {};
      for (const type of new Set(done.map((t) => t.type))) {
        const values = seconds(done.filter((t) => t.type === type));
        taskTypes[type] = {
          done: values.length,
          avgSeconds: avg(values),
          maxSeconds: Math.max(...values),
        };
      }
      const people = new Map<string, number[]>();
      for (const task of done)
        people.set(task.attendantEmail, [
          ...(people.get(task.attendantEmail) ?? []),
          task.durationSeconds ?? 0,
        ]);
      const summary: HousekeepingSummary = {
        totals: {
          done: done.length,
          rooms: new Set(done.map((t) => t.roomId)).size,
          avgSeconds: avg(seconds(done)),
        },
        taskTypes,
        attendants: [...people.entries()]
          .map(([email, values]) => ({
            email,
            done: values.length,
            avgSeconds: avg(values),
            totalSeconds: values.reduce((a, b) => a + b, 0),
          }))
          .sort((a, b) => b.done - a.done || a.email.localeCompare(b.email)),
        day: target,
      };
      return summary;
    },
  };
}
