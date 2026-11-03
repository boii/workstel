import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ModuleRequestError } from '../../core/module-rpc';
import { createLiveVehicleApi, parseInspections, parseVehicles } from './live-api';
import { checklistItems } from './types';
import { normalizePlate, parseOdometer, validateInspection, validateVehicle } from './validation';

const hotel = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const vehicleId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const row = {
  id: vehicleId,
  hotel_id: hotel,
  department_id: 'd',
  department_name: 'Front Office',
  name: 'Toyota Hiace',
  plate_number: 'B 1234 XYZ',
  status: 'active',
  version: 1,
  last_inspected_at: null,
  last_result: null,
  updated_at: '2026-11-04T01:00:00Z',
};
const allOk = Object.fromEntries(checklistItems.map((item) => [item, 'ok']));

test('vehicle validation mirrors the server plate and checklist rules', () => {
  assert.equal(normalizePlate('  b 1234   xyz '), 'B 1234 XYZ');
  assert.deepEqual(validateVehicle({ name: ' ', plateNumber: 'B@1', departmentId: '' }), {
    name: 'required',
    plateNumber: 'invalidPlate',
    departmentId: 'required',
  });
  assert.equal(parseOdometer(''), null);
  assert.equal(parseOdometer('120450'), 120450);
  assert.equal(parseOdometer('12.5'), undefined);
  const base = { odometer: '', fuelLevel: 'full' as const, notes: '' };
  assert.equal(validateInspection({ ...base, items: { exterior: 'ok' } }).items, 'required');
  assert.equal(
    validateInspection({ ...base, items: { ...allOk, tires: 'issue' } }).notes,
    'notesRequired',
  );
  assert.deepEqual(validateInspection({ ...base, items: allOk }), {});
});

test('vehicle responses are validated before display', () => {
  assert.equal(parseVehicles([row], hotel)[0].plateNumber, 'B 1234 XYZ');
  assert.throws(() => parseVehicles([{ ...row, hotel_id: 'other' }], hotel), ModuleRequestError);
  assert.throws(() => parseVehicles([{ ...row, status: 'deleted' }], hotel), ModuleRequestError);
  const inspection = {
    id: 'i',
    vehicle_id: vehicleId,
    inspected_at: '2026-11-04T01:00:00Z',
    inspector_email: 'staff@example.com',
    odometer_km: 10,
    fuel_level: 'half',
    items: allOk,
    result: 'pass',
    notes: '',
  };
  assert.equal(parseInspections([inspection], vehicleId)[0].fuelLevel, 'half');
  assert.throws(
    () => parseInspections([{ ...inspection, items: { exterior: 'ok' } }], vehicleId),
    ModuleRequestError,
  );
});

test('live vehicle API sends canonical input and rejects bad cursors', async () => {
  const calls: [string, Record<string, unknown>][] = [];
  const api = createLiveVehicleApi(async (name, args) => {
    calls.push([name, args]);
    return { data: [row], meta: { nextCursor: name === 'vehicle_list_units' ? 'bad' : null } };
  });
  await api.saveVehicle(hotel, { name: ' Van ', plateNumber: 'b 1 c', departmentId: 'd' });
  assert.deepEqual(calls[0][1].p_input, { name: 'Van', plateNumber: 'B 1 C' });
  await assert.rejects(
    api.listVehicles({
      hotelId: hotel,
      departmentId: null,
      status: 'active',
      search: '',
      after: null,
    }),
    ModuleRequestError,
  );
});
