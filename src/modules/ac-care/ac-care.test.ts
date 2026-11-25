import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ModuleRequestError } from '../../core/module-rpc';
import { createLiveAcCareApi, parseHistory, parseUnits } from './live-api';
import type { ServiceInput } from './types';
import {
  defaultIntervals,
  dueTasks,
  parseNumber,
  parseUnitLines,
  previewReasons,
  validateService,
  validateUnit,
} from './validation';

const hotel = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const unitId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const row = {
  id: unitId,
  hotel_id: hotel,
  department_id: 'd',
  department_name: 'Engineering',
  code: '512-A',
  location: 'Room 512',
  area: 'Floor 5',
  unit_type: 'split',
  brand: 'Daikin',
  capacity: '1.5 PK',
  refrigerant: 'r32',
  rated_current: 5.5,
  installed_on: '2022-03-01',
  warranty_until: null,
  filter_days: 21,
  routine_days: 90,
  major_days: 0,
  annual_days: 365,
  condition: 'normal',
  archived: false,
  version: 1,
  area_mine: true,
  complaints_60d: 0,
  refills_90d: 0,
  last_service: null,
  schedule: [
    { type: 'filter', interval_days: 21, last_done_at: null, due_on: '2026-11-20', work: null },
    {
      type: 'routine',
      interval_days: 90,
      last_done_at: '2026-10-01T02:00:00Z',
      due_on: '2026-12-30',
      work: {
        state: 'claimed',
        user_email: 'tech@example.com',
        mine: false,
        note: '',
        at: '2026-11-25T01:00:00Z',
        expires_at: '2026-11-25T09:00:00Z',
        assigned: true,
      },
    },
  ],
};
const unitInput = {
  code: '512-a',
  location: 'Room 512',
  area: '',
  unitType: 'split' as const,
  brand: '',
  capacity: '',
  refrigerant: 'r32' as const,
  ratedCurrent: null,
  installedOn: '',
  warrantyUntil: '',
  intervals: { ...defaultIntervals },
};
const service = (extra: Partial<ServiceInput> = {}): ServiceInput => ({
  serviceType: 'routine',
  items: { filter: 'ok', evaporator: 'ok', drain: 'ok', noise: 'ok' },
  returnTemp: 25,
  supplyTemp: 15,
  pressurePsi: null,
  currentAmp: null,
  refrigerantAdded: false,
  notes: '',
  ...extra,
});

test('unit validation and import parsing mirror the server rules', () => {
  assert.deepEqual(validateUnit(unitInput), {});
  assert.deepEqual(
    validateUnit({
      ...unitInput,
      code: '#1',
      location: ' ',
      intervals: { ...defaultIntervals, filter: 800 },
    }),
    { code: 'invalidCode', location: 'required', filter: 'invalidInterval' },
  );
  const parsed = parseUnitLines(
    '512-a\tRoom 512\tFloor 5\tcassette\tDaikin\t2 PK\tR-410A\n\nX; Lobby\n#; bad\n9, Hall, , window',
  );
  assert.deepEqual(parsed.invalid, [4, 5]);
  assert.equal(parsed.rows[0].code, '512-A');
  assert.equal(parsed.rows[0].unitType, 'cassette');
  assert.equal(parsed.rows[0].refrigerant, 'r410a');
  assert.equal(parsed.rows[1].refrigerant, 'r32');
  assert.equal(parseNumber('12,5'), 12.5);
  assert.equal(parseNumber(''), null);
  assert.equal(parseNumber('abc'), undefined);
});

test('service validation asks for readings and notes before the server does', () => {
  const unit = { refrigerant: 'r22' as const, ratedCurrent: 5 };
  assert.deepEqual(validateService(service(), unit), {});
  assert.equal(
    validateService(service({ returnTemp: null, supplyTemp: null }), unit).temperatures,
    'readingsRequired',
  );
  assert.equal(validateService(service({ items: { filter: 'ok' } }), unit).items, 'required');
  assert.deepEqual(
    previewReasons(unit, service({ supplyTemp: 20, pressurePsi: 120, currentAmp: 6 })),
    ['temperature-drop', 'pressure', 'current'],
  );
  assert.equal(validateService(service({ supplyTemp: 20 }), unit).notes, 'notesRequired');
  const major = validateService(service({ serviceType: 'major' }), unit);
  assert.equal(major.pressurePsi, 'readingsRequired');
  assert.equal(major.items, 'required');
});

test('due tasks keep the larger service and sort the most urgent first', () => {
  const [unit] = parseUnits([row], hotel);
  assert.deepEqual(
    dueTasks([unit], '2026-11-25').map((task) => [task.entry.type, task.bucket, task.daysLeft]),
    [['filter', 'overdue', -5]],
  );
  const sameDay = { ...unit, schedule: unit.schedule.map((e) => ({ ...e, dueOn: '2026-11-27' })) };
  assert.deepEqual(
    dueTasks([sameDay], '2026-11-25').map((task) => task.entry.type),
    ['routine'],
  );
});

test('unit and history responses are validated before display', () => {
  const [unit] = parseUnits([row], hotel);
  assert.equal(unit.schedule[1].work?.assigned, true);
  assert.equal(unit.intervals.major, 0);
  assert.throws(() => parseUnits([{ ...row, hotel_id: 'other' }], hotel), ModuleRequestError);
  assert.throws(() => parseUnits([{ ...row, condition: 'gone' }], hotel), ModuleRequestError);
  assert.throws(
    () => parseUnits([{ ...row, schedule: [{ ...row.schedule[0], due_on: 'soon' }] }], hotel),
    ModuleRequestError,
  );
  const page = parseHistory(
    [
      {
        kind: 'service',
        id: unitId,
        at: '2026-11-25T01:00:00Z',
        by_email: 'tech@example.com',
        service_type: 'filter',
        items: { filter: 'ok' },
        return_temp: null,
        supply_temp: null,
        pressure_psi: null,
        current_amp: null,
        refrigerant_added: false,
        result: 'normal',
        reasons: [],
        notes: '',
      },
    ],
    { nextCursor: { at: '2026-11-25T01:00:00Z', id: unitId } },
  );
  assert.equal(page.nextCursor?.id, unitId);
  assert.throws(
    () => parseHistory([{ kind: 'service', id: unitId, at: 'x', by_email: '' }], {}),
    ModuleRequestError,
  );
  assert.throws(() => parseHistory([], { nextCursor: 'bad' }), ModuleRequestError);
});

test('live API sends canonical unit input', async () => {
  const calls: [string, Record<string, unknown>][] = [];
  const api = createLiveAcCareApi(async (name, args) => {
    calls.push([name, args]);
    return { data: { id: unitId, version: 1 } };
  });
  await api.saveUnit(hotel, 'd', { ...unitInput, location: ' Room 512 ' });
  assert.equal(calls[0][0], 'ac_care_unit_save');
  assert.deepEqual(calls[0][1].p_input, {
    code: '512-A',
    location: 'Room 512',
    area: '',
    unitType: 'split',
    brand: '',
    capacity: '',
    refrigerant: 'r32',
    ratedCurrent: null,
    installedOn: '',
    warrantyUntil: '',
    filterDays: 21,
    routineDays: 90,
    majorDays: 180,
    annualDays: 365,
  });
  await assert.rejects(
    api.listUnits(hotel, null, false),
    (error: unknown) => error instanceof ModuleRequestError && error.code === 'INVALID_RESPONSE',
  );
});
