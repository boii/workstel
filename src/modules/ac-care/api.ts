import type {
  AcUnit,
  AreaList,
  ComplaintKind,
  HistoryCursor,
  HistoryPage,
  ImportRow,
  ServiceInput,
  ServiceOutcome,
  ServiceType,
  UnitInput,
  UnitList,
  WorkAction,
} from './types';

/** AC Care service contract. The server derives the actor from the session, takes all times
 * and due days from its own clock (Asia/Jakarta) and checks ac-care:read, :write and :manage per
 * hotel department. It also decides each service result from the readings. */
export interface AcCareApi {
  listUnits(
    hotelId: string,
    departmentId: string | null,
    includeArchived: boolean,
    signal?: AbortSignal,
  ): Promise<UnitList>;
  saveUnit(
    hotelId: string,
    departmentId: string,
    input: UnitInput,
    existing?: Pick<AcUnit, 'id' | 'version'>,
  ): Promise<void>;
  /** archive / restore, or mark broken / normal. */
  setUnitState(
    hotelId: string,
    unit: AcUnit,
    action: 'archive' | 'restore' | 'broken' | 'normal',
  ): Promise<void>;
  importUnits(
    hotelId: string,
    departmentId: string,
    rows: ImportRow[],
  ): Promise<{ added: number; skipped: number }>;
  setWork(
    hotelId: string,
    unit: AcUnit,
    type: ServiceType,
    action: WorkAction,
    options?: { note?: string; userId?: string },
  ): Promise<void>;
  recordService(
    hotelId: string,
    unit: AcUnit,
    input: ServiceInput,
    idempotencyKey: string,
  ): Promise<ServiceOutcome>;
  recordComplaint(
    hotelId: string,
    unit: AcUnit,
    kind: ComplaintKind,
    note: string,
    idempotencyKey: string,
  ): Promise<void>;
  unitHistory(
    hotelId: string,
    unit: AcUnit,
    before: HistoryCursor | null,
    signal?: AbortSignal,
  ): Promise<HistoryPage>;
  listAreas(hotelId: string, departmentId: string, signal?: AbortSignal): Promise<AreaList>;
  setAreaMember(
    hotelId: string,
    departmentId: string,
    area: string,
    userId: string,
    action: 'add' | 'remove',
    backup: boolean,
  ): Promise<void>;
}
