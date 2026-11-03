export const checklistItems = [
  'exterior',
  'tires',
  'lights',
  'brakes',
  'wipers',
  'horn',
  'interior',
  'air-conditioning',
  'documents',
  'safety-kit',
] as const;
export type ChecklistItem = (typeof checklistItems)[number];
export type ItemState = 'ok' | 'issue';
export const fuelLevels = ['empty', 'quarter', 'half', 'three-quarters', 'full'] as const;
export type FuelLevel = (typeof fuelLevels)[number];
export type InspectionResult = 'pass' | 'attention';
export type VehicleStatus = 'active' | 'archived';

export interface Vehicle {
  id: string;
  hotelId: string;
  departmentId: string;
  departmentName: string;
  name: string;
  plateNumber: string;
  status: VehicleStatus;
  version: number;
  lastInspectedAt: string | null;
  lastResult: InspectionResult | null;
  updatedAt: string;
}
export interface VehicleInput {
  name: string;
  plateNumber: string;
  departmentId: string;
}
export interface Inspection {
  id: string;
  vehicleId: string;
  inspectedAt: string;
  inspectorEmail: string;
  odometerKm: number | null;
  fuelLevel: FuelLevel;
  items: Record<ChecklistItem, ItemState>;
  result: InspectionResult;
  notes: string;
}
export interface InspectionInput {
  odometerKm: number | null;
  fuelLevel: FuelLevel;
  items: Record<ChecklistItem, ItemState>;
  notes: string;
}
export interface Page<T> {
  data: T[];
  nextCursor: string | null;
}
export interface VehicleQuery {
  hotelId: string;
  departmentId: string | null;
  status: VehicleStatus | 'all';
  search: string;
  after: string | null;
}
