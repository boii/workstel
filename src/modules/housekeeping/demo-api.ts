import { ModuleRequestError } from '../../core/module-rpc';
import type { HousekeepingApi } from './api';
import type { CleaningTask, HousekeepingSummary, Room, TaskType, TypeTotals } from './types';
import { allowedTasks, hotelToday, isFloor, isRoomNumber } from './validation';

export const demoHotelId = 'demo-hotel';
export const demoDepartments = [{ id: 'housekeeping', name: 'Housekeeping' }];
const me = 'demo@example.com';
const isOpen = (task: CleaningTask) => task.status === 'active' || task.status === 'paused';

/** In-memory demo board that mirrors the server rules; it resets on reload. */
export function createDemoHousekeepingApi(): HousekeepingApi {
  const department = demoDepartments[0];
  const now = () => new Date().toISOString();
  const minutesAgo = (minutes: number) => new Date(Date.now() - minutes * 60000).toISOString();
  const statuses: Room['status'][] = [
    'vacant-ready',
    'occupied',
    'vacant-dirty',
    'vacant-clean',
    'occupied',
    'vacant-dirty',
    'out-of-order',
    'occupied',
  ];
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
        status: statuses[(index + Number(floor)) % statuses.length],
        statusNote: '',
        statusChangedAt: minutesAgo(90),
        archived: false,
        version: 1,
        openTask: null,
        lastCleanedAt: null,
      });
  for (const room of rooms) if (room.status === 'out-of-order') room.statusNote = 'AC leaking';
  const tasks: CleaningTask[] = [];
  const add = (room: Room, type: TaskType, minutes: number, email: string, done: number | null) => {
    const task: CleaningTask = {
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
      durationSeconds: done === null ? null : done * 60,
      notes: '',
    };
    tasks.push(task);
    if (done !== null) room.lastCleanedAt = task.finishedAt;
  };
  const dirty = rooms.filter((r) => r.status === 'vacant-dirty');
  add(dirty[0], 'departure', 12, 'siti@example.com', null);
  for (const [index, room] of rooms.filter((r) => r.status === 'vacant-ready').entries())
    add(
      room,
      'departure',
      180 - index * 20,
      index % 2 ? 'siti@example.com' : 'budi@example.com',
      28 + index * 3,
    );
  for (const room of rooms.filter((r) => r.status === 'vacant-clean'))
    add(room, 'departure', 70, 'budi@example.com', 34);
  add(rooms.filter((r) => r.status === 'occupied')[0], 'make-up', 120, 'siti@example.com', 17);
  const inspections = { pass: 2, redo: 1 };

  const room = (id: string) => {
    const found = rooms.find((r) => r.id === id);
    if (!found) throw new ModuleRequestError('ACCESS_DENIED');
    return found;
  };
  const bump = (target: Room) => {
    target.version += 1;
    target.statusChangedAt = now();
  };
  const withTasks = (target: Room): Room => ({
    ...target,
    openTask: tasks.find((t) => t.roomId === target.id && isOpen(t)) ?? null,
  });
  return {
    async listRooms(_hotelId, _departmentId, includeArchived) {
      return rooms
        .filter((r) => includeArchived || !r.archived)
        .sort((a, b) => a.floor.localeCompare(b.floor) || a.number.localeCompare(b.number))
        .map(withTasks);
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
          status: 'vacant-dirty',
          statusNote: '',
          statusChangedAt: now(),
          archived: false,
          version: 1,
          openTask: null,
          lastCleanedAt: null,
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
    async setStatus(_hotelId, entry, status, note) {
      const target = room(entry.id);
      if (target.version !== entry.version) throw new ModuleRequestError('VERSION_CONFLICT');
      if (status === 'out-of-order' && !note.trim()) throw new ModuleRequestError('NOTE_REQUIRED');
      if (tasks.some((t) => t.roomId === target.id && isOpen(t)))
        throw new ModuleRequestError('TASK_OPEN');
      Object.assign(target, { status, statusNote: note.trim() });
      bump(target);
    },
    async startTask(_hotelId, entry, type, outcome, notes = '') {
      const target = room(entry.id);
      if (!allowedTasks(target.status).includes(type))
        throw new ModuleRequestError('WRONG_ROOM_STATUS');
      const base = {
        id: crypto.randomUUID(),
        roomId: target.id,
        roomNumber: target.number,
        type,
        attendantEmail: me,
        mine: true,
        startedAt: now(),
        pausedAt: null,
        pausedSeconds: 0,
        notes: notes.trim(),
      };
      if (outcome) {
        if (type !== 'make-up' && type !== 'turndown')
          throw new ModuleRequestError('INVALID_INPUT');
        tasks.push({ ...base, status: outcome, finishedAt: now(), durationSeconds: 0 });
        return;
      }
      if (tasks.some((t) => t.roomId === target.id && isOpen(t)))
        throw new ModuleRequestError('ROOM_BUSY');
      if (tasks.some((t) => t.mine && isOpen(t))) throw new ModuleRequestError('ATTENDANT_BUSY');
      tasks.push({ ...base, status: 'active', finishedAt: null, durationSeconds: null });
    },
    async updateTask(_hotelId, entry, action, outcome = 'done', notes) {
      const task = tasks.find((t) => t.id === entry.id);
      if (!task) throw new ModuleRequestError('ACCESS_DENIED');
      if (!isOpen(task) || (action === 'pause' && task.status !== 'active'))
        throw new ModuleRequestError('TASK_CLOSED');
      if (action === 'resume' && task.status !== 'paused')
        throw new ModuleRequestError('TASK_CLOSED');
      const at = Date.now();
      const paused =
        task.pausedSeconds +
        (task.pausedAt ? Math.floor((at - Date.parse(task.pausedAt)) / 1000) : 0);
      if (action === 'pause') Object.assign(task, { status: 'paused', pausedAt: now() });
      else if (action === 'resume')
        Object.assign(task, { status: 'active', pausedAt: null, pausedSeconds: paused });
      else {
        Object.assign(task, {
          status: action === 'cancel' ? 'cancelled' : outcome,
          pausedAt: null,
          pausedSeconds: paused,
          finishedAt: now(),
          durationSeconds:
            action === 'cancel'
              ? null
              : Math.max(0, Math.floor((at - Date.parse(task.startedAt)) / 1000) - paused),
          notes: notes === undefined ? task.notes : notes.trim(),
        });
        const target = room(task.roomId);
        if (task.status === 'done') target.lastCleanedAt = task.finishedAt;
        if (
          task.status === 'done' &&
          (task.type === 'departure' || task.type === 'deep-clean') &&
          target.status.startsWith('vacant')
        ) {
          target.status = 'vacant-clean';
          target.statusNote = '';
          bump(target);
        }
      }
    },
    async inspect(_hotelId, entry, result, reason) {
      const target = room(entry.id);
      if (target.version !== entry.version) throw new ModuleRequestError('VERSION_CONFLICT');
      if (result === 'redo' && !reason.trim()) throw new ModuleRequestError('NOTE_REQUIRED');
      if (target.status !== 'vacant-clean') throw new ModuleRequestError('WRONG_ROOM_STATUS');
      inspections[result]++;
      target.status = result === 'pass' ? 'vacant-ready' : 'vacant-dirty';
      target.statusNote = result === 'pass' ? '' : reason.trim();
      bump(target);
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
      const live = rooms.filter((r) => !r.archived);
      const count = (status: Room['status']) => live.filter((r) => r.status === status).length;
      const ofDay = tasks.filter((t) => hotelToday(new Date(t.startedAt)) === target);
      const taskTypes: Partial<Record<TaskType, TypeTotals>> = {};
      for (const task of ofDay) {
        const totals = (taskTypes[task.type] ??= { done: 0, avgSeconds: 0, declined: 0 });
        if (task.status === 'dnd' || task.status === 'refused') totals.declined++;
      }
      for (const [type, totals] of Object.entries(taskTypes)) {
        const done = ofDay.filter((t) => t.type === type && t.status === 'done');
        totals.done = done.length;
        totals.avgSeconds = done.length
          ? Math.round(done.reduce((sum, t) => sum + (t.durationSeconds ?? 0), 0) / done.length)
          : 0;
      }
      const people = new Map<string, number[]>();
      for (const task of ofDay.filter((t) => t.status === 'done'))
        people.set(task.attendantEmail, [
          ...(people.get(task.attendantEmail) ?? []),
          task.durationSeconds ?? 0,
        ]);
      const summary: HousekeepingSummary = {
        statuses: {
          'vacant-dirty': count('vacant-dirty'),
          'vacant-clean': count('vacant-clean'),
          'vacant-ready': count('vacant-ready'),
          occupied: count('occupied'),
          'out-of-order': count('out-of-order'),
          'in-progress': live.filter((r) => tasks.some((t) => t.roomId === r.id && isOpen(t)))
            .length,
        },
        taskTypes,
        attendants: [...people.entries()]
          .map(([email, durations]) => ({
            email,
            done: durations.length,
            avgSeconds: Math.round(durations.reduce((a, b) => a + b, 0) / durations.length),
            totalSeconds: durations.reduce((a, b) => a + b, 0),
          }))
          .sort((a, b) => b.done - a.done || a.email.localeCompare(b.email)),
        inspections: { ...inspections },
        day: target,
        serverNow: now(),
      };
      return summary;
    },
  };
}
