import { ModuleRequestError } from '../../core/module-rpc';
import type { BinCardApi } from './api';
import type { StockEntry, StockItem } from './types';
import { entryDelta, normalizeCode } from './validation';

export const demoHotelId = 'demo-hotel';
export const demoDepartments = [
  { id: 'front-office', name: 'Front Office' },
  { id: 'engineering', name: 'Engineering' },
];

/** In-memory demo data that mirrors the server rules; it resets on reload. */
export function createDemoBinCardApi(): BinCardApi {
  const now = new Date().toISOString();
  const items: StockItem[] = [
    ['LIN-01', 'Bath towel', 'pcs', 'Linen room A', 40, 120, 'front-office'],
    ['AMN-02', 'Shampoo 30 ml', 'bottle', 'Store room 2', 100, 64, 'front-office'],
    ['ENG-11', 'LED bulb 9 W', 'pcs', 'Engineering store', 10, 0, 'engineering'],
    ['ENG-20', 'Pool chlorine', 'kg', 'Chemical store', 25, 82.5, 'engineering'],
  ].map(([code, name, unit, location, minQuantity, balance, departmentId], index) => ({
    id: 'demo-item-' + (index + 1),
    hotelId: demoHotelId,
    departmentId: String(departmentId),
    departmentName: demoDepartments.find((d) => d.id === departmentId)!.name,
    code: String(code),
    name: String(name),
    unit: unit as StockItem['unit'],
    location: String(location),
    minQuantity: Number(minQuantity),
    balance: Number(balance),
    status: 'active',
    version: 1,
    updatedAt: now,
  }));
  const entries: StockEntry[] = items
    .filter((item) => item.balance > 0)
    .map((item) => ({
      id: 'demo-entry-' + item.id,
      itemId: item.id,
      type: 'receipt',
      quantity: item.balance,
      balanceAfter: item.balance,
      reference: 'PO-1001',
      notes: '',
      createdAt: now,
      createdByEmail: 'demo.admin@example.com',
    }));
  const keys = new Map<string, { id: string; balance: number }>();
  const find = (id: string) => {
    const item = items.find((entry) => entry.id === id);
    if (!item) throw new ModuleRequestError('ACCESS_DENIED');
    return item;
  };
  return {
    async listItems(query) {
      const search = query.search.trim().toLowerCase();
      const data = items
        .filter(
          (item) =>
            (!query.departmentId || item.departmentId === query.departmentId) &&
            (query.status === 'all' || item.status === query.status) &&
            (!query.lowOnly || item.balance <= item.minQuantity) &&
            (!search ||
              (item.code + ' ' + item.name + ' ' + item.location).toLowerCase().includes(search)),
        )
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((item) => ({ ...item }));
      return { data, nextCursor: null };
    },
    async saveItem(_hotelId, input, existing) {
      const code = normalizeCode(input.code);
      if (
        items.some(
          (item) =>
            item.code === code &&
            item.departmentId === input.departmentId &&
            item.id !== existing?.id,
        )
      )
        throw new ModuleRequestError('DUPLICATE_CODE');
      const departmentName = demoDepartments.find((d) => d.id === input.departmentId)?.name ?? '';
      const fields = {
        code,
        name: input.name.trim(),
        unit: input.unit,
        location: input.location.trim(),
        minQuantity: input.minQuantity,
        departmentId: input.departmentId,
        departmentName,
        updatedAt: new Date().toISOString(),
      };
      if (!existing) {
        items.push({
          ...fields,
          id: crypto.randomUUID(),
          hotelId: demoHotelId,
          balance: 0,
          status: 'active',
          version: 1,
        });
        return;
      }
      const item = find(existing.id);
      if (item.version !== existing.version) throw new ModuleRequestError('VERSION_CONFLICT');
      const moved = entries.some((entry) => entry.itemId === item.id);
      if (moved && item.unit !== input.unit) throw new ModuleRequestError('UNIT_LOCKED');
      if (moved && item.departmentId !== input.departmentId)
        throw new ModuleRequestError('DEPARTMENT_LOCKED');
      Object.assign(item, fields, { version: item.version + 1 });
    },
    async setArchived(_hotelId, target, archived) {
      const item = find(target.id);
      if (item.version !== target.version) throw new ModuleRequestError('VERSION_CONFLICT');
      if (archived && item.balance !== 0) throw new ModuleRequestError('BALANCE_NOT_ZERO');
      Object.assign(item, { status: archived ? 'archived' : 'active', version: item.version + 1 });
    },
    async recordEntry(_hotelId, itemId, input, idempotencyKey) {
      const previous = keys.get(idempotencyKey);
      if (previous) return previous;
      const item = find(itemId);
      if (item.status !== 'active') throw new ModuleRequestError('ITEM_ARCHIVED');
      const delta = entryDelta(input.type, input.quantity, item.balance);
      if (input.type === 'adjustment' && delta === 0) throw new ModuleRequestError('NO_CHANGE');
      if (item.balance + delta < 0) throw new ModuleRequestError('INSUFFICIENT_STOCK');
      item.balance = Math.round((item.balance + delta) * 1000) / 1000;
      const entry: StockEntry = {
        id: crypto.randomUUID(),
        itemId,
        type: input.type,
        quantity: delta,
        balanceAfter: item.balance,
        reference: input.reference.trim(),
        notes: input.notes.trim(),
        createdAt: new Date().toISOString(),
        createdByEmail: 'demo.admin@example.com',
      };
      entries.unshift(entry);
      const saved = { id: entry.id, balance: item.balance };
      keys.set(idempotencyKey, saved);
      return saved;
    },
    async listEntries(_hotelId, itemId) {
      find(itemId);
      return {
        data: entries.filter((entry) => entry.itemId === itemId).map((entry) => ({ ...entry })),
        nextCursor: null,
      };
    },
  };
}
