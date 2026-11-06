import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ModuleRequestError } from '../../core/module-rpc';
import { createDemoRoomTurnaroundApi } from './demo-api';
import { parseRooms, parseSummary, parseTask } from './live-api';
import type { CleaningTask } from './types';
import { elapsedSeconds, formatDuration, parseRoomLines, validateRoom } from './validation';

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
};
const roomRow = {
  id: roomId,
  hotel_id: hotel,
  department_id: 'd',
  department_name: 'Housekeeping',
  room_number: '101',
  floor: '1',
  room_type: 'Deluxe',
  archived: false,
  version: 1,
  open_task: taskRow,
  last_done: { task_type: 'make-up', finished_at: '2026-11-03T05:00:00Z', duration_seconds: 1080 },
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
});

test('timers exclude pauses and format as minutes and seconds', () => {
  const task = parseTask(taskRow);
  // Older servers send no name: the email's local part stands in for the display name.
  assert.equal(task.attendantName, 'siti');
  assert.equal(parseTask({ ...taskRow, attendant_name: 'Siti Rahma' }).attendantName, 'Siti Rahma');
  assert.equal(parseTask({ ...taskRow, attendant_name: '  ' }).attendantName, 'siti');
  assert.throws(() => parseTask({ ...taskRow, attendant_name: 42 }));
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
  assert.equal(room.lastDone?.durationSeconds, 1080);
  for (const broken of [
    { hotel_id: 'other' },
    { open_task: { ...taskRow, room_id: 'other' } },
    { open_task: { ...taskRow, status: 'done' } },
    { open_task: { ...taskRow, task_type: 'turndown' } },
    { last_done: { task_type: 'make-up', finished_at: 'soon', duration_seconds: 1 } },
  ])
    assert.throws(() => parseRooms([{ ...roomRow, ...broken }], hotel), ModuleRequestError);
  assert.throws(
    () => parseSummary({ totals: {}, task_types: {}, attendants: [] }, {}),
    ModuleRequestError,
  );
});

test('demo timer starts, pauses and finishes one room at a time', async () => {
  const api = createDemoRoomTurnaroundApi();
  const rooms = async () => (await api.listRooms('demo-hotel', null, false)).rooms;
  const free = (await rooms()).filter((r) => !r.openTask);
  await api.startTask('demo-hotel', free[0], 'departure');
  await assert.rejects(
    api.startTask('demo-hotel', free[1], 'make-up'),
    (error: unknown) => error instanceof ModuleRequestError && error.code === 'ATTENDANT_BUSY',
  );
  const busy = (await rooms()).find((r) => r.id === free[0].id)!;
  assert.equal(busy.openTask?.mine, true);
  await api.updateTask('demo-hotel', busy.openTask!, 'pause');
  const paused = (await rooms()).find((r) => r.id === free[0].id)!;
  assert.equal(paused.openTask?.status, 'paused');
  await api.updateTask('demo-hotel', paused.openTask!, 'finish');
  const done = (await rooms()).find((r) => r.id === free[0].id)!;
  assert.equal(done.openTask, null);
  assert.equal(done.lastDone?.type, 'departure');
  const summary = await api.summary('demo-hotel', null, null);
  assert.ok(summary.totals.done >= 1);
  assert.ok(summary.taskTypes.departure?.done);
});
