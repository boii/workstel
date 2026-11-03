import { computed } from 'vue';
import { locale } from '../../../i18n';
import { ModuleRequestError } from '../../../core/module-rpc';
import en from '../locales/en';
import id from '../locales/id';
import type { ChecklistItem, FuelLevel } from '../types';

export function useVehicleMessages() {
  return computed(() => (locale.value === 'id' ? id : en));
}

export const itemKeys: Record<ChecklistItem, keyof typeof en> = {
  exterior: 'itemExterior',
  tires: 'itemTires',
  lights: 'itemLights',
  brakes: 'itemBrakes',
  wipers: 'itemWipers',
  horn: 'itemHorn',
  interior: 'itemInterior',
  'air-conditioning': 'itemAirConditioning',
  documents: 'itemDocuments',
  'safety-kit': 'itemSafetyKit',
};
export const fuelKeys: Record<FuelLevel, keyof typeof en> = {
  empty: 'fuelEmpty',
  quarter: 'fuelQuarter',
  half: 'fuelHalf',
  'three-quarters': 'fuelThreeQuarters',
  full: 'fuelFull',
};

const errorKeys: Record<string, keyof typeof en> = {
  ACCESS_DENIED: 'accessDenied',
  DUPLICATE_PLATE: 'duplicatePlate',
  VERSION_CONFLICT: 'versionConflict',
  VEHICLE_ARCHIVED: 'vehicleArchived',
  NOTES_REQUIRED: 'notesRequired',
};
/** Map a server error code to safe, localized copy; unknown failures stay generic. */
export function errorMessage(messages: Record<keyof typeof en, string>, error: unknown) {
  const code = error instanceof ModuleRequestError ? error.code : '';
  return messages[errorKeys[code] ?? 'loadError'];
}

export function formatKilometres(value: number) {
  return new Intl.NumberFormat(locale.value === 'id' ? 'id-ID' : 'en-GB').format(value);
}
/** Inspection times display in the hotel's time zone. */
export function formatTime(value: string) {
  return new Intl.DateTimeFormat(locale.value === 'id' ? 'id-ID' : 'en-GB', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Asia/Jakarta',
  }).format(new Date(value));
}
