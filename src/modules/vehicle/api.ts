import type {
  Inspection,
  InspectionInput,
  InspectionResult,
  Page,
  Vehicle,
  VehicleInput,
  VehicleQuery,
} from './types';

/** Vehicle Checklist service contract. The server derives the actor from the session and
 * checks vehicle:read, vehicle:write and vehicle:manage per hotel department on every call. */
export interface VehicleApi {
  listVehicles(query: VehicleQuery, signal?: AbortSignal): Promise<Page<Vehicle>>;
  saveVehicle(
    hotelId: string,
    input: VehicleInput,
    existing?: Pick<Vehicle, 'id' | 'version'>,
  ): Promise<void>;
  setArchived(hotelId: string, vehicle: Vehicle, archived: boolean): Promise<void>;
  recordInspection(
    hotelId: string,
    vehicleId: string,
    input: InspectionInput,
    idempotencyKey: string,
  ): Promise<{ id: string; result: InspectionResult }>;
  listInspections(
    hotelId: string,
    vehicleId: string,
    before: string | null,
    signal?: AbortSignal,
  ): Promise<Page<Inspection>>;
}
