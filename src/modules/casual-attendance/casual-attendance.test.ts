import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ModuleRequestError } from '../../core/module-rpc';
import { createDemoCasualAttendanceApi } from './demo-api';
import { parseDay, parsePeople, parseRecap, parseRecord } from './live-api';
import {
  addDays,
  canCheckInOn,
  correctionTimes,
  dayState,
  hotelClock,
  hotelInstant,
  hotelToday,
  isDate,
  lateMinutes,
  validateCorrection,
  validatePerson,
} from './validation';

const hotel = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const personId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const recordId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';

test('hotel times use Asia/Jakarta and night check-outs roll to the next day', () => {
  assert.equal(hotelInstant('2026-11-10', 7 * 60), '2026-11-10T00:00:00.000Z');
  assert.equal(hotelClock('2026-11-10T00:18:00.000Z'), '07:18');
  assert.equal(hotelToday(new Date('2026-11-10T18:00:00Z')), '2026-11-11');
  assert.deepEqual(correctionTimes('2026-11-10', { checkIn: '23:05', checkOut: '07:00' }), {
    checkIn: '2026-11-10T16:05:00.000Z',
    checkOut: '2026-11-11T00:00:00.000Z',
  });
  assert.equal(isDate('2026-02-30'), false);
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  assert.ok(canCheckInOn('2026-11-09', '2026-11-10'));
  assert.ok(!canCheckInOn('2026-11-08', '2026-11-10'));
});

test('late means more than five minutes after the shift start', () => {
  const base = { workDate: '2026-11-10', shift: 'morning' as const };
  assert.equal(lateMinutes({ ...base, checkIn: hotelInstant('2026-11-10', 7 * 60 + 5) }), 0);
  assert.equal(lateMinutes({ ...base, checkIn: hotelInstant('2026-11-10', 7 * 60 + 18) }), 18);
  assert.equal(lateMinutes({ ...base, checkIn: null }), 0);
  assert.equal(dayState(null), 'pending');
});

test('forms validate people and corrections like the server', () => {
  const person = {
    name: ' ',
    type: 'casual' as const,
    origin: '',
    departmentId: 'd',
    startDate: '2026-11-10',
    endDate: '2026-11-01',
    shift: 'morning' as const,
    notes: '',
  };
  assert.deepEqual(validatePerson(person), { name: 'required', endDate: 'endBeforeStart' });
  assert.deepEqual(validateCorrection({ checkIn: '7:10', checkOut: '', reason: '' }), {
    checkIn: 'invalidTime',
    reason: 'required',
  });
  assert.equal(
    validateCorrection({ checkIn: '07:00', checkOut: '06:00', reason: 'x' }).checkOut,
    'tooLongShift',
  );
});

test('responses are validated before display', () => {
  const row = {
    id: personId,
    hotel_id: hotel,
    department_id: 'd',
    department_name: 'Housekeeping',
    name: 'Rina',
    person_type: 'casual',
    origin: '',
    start_date: '2026-11-01',
    end_date: null,
    shift: 'morning',
    notes: '',
    status: 'active',
    version: 1,
    updated_at: '2026-11-10T00:00:00Z',
  };
  assert.equal(parsePeople([row], hotel)[0].type, 'casual');
  assert.throws(() => parsePeople([{ ...row, hotel_id: 'other' }], hotel));
  assert.throws(() => parsePeople([{ ...row, person_type: 'admin' }], hotel));
  const record = {
    id: recordId,
    person_id: personId,
    work_date: '2026-11-10',
    status: 'present',
    shift: 'morning',
    check_in: '2026-11-10T00:10:00Z',
    check_out: null,
    note: '',
    corrected: false,
    version: 1,
  };
  assert.equal(parseRecord(record, personId).checkIn, '2026-11-10T00:10:00Z');
  assert.throws(() => parseRecord({ ...record, check_in: null, check_out: 'x' }, personId));
  assert.throws(() => parseRecord(record, recordId));
  const day = parseDay([
    {
      id: personId,
      department_id: 'd',
      department_name: 'Housekeeping',
      name: 'Rina',
      person_type: 'casual',
      origin: '',
      shift: 'morning',
      record,
    },
  ]);
  assert.equal(day[0].record?.id, recordId);
  assert.throws(() =>
    parseRecap([
      {
        person_id: personId,
        name: 'R',
        origin: '',
        department_name: 'H',
        person_type: 'casual',
        present: -1,
        late: 0,
        leave: 0,
        sick: 0,
        absent: 0,
        minutes: 0,
      },
    ]),
  );
});

test('demo API mirrors the server marking rules', async () => {
  const api = createDemoCasualAttendanceApi(() => new Date('2026-11-10T03:00:00Z'));
  const today = '2026-11-10';
  const rows = await api.listDay({
    hotelId: 'demo-hotel',
    departmentId: 'housekeeping',
    day: today,
  });
  const rina = rows.find((row) => row.person.name === 'Rina Kartika')!;
  assert.equal(rina.record, null);
  const record = await api.mark('demo-hotel', rina.person.id, today, 'check_in', null);
  assert.equal(record?.status, 'present');
  await assert.rejects(
    api.mark('demo-hotel', rina.person.id, today, 'check_in', null),
    (error: unknown) => error instanceof ModuleRequestError && error.code === 'VERSION_CONFLICT',
  );
  await assert.rejects(
    api.mark('demo-hotel', rina.person.id, '2026-11-11', 'check_in', null),
    (error: unknown) => error instanceof ModuleRequestError && error.code === 'DAY_CLOSED',
  );
  assert.equal(await api.mark('demo-hotel', rina.person.id, today, 'reset', 1), null);
  await assert.rejects(
    api.recap(
      { hotelId: 'demo-hotel', departmentId: null, type: null, from: '2026-01-01', to: today },
      'view',
    ),
    (error: unknown) => error instanceof ModuleRequestError && error.code === 'RANGE_TOO_LONG',
  );
});
