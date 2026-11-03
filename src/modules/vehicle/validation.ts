import { checklistItems } from './types';
import type { ChecklistItem, InspectionInput, ItemState, VehicleInput } from './types';

export type VehicleField = 'name' | 'plateNumber' | 'departmentId';
export type InspectionField = 'odometerKm' | 'items' | 'notes';
export type ValidationError =
  'required' | 'tooLong' | 'invalidPlate' | 'invalidOdometer' | 'notesRequired';

/** Canonical plate form, matching the server: upper case with single spaces. */
export function normalizePlate(value: string) {
  return value.trim().replace(/\s+/g, ' ').toUpperCase();
}

export function validateVehicle(input: VehicleInput) {
  const errors: Partial<Record<VehicleField, ValidationError>> = {};
  if (!input.name.trim()) errors.name = 'required';
  else if (input.name.trim().length > 100) errors.name = 'tooLong';
  const plate = normalizePlate(input.plateNumber);
  if (!plate) errors.plateNumber = 'required';
  else if (!/^[A-Z0-9][A-Z0-9 -]{0,19}$/.test(plate)) errors.plateNumber = 'invalidPlate';
  if (!input.departmentId) errors.departmentId = 'required';
  return errors;
}

/** Parse the optional odometer text field; returns undefined when it is not a whole number. */
export function parseOdometer(value: string): number | null | undefined {
  const text = value.trim();
  if (!text) return null;
  return /^\d{1,7}$/.test(text) ? Number(text) : undefined;
}

export function validateInspection(
  input: Omit<InspectionInput, 'items' | 'odometerKm'> & {
    odometer: string;
    items: Partial<Record<ChecklistItem, ItemState>>;
  },
) {
  const errors: Partial<Record<InspectionField, ValidationError>> = {};
  if (parseOdometer(input.odometer) === undefined) errors.odometerKm = 'invalidOdometer';
  if (checklistItems.some((item) => !input.items[item])) errors.items = 'required';
  if (input.notes.length > 1000) errors.notes = 'tooLong';
  else if (hasIssue(input.items) && !input.notes.trim()) errors.notes = 'notesRequired';
  return errors;
}

export function hasIssue(items: Partial<Record<ChecklistItem, ItemState>>) {
  return checklistItems.some((item) => items[item] === 'issue');
}
