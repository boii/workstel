export const stockUnits = [
  'pcs',
  'box',
  'pack',
  'bottle',
  'roll',
  'set',
  'kg',
  'g',
  'l',
  'ml',
  'm',
] as const;
export type StockUnit = (typeof stockUnits)[number];
export const entryTypes = ['receipt', 'issue', 'adjustment'] as const;
export type EntryType = (typeof entryTypes)[number];
export type ItemStatus = 'active' | 'archived';
export type StockLevel = 'out' | 'low' | 'ok';

export interface StockItem {
  id: string;
  hotelId: string;
  departmentId: string;
  departmentName: string;
  code: string;
  name: string;
  unit: StockUnit;
  location: string;
  minQuantity: number;
  balance: number;
  status: ItemStatus;
  version: number;
  updatedAt: string;
}
export interface StockItemInput {
  code: string;
  name: string;
  unit: StockUnit;
  location: string;
  minQuantity: number;
  departmentId: string;
}
export interface StockEntry {
  id: string;
  itemId: string;
  type: EntryType;
  /** Signed change: positive adds stock, negative removes it. */
  quantity: number;
  balanceAfter: number;
  reference: string;
  notes: string;
  createdAt: string;
  createdByEmail: string;
}
export interface StockEntryInput {
  type: EntryType;
  /** Receipt/issue: amount moved. Adjustment: counted balance. */
  quantity: number;
  reference: string;
  notes: string;
}
export interface Page<T> {
  data: T[];
  nextCursor: string | null;
}
export interface StockQuery {
  hotelId: string;
  departmentId: string | null;
  status: ItemStatus | 'all';
  search: string;
  lowOnly: boolean;
  after: string | null;
}
