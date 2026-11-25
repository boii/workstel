import { serviceTypes } from './types';
import type {
  AcUnit,
  AttentionReason,
  ChecklistItem,
  ImportRow,
  ScheduleEntry,
  ServiceInput,
  ServiceType,
  UnitInput,
  UnitType,
} from './types';

export type UnitField =
  'code' | 'location' | 'area' | 'brand' | 'capacity' | 'ratedCurrent' | ServiceType;
export type ServiceField = 'items' | 'temperatures' | 'pressurePsi' | 'currentAmp' | 'notes';
export type ValidationError =
  | 'required'
  | 'tooLong'
  | 'invalidCode'
  | 'invalidInterval'
  | 'invalidNumber'
  | 'readingsRequired'
  | 'notesRequired';

export const defaultIntervals: Record<ServiceType, number> = {
  filter: 21,
  routine: 90,
  major: 180,
  annual: 365,
};

/** Same rules as the server. Codes are stored in upper case. */
export const normalizeCode = (value: string) => value.trim().toUpperCase();
export const isCode = (value: string) => /^[A-Z0-9][A-Z0-9 ./-]{0,19}$/.test(normalizeCode(value));

export function validateUnit(input: UnitInput) {
  const errors: Partial<Record<UnitField, ValidationError>> = {};
  if (!input.code.trim()) errors.code = 'required';
  else if (!isCode(input.code)) errors.code = 'invalidCode';
  if (!input.location.trim()) errors.location = 'required';
  else if (input.location.trim().length > 80) errors.location = 'tooLong';
  if (input.area.trim().length > 40) errors.area = 'tooLong';
  if (input.brand.trim().length > 40) errors.brand = 'tooLong';
  if (input.capacity.trim().length > 20) errors.capacity = 'tooLong';
  if (input.ratedCurrent !== null && !(input.ratedCurrent >= 0.1 && input.ratedCurrent <= 999.9))
    errors.ratedCurrent = 'invalidNumber';
  for (const type of serviceTypes) {
    const days = input.intervals[type];
    if (!Number.isInteger(days) || days < 0 || days > 730) errors[type] = 'invalidInterval';
  }
  return errors;
}

/** Parses an optional decimal field (comma or dot). Returns undefined when it is not a number. */
export function parseNumber(value: string): number | null | undefined {
  const text = value.trim().replace(',', '.');
  if (!text) return null;
  return /^\d{1,4}(\.\d)?$/.test(text) ? Number(text) : undefined;
}

const typeWords: Record<string, UnitType> = {
  split: 'split',
  'split wall': 'split',
  cassette: 'cassette',
  kaset: 'cassette',
  standing: 'standing',
  floor: 'standing',
  ceiling: 'ceiling',
  'ceiling suspended': 'ceiling',
  vrf: 'vrf',
  vrv: 'vrf',
  fcu: 'fcu',
  ahu: 'ahu',
  other: 'other',
  lainnya: 'other',
};
const refrigerantWords: Record<string, ImportRow['refrigerant']> = {
  r32: 'r32',
  r410a: 'r410a',
  r410: 'r410a',
  r22: 'r22',
  other: 'other',
  lainnya: 'other',
};

/** Parses pasted lines of "code, location, area, type, brand, capacity, refrigerant"
 * (tab, comma or semicolon separated). Only code and location are required. */
export function parseUnitLines(text: string) {
  const rows: ImportRow[] = [];
  const invalid: number[] = [];
  text.split(/\r?\n/).forEach((line, index) => {
    if (!line.trim()) return;
    const [code = '', location = '', area = '', type = '', brand = '', capacity = '', gas = ''] =
      line.split(/\t|;|,/).map((part) => part.trim());
    const typeKey = type.toLowerCase();
    const gasKey = gas.toLowerCase().replace(/[\s-]/g, '');
    const unitType = typeKey ? typeWords[typeKey] : 'split';
    const refrigerant = gasKey ? refrigerantWords[gasKey] : 'r32';
    const row = {
      code: normalizeCode(code),
      location,
      area,
      unitType,
      brand,
      capacity,
      refrigerant,
    };
    const errors = validateUnit({
      ...row,
      unitType: unitType ?? 'other',
      refrigerant: refrigerant ?? 'other',
      ratedCurrent: null,
      installedOn: '',
      warrantyUntil: '',
      intervals: defaultIntervals,
    });
    if (!unitType || !refrigerant || Object.keys(errors).length) invalid.push(index + 1);
    else rows.push(row as ImportRow);
  });
  return { rows, invalid };
}

const itemsByType: Record<ServiceType, readonly ChecklistItem[]> = {
  filter: ['filter'],
  routine: ['filter', 'evaporator', 'drain', 'noise'],
  major: ['filter', 'evaporator', 'drain', 'noise', 'condenser', 'leak'],
  annual: [
    'filter',
    'evaporator',
    'drain',
    'noise',
    'condenser',
    'leak',
    'electrical',
    'mounting',
    'insulation',
  ],
};
export const serviceItems = (type: ServiceType) => itemsByType[type];
/** Readings each kind requires; the others are optional. */
export const needsTemperatures = (type: ServiceType) => type !== 'filter';
export const needsPressureAndCurrent = (type: ServiceType) => type === 'major';

const pressureRange: Partial<Record<AcUnit['refrigerant'], [number, number]>> = {
  r32: [100, 150],
  r410a: [100, 150],
  r22: [55, 80],
};
export const pressureRangeFor = (refrigerant: AcUnit['refrigerant']) => pressureRange[refrigerant];
export const temperatureDropRange = [8, 14] as const;

/** The reasons the server will give for "needs attention", so the form can ask for notes first.
 * The server decides the saved result; repeat refills are known only to the server. */
export function previewReasons(
  unit: Pick<AcUnit, 'refrigerant' | 'ratedCurrent'>,
  input: ServiceInput,
) {
  const reasons: AttentionReason[] = [];
  if (Object.values(input.items).includes('issue')) reasons.push('item-issue');
  if (input.returnTemp !== null && input.supplyTemp !== null) {
    const drop = input.returnTemp - input.supplyTemp;
    if (drop < temperatureDropRange[0] || drop > temperatureDropRange[1])
      reasons.push('temperature-drop');
  }
  const range = pressureRangeFor(unit.refrigerant);
  if (
    input.pressurePsi !== null &&
    range &&
    (input.pressurePsi < range[0] || input.pressurePsi > range[1])
  )
    reasons.push('pressure');
  if (
    input.currentAmp !== null &&
    unit.ratedCurrent !== null &&
    input.currentAmp > unit.ratedCurrent * 1.1
  )
    reasons.push('current');
  return reasons;
}

export function validateService(
  input: ServiceInput,
  unit: Pick<AcUnit, 'refrigerant' | 'ratedCurrent'>,
) {
  const errors: Partial<Record<ServiceField, ValidationError>> = {};
  if (serviceItems(input.serviceType).some((item) => !input.items[item])) errors.items = 'required';
  const temps = [input.returnTemp, input.supplyTemp];
  if (temps.some((value) => value !== null && (value < 0 || value > 50)))
    errors.temperatures = 'invalidNumber';
  else if ((input.returnTemp === null) !== (input.supplyTemp === null))
    errors.temperatures = 'readingsRequired';
  else if (needsTemperatures(input.serviceType) && input.returnTemp === null)
    errors.temperatures = 'readingsRequired';
  if (
    input.pressurePsi !== null &&
    (!Number.isInteger(input.pressurePsi) || input.pressurePsi > 700)
  )
    errors.pressurePsi = 'invalidNumber';
  else if (needsPressureAndCurrent(input.serviceType) && input.pressurePsi === null)
    errors.pressurePsi = 'readingsRequired';
  if (input.currentAmp !== null && input.currentAmp > 999.9) errors.currentAmp = 'invalidNumber';
  else if (needsPressureAndCurrent(input.serviceType) && input.currentAmp === null)
    errors.currentAmp = 'readingsRequired';
  if (input.notes.length > 1000) errors.notes = 'tooLong';
  else if (previewReasons(unit, input).length && !input.notes.trim())
    errors.notes = 'notesRequired';
  return errors;
}

/** Whole days from a to b (both YYYY-MM-DD). */
export function daysBetween(a: string, b: string) {
  return Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000);
}
export function addDays(day: string, days: number) {
  const date = new Date(day + 'T00:00:00Z');
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export type TaskBucket = 'overdue' | 'week' | 'upcoming';
export interface Task {
  unit: AcUnit;
  entry: ScheduleEntry;
  bucket: TaskBucket;
  /** Negative when overdue. */
  daysLeft: number;
}
/** Scheduled services due within 30 days, most urgent first. */
// Upcoming tasks are shown for planning; a technician takes a task only once it is overdue or due within 7 days.
export const canTake = (task: Pick<Task, 'bucket'>) => task.bucket !== 'upcoming';

export function dueTasks(units: AcUnit[], today: string, horizonDays = 30): Task[] {
  const tasks: Task[] = [];
  for (const unit of units) {
    if (unit.archived) continue;
    for (const entry of unit.schedule) {
      const daysLeft = daysBetween(today, entry.dueOn);
      if (daysLeft > horizonDays) continue;
      tasks.push({
        unit,
        entry,
        daysLeft,
        bucket: daysLeft < 0 ? 'overdue' : daysLeft <= 7 ? 'week' : 'upcoming',
      });
    }
  }
  // A larger service due at the same time covers the smaller one; keep only the largest.
  const largest = tasks.filter(
    (task) =>
      !tasks.some(
        (other) =>
          other.unit.id === task.unit.id &&
          serviceTypes.indexOf(other.entry.type) > serviceTypes.indexOf(task.entry.type) &&
          other.daysLeft <= task.daysLeft,
      ),
  );
  return largest.sort(
    (a, b) =>
      a.daysLeft - b.daysLeft ||
      a.unit.code.localeCompare(b.unit.code, undefined, { numeric: true }),
  );
}

/** The current calendar day at the hotel (Western Indonesia Time), as the server uses. */
export function hotelToday(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' }).format(now);
}
