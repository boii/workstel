/** Service kinds from smallest to largest. A larger kind includes the smaller kinds' work. */
export const serviceTypes = ['filter', 'routine', 'major', 'annual'] as const;
export type ServiceType = (typeof serviceTypes)[number];
export const unitTypes = [
  'split',
  'cassette',
  'standing',
  'ceiling',
  'vrf',
  'fcu',
  'ahu',
  'other',
] as const;
export type UnitType = (typeof unitTypes)[number];
export const refrigerants = ['r32', 'r410a', 'r22', 'other'] as const;
export type Refrigerant = (typeof refrigerants)[number];
export const conditions = ['normal', 'attention', 'broken'] as const;
export type Condition = (typeof conditions)[number];
export const checklistItems = [
  'filter',
  'evaporator',
  'drain',
  'noise',
  'condenser',
  'leak',
  'electrical',
  'mounting',
  'insulation',
] as const;
export type ChecklistItem = (typeof checklistItems)[number];
export type ItemState = 'ok' | 'issue';
export const complaintKinds = ['not-cold', 'leak', 'noise', 'smell', 'not-on', 'other'] as const;
export type ComplaintKind = (typeof complaintKinds)[number];
export const attentionReasons = [
  'item-issue',
  'temperature-drop',
  'pressure',
  'current',
  'repeat-refill',
] as const;
export type AttentionReason = (typeof attentionReasons)[number];
export type WorkAction = 'claim' | 'release' | 'postpone' | 'assign';
export type ServiceResult = 'normal' | 'attention';

/** Who holds a scheduled service: claimed (for eight hours) or postponed with a note. */
export interface Work {
  state: 'claimed' | 'postponed';
  userEmail: string;
  mine: boolean;
  note: string;
  at: string;
  expiresAt: string | null;
  /** Claimed for the technician by a supervisor. */
  assigned: boolean;
}
export interface ScheduleEntry {
  type: ServiceType;
  intervalDays: number;
  lastDoneAt: string | null;
  /** Hotel calendar day (YYYY-MM-DD) the service is due. */
  dueOn: string;
  work: Work | null;
}
export interface AcUnit {
  id: string;
  hotelId: string;
  departmentId: string;
  departmentName: string;
  code: string;
  location: string;
  area: string;
  unitType: UnitType;
  brand: string;
  capacity: string;
  refrigerant: Refrigerant;
  ratedCurrent: number | null;
  installedOn: string | null;
  warrantyUntil: string | null;
  intervals: Record<ServiceType, number>;
  condition: Condition;
  archived: boolean;
  version: number;
  /** The caller is a technician of this unit's area. */
  areaMine: boolean;
  complaints60d: number;
  refills90d: number;
  lastService: { type: ServiceType; doneAt: string; result: ServiceResult } | null;
  schedule: ScheduleEntry[];
}
export interface UnitList {
  units: AcUnit[];
  /** Hotel calendar day on the server. */
  today: string;
  serverNow: string;
}
export interface UnitInput {
  code: string;
  location: string;
  area: string;
  unitType: UnitType;
  brand: string;
  capacity: string;
  refrigerant: Refrigerant;
  ratedCurrent: number | null;
  installedOn: string;
  warrantyUntil: string;
  intervals: Record<ServiceType, number>;
}
export type ImportRow = Pick<
  UnitInput,
  'code' | 'location' | 'area' | 'unitType' | 'brand' | 'capacity' | 'refrigerant'
>;
export interface ServiceInput {
  serviceType: ServiceType;
  items: Partial<Record<ChecklistItem, ItemState>>;
  returnTemp: number | null;
  supplyTemp: number | null;
  pressurePsi: number | null;
  currentAmp: number | null;
  refrigerantAdded: boolean;
  notes: string;
}
export interface ServiceOutcome {
  id: string;
  result: ServiceResult;
  reasons: AttentionReason[];
}
export type HistoryEntry =
  | {
      kind: 'service';
      id: string;
      at: string;
      byEmail: string;
      serviceType: ServiceType;
      items: Partial<Record<ChecklistItem, ItemState>>;
      returnTemp: number | null;
      supplyTemp: number | null;
      pressurePsi: number | null;
      currentAmp: number | null;
      refrigerantAdded: boolean;
      result: ServiceResult;
      reasons: AttentionReason[];
      notes: string;
    }
  | {
      kind: 'complaint';
      id: string;
      at: string;
      byEmail: string;
      complaint: ComplaintKind;
      notes: string;
    };
export interface HistoryCursor {
  at: string;
  id: string;
}
export interface HistoryPage {
  data: HistoryEntry[];
  nextCursor: HistoryCursor | null;
}
export interface Technician {
  userId: string;
  email: string;
}
export interface Area {
  area: string;
  units: number;
  members: (Technician & { backup: boolean })[];
}
export interface AreaList {
  areas: Area[];
  technicians: Technician[];
}
