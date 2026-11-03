import { ModuleRequestError, moduleRpc, parseCursor, uuidPattern } from '../../core/module-rpc';
import type { VehicleApi } from './api';
import { checklistItems, fuelLevels } from './types';
import type { Inspection, Vehicle } from './types';
import { normalizePlate } from './validation';

type Rpc = typeof moduleRpc;
const invalid = () => new ModuleRequestError('INVALID_RESPONSE');
const isText = (value: unknown): value is string => typeof value === 'string';
const isTime = (value: unknown): value is string =>
  isText(value) && !Number.isNaN(Date.parse(value));

export function parseVehicles(data: unknown, hotelId: string): Vehicle[] {
  if (!Array.isArray(data) || data.length > 100) throw invalid();
  return data.map((raw: Record<string, unknown>) => {
    if (
      !raw ||
      !['id', 'hotel_id', 'department_id', 'department_name', 'name', 'plate_number'].every((key) =>
        isText(raw[key]),
      ) ||
      raw.hotel_id !== hotelId ||
      !uuidPattern.test(String(raw.id)) ||
      !['active', 'archived'].includes(String(raw.status)) ||
      !Number.isInteger(raw.version) ||
      !isTime(raw.updated_at) ||
      !(raw.last_inspected_at === null || isTime(raw.last_inspected_at)) ||
      !(raw.last_result === null || ['pass', 'attention'].includes(String(raw.last_result)))
    )
      throw invalid();
    return {
      id: String(raw.id),
      hotelId,
      departmentId: String(raw.department_id),
      departmentName: String(raw.department_name),
      name: String(raw.name),
      plateNumber: String(raw.plate_number),
      status: raw.status as Vehicle['status'],
      version: Number(raw.version),
      lastInspectedAt: (raw.last_inspected_at as string | null) ?? null,
      lastResult: (raw.last_result as Vehicle['lastResult']) ?? null,
      updatedAt: String(raw.updated_at),
    };
  });
}

export function parseInspections(data: unknown, vehicleId: string): Inspection[] {
  if (!Array.isArray(data) || data.length > 50) throw invalid();
  return data.map((raw: Record<string, unknown>) => {
    const items = raw?.items as Record<string, unknown> | undefined;
    if (
      !raw ||
      !isText(raw.id) ||
      raw.vehicle_id !== vehicleId ||
      !isTime(raw.inspected_at) ||
      !(raw.inspector_email === null || isText(raw.inspector_email)) ||
      !(raw.odometer_km === null || Number.isInteger(raw.odometer_km)) ||
      !fuelLevels.includes(raw.fuel_level as never) ||
      !['pass', 'attention'].includes(String(raw.result)) ||
      !isText(raw.notes) ||
      !items ||
      typeof items !== 'object' ||
      Object.keys(items).length !== checklistItems.length ||
      !checklistItems.every((item) => items[item] === 'ok' || items[item] === 'issue')
    )
      throw invalid();
    return {
      id: raw.id,
      vehicleId,
      inspectedAt: String(raw.inspected_at),
      inspectorEmail: (raw.inspector_email as string | null) ?? '',
      odometerKm: (raw.odometer_km as number | null) ?? null,
      fuelLevel: raw.fuel_level as Inspection['fuelLevel'],
      items: items as Inspection['items'],
      result: raw.result as Inspection['result'],
      notes: raw.notes,
    };
  });
}

export function createLiveVehicleApi(rpc: Rpc = moduleRpc): VehicleApi {
  return {
    async listVehicles(query, signal) {
      const result = await rpc(
        'vehicle_list_units',
        {
          p_hotel_id: query.hotelId,
          p_department_id: query.departmentId,
          p_status: query.status,
          p_search: query.search.trim().slice(0, 100),
          p_after: query.after,
          p_limit: 50,
        },
        signal,
      );
      return {
        data: parseVehicles(result.data, query.hotelId),
        nextCursor: parseCursor(result.meta),
      };
    },
    async saveVehicle(hotelId, input, existing) {
      await rpc('vehicle_save_unit', {
        p_hotel_id: hotelId,
        p_department_id: input.departmentId,
        p_input: { name: input.name.trim(), plateNumber: normalizePlate(input.plateNumber) },
        p_unit_id: existing?.id ?? null,
        p_expected_version: existing?.version ?? null,
        p_action: 'save',
      });
    },
    async setArchived(hotelId, vehicle, archived) {
      await rpc('vehicle_save_unit', {
        p_hotel_id: hotelId,
        p_department_id: vehicle.departmentId,
        p_input: null,
        p_unit_id: vehicle.id,
        p_expected_version: vehicle.version,
        p_action: archived ? 'archive' : 'restore',
      });
    },
    async recordInspection(hotelId, vehicleId, input, idempotencyKey) {
      const result = await rpc('vehicle_record_inspection', {
        p_hotel_id: hotelId,
        p_vehicle_id: vehicleId,
        p_input: { ...input, notes: input.notes.trim() },
        p_idempotency_key: idempotencyKey,
      });
      const data = result.data as Record<string, unknown> | null;
      if (!data || !isText(data.id) || !['pass', 'attention'].includes(String(data.result)))
        throw invalid();
      return { id: data.id, result: data.result as 'pass' | 'attention' };
    },
    async listInspections(hotelId, vehicleId, before, signal) {
      const result = await rpc(
        'vehicle_list_inspections',
        { p_hotel_id: hotelId, p_vehicle_id: vehicleId, p_before: before, p_limit: 20 },
        signal,
      );
      return {
        data: parseInspections(result.data, vehicleId),
        nextCursor: parseCursor(result.meta),
      };
    },
  };
}
