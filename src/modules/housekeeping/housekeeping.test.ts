import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ModuleRequestError } from '../../core/module-rpc';
import { createDemoHousekeepingApi } from './demo-api';
import { parseRooms, parseSummary, parseTask } from './live-api';
import type { CleaningTask } from './types';
import {
  allowedTasks,
  elapsedSeconds,
  formatDuration,
  parseRoomLines,
  validateRoom,
} from './validation';

const hotel = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const roomId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const taskRow = {
  id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  room_id: roomId,
  task_type: 'departure',
  status: 'active',
  attendant_email: 'siti@example.com',
  mine: true,
  started_at: '2026-11-04T01:00:00Z',
  paused_at: null,
  paused_seconds: 0,
  finished_at: null,
  duration_seconds: null,
  notes: '',
};
const roomRow = {
  id: roomId,
  hotel_id: hotel,
  department_id: 'd',
  department_name: 'Housekeeping',
  room_number: '101',
  floor: '1',
  room_type: 'Deluxe',
  status: 'vacant-dirty',
  status_note: '',
  status_changed_at: '2026-11-04T00:00:00Z',
  archived: false,
  version: 1,
  open_task: taskRow,
  last_cleaned_at: null,
};

test('room rules and pasted room lists match the server', () => {
  assert.deepEqual(validateRoom({ roomNumber: '10 1', floor: '1', roomType: '' }), {
    roomNumber: 'invalidRoomNumber',
  });
  const parsed = parseRoomLines('101, 1, Deluxe\n\n102\t1\tSuperior King\nbad room!, 1\n g01;G');
  assert.deepEqual(parsed.invalid, [4]);
  assert.deepEqual(
    parsed.rows.map((r) => r.roomNumber),
    ['101', '102', 'G01'],
  );
  assert.equal(parsed.rows[1].roomType, 'Superior King');
  assert.deepEqual(allowedTasks('occupied'), ['make-up', 'turndown']);
  assert.deepEqual(allowedTasks('out-of-order'), []);
});

test('timers exclude pauses and format as minutes and seconds', () => {
  const task = parseTask(taskRow);
  const start = Date.parse(task.startedAt);
  assert.equal(elapsedSeconds(task, start + 125000), 125);
  const paused: CleaningTask = {
    ...task,
    status: 'paused',
    pausedAt: new Date(start + 600000).toISOString(),
    pausedSeconds: 60,
  };
  assert.equal(elapsedSeconds(paused, start + 900000), 540);
  assert.equal(formatDuration(125), '2:05');
  assert.equal(formatDuration(3725), '1:02:05');
});

test('responses are validated before they are shown', () => {
  const [room] = parseRooms([roomRow], hotel);
  assert.equal(room.openTask?.roomNumber, '101');
  for (const broken of [
    { status: 'clean' },
    { hotel_id: 'other' },
    { open_task: { ...taskRow, room_id: 'other' } },
    { open_task: { ...taskRow, status: 'done' } },
    { open_task: { ...taskRow, started_at: 'soon' } },
  ])
    assert.throws(() => parseRooms([{ ...roomRow, ...broken }], hotel), ModuleRequestError);
  assert.throws(
    () => parseSummary({ statuses: {}, task_types: {}, attendants: [], inspections: {} }, {}),
    ModuleRequestError,
  );
});

test('demo board follows the cleaning flow', async () => {
  const api = createDemoHousekeepingApi();
  const rooms = async () => api.listRooms('demo-hotel', null, false);
  const dirty = (await rooms()).find((r) => r.status === 'vacant-dirty' && !r.openTask)!;
  await assert.rejects(
    api.startTask('demo-hotel', dirty, 'make-up'),
    (error: unknown) => error instanceof ModuleRequestError && error.code === 'WRONG_ROOM_STATUS',
  );
  await api.startTask('demo-hotel', dirty, 'departure');
  const busy = (await rooms()).find((r) => r.id === dirty.id)!;
  assert.equal(busy.openTask?.mine, true);
  const other = (await rooms()).find((r) => r.status === 'vacant-dirty' && !r.openTask)!;
  await assert.rejects(
    api.startTask('demo-hotel', other, 'departure'),
    (error: unknown) => error instanceof ModuleRequestError && error.code === 'ATTENDANT_BUSY',
  );
  await api.updateTask('demo-hotel', busy.openTask!, 'finish');
  const clean = (await rooms()).find((r) => r.id === dirty.id)!;
  assert.equal(clean.status, 'vacant-clean');
  await assert.rejects(
    api.inspect('demo-hotel', clean, 'redo', ' '),
    (error: unknown) => error instanceof ModuleRequestError && error.code === 'NOTE_REQUIRED',
  );
  await api.inspect('demo-hotel', clean, 'pass', '');
  assert.equal((await rooms()).find((r) => r.id === dirty.id)!.status, 'vacant-ready');
  const occupied = (await rooms()).find((r) => r.status === 'occupied')!;
  await api.startTask('demo-hotel', occupied, 'make-up', 'dnd');
  const summary = await api.summary('demo-hotel', null, null);
  assert.equal(summary.taskTypes['make-up']?.declined, 1);
  assert.equal(summary.statuses['in-progress'], 1);
});
