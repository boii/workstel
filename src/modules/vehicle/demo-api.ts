import { ModuleRequestError } from '../../core/module-rpc';
import type { VehicleApi } from './api';
import { checklistItems } from './types';
import type { Inspection, Vehicle } from './types';
import { hasIssue, normalizePlate } from './validation';

export const demoHotelId = 'demo-hotel';
export const demoDepartments = [
  { id: 'front-office', name: 'Front Office' },
  { id: 'engineering', name: 'Engineering' },
];

/** In-memory demo data that mirrors the server rules; it resets on reload. */
export function createDemoVehicleApi(): VehicleApi {
  const now = Date.now();
  const allOk = Object.fromEntries(
    checklistItems.map((item) => [item, 'ok']),
  ) as Inspection['items'];
  const vehicles: Vehicle[] = [
    ['Toyota Hiace', 'B 1234 XYZ', 'front-office', now - 3 * 3600_000, 'pass'],
    ['Daihatsu Gran Max', 'B 5678 ABC', 'engineering', now - 26 * 3600_000, 'attention'],
    ['Toyota Innova', 'B 9012 DEF', 'front-office', null, null],
  ].map(([name, plateNumber, departmentId, at, result], index) => ({
    id: 'demo-vehicle-' + (index + 1),
    hotelId: demoHotelId,
    departmentId: String(departmentId),
    departmentName: demoDepartments.find((d) => d.id === departmentId)!.name,
    name: String(name),
    plateNumber: String(plateNumber),
    status: 'active',
    version: 1,
    lastInspectedAt: at ? new Date(Number(at)).toISOString() : null,
    lastResult: (result as Vehicle['lastResult']) ?? null,
    updatedAt: new Date(now).toISOString(),
  }));
  const inspections: Inspection[] = [
    {
      id: 'demo-inspection-1',
      vehicleId: 'demo-vehicle-1',
      inspectedAt: vehicles[0].lastInspectedAt!,
      inspectorEmail: 'demo.admin@example.com',
      odometerKm: 120450,
      fuelLevel: 'three-quarters',
      items: allOk,
      result: 'pass',
      notes: '',
    },
    {
      id: 'demo-inspection-2',
      vehicleId: 'demo-vehicle-2',
      inspectedAt: vehicles[1].lastInspectedAt!,
      inspectorEmail: 'demo.admin@example.com',
      odometerKm: 88210,
      fuelLevel: 'quarter',
      items: { ...allOk, tires: 'issue' },
      result: 'attention',
      notes: 'Rear left tire pressure low.',
    },
  ];
  const keys = new Map<string, { id: string; result: Inspection['result'] }>();
  const find = (id: string) => {
    const vehicle = vehicles.find((item) => item.id === id);
    if (!vehicle) throw new ModuleRequestError('ACCESS_DENIED');
    return vehicle;
  };
  return {
    async listVehicles(query) {
      const search = query.search.trim().toLowerCase();
      const data = vehicles
        .filter(
          (v) =>
            (!query.departmentId || v.departmentId === query.departmentId) &&
            (query.status === 'all' || v.status === query.status) &&
            (!search || (v.name + ' ' + v.plateNumber).toLowerCase().includes(search)),
        )
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((v) => ({ ...v }));
      return { data, nextCursor: null };
    },
    async saveVehicle(_hotelId, input, existing) {
      const plateNumber = normalizePlate(input.plateNumber);
      if (vehicles.some((v) => v.plateNumber === plateNumber && v.id !== existing?.id))
        throw new ModuleRequestError('DUPLICATE_PLATE');
      const departmentName = demoDepartments.find((d) => d.id === input.departmentId)?.name ?? '';
      if (!existing) {
        vehicles.push({
          id: crypto.randomUUID(),
          hotelId: demoHotelId,
          departmentId: input.departmentId,
          departmentName,
          name: input.name.trim(),
          plateNumber,
          status: 'active',
          version: 1,
          lastInspectedAt: null,
          lastResult: null,
          updatedAt: new Date().toISOString(),
        });
        return;
      }
      const vehicle = find(existing.id);
      if (vehicle.version !== existing.version) throw new ModuleRequestError('VERSION_CONFLICT');
      Object.assign(vehicle, {
        name: input.name.trim(),
        plateNumber,
        departmentId: input.departmentId,
        departmentName,
        version: vehicle.version + 1,
        updatedAt: new Date().toISOString(),
      });
    },
    async setArchived(_hotelId, target, archived) {
      const vehicle = find(target.id);
      if (vehicle.version !== target.version) throw new ModuleRequestError('VERSION_CONFLICT');
      Object.assign(vehicle, {
        status: archived ? 'archived' : 'active',
        version: vehicle.version + 1,
      });
    },
    async recordInspection(_hotelId, vehicleId, input, idempotencyKey) {
      const previous = keys.get(idempotencyKey);
      if (previous) return previous;
      const vehicle = find(vehicleId);
      if (vehicle.status !== 'active') throw new ModuleRequestError('VEHICLE_ARCHIVED');
      const result: Inspection['result'] = hasIssue(input.items) ? 'attention' : 'pass';
      if (result === 'attention' && !input.notes.trim())
        throw new ModuleRequestError('NOTES_REQUIRED');
      const inspection: Inspection = {
        id: crypto.randomUUID(),
        vehicleId,
        inspectedAt: new Date().toISOString(),
        inspectorEmail: 'demo.admin@example.com',
        odometerKm: input.odometerKm,
        fuelLevel: input.fuelLevel,
        items: { ...input.items },
        result,
        notes: input.notes.trim(),
      };
      inspections.unshift(inspection);
      Object.assign(vehicle, { lastInspectedAt: inspection.inspectedAt, lastResult: result });
      const saved = { id: inspection.id, result };
      keys.set(idempotencyKey, saved);
      return saved;
    },
    async listInspections(_hotelId, vehicleId) {
      find(vehicleId);
      return {
        data: inspections
          .filter((item) => item.vehicleId === vehicleId)
          .map((item) => ({ ...item })),
        nextCursor: null,
      };
    },
  };
}
