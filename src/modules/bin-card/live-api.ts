import { ModuleRequestError, moduleRpc, parseCursor, uuidPattern } from '../../core/module-rpc';
import type { BinCardApi } from './api';
import { entryTypes, stockUnits } from './types';
import type { StockEntry, StockItem } from './types';
import { normalizeCode } from './validation';

type Rpc = typeof moduleRpc;
const invalid = () => new ModuleRequestError('INVALID_RESPONSE');
const isText = (value: unknown): value is string => typeof value === 'string';
const isTime = (value: unknown): value is string =>
  isText(value) && !Number.isNaN(Date.parse(value));
const isQuantity = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

export function parseItems(data: unknown, hotelId: string): StockItem[] {
  if (!Array.isArray(data) || data.length > 100) throw invalid();
  return data.map((raw: Record<string, unknown>) => {
    if (
      !raw ||
      !['id', 'hotel_id', 'department_id', 'department_name', 'code', 'name', 'location'].every(
        (key) => isText(raw[key]),
      ) ||
      raw.hotel_id !== hotelId ||
      !uuidPattern.test(String(raw.id)) ||
      !stockUnits.includes(raw.unit as never) ||
      !isQuantity(raw.min_quantity) ||
      !isQuantity(raw.balance) ||
      raw.balance < 0 ||
      !['active', 'archived'].includes(String(raw.status)) ||
      !Number.isInteger(raw.version) ||
      !isTime(raw.updated_at)
    )
      throw invalid();
    return {
      id: String(raw.id),
      hotelId,
      departmentId: String(raw.department_id),
      departmentName: String(raw.department_name),
      code: String(raw.code),
      name: String(raw.name),
      unit: raw.unit as StockItem['unit'],
      location: String(raw.location),
      minQuantity: raw.min_quantity,
      balance: raw.balance,
      status: raw.status as StockItem['status'],
      version: Number(raw.version),
      updatedAt: String(raw.updated_at),
    };
  });
}

export function parseEntries(data: unknown, itemId: string): StockEntry[] {
  if (!Array.isArray(data) || data.length > 50) throw invalid();
  return data.map((raw: Record<string, unknown>) => {
    if (
      !raw ||
      !isText(raw.id) ||
      raw.item_id !== itemId ||
      !entryTypes.includes(raw.entry_type as never) ||
      !isQuantity(raw.quantity) ||
      !isQuantity(raw.balance_after) ||
      !isText(raw.reference) ||
      !isText(raw.notes) ||
      !isTime(raw.created_at) ||
      !(raw.created_by_email === null || isText(raw.created_by_email))
    )
      throw invalid();
    return {
      id: raw.id,
      itemId,
      type: raw.entry_type as StockEntry['type'],
      quantity: raw.quantity,
      balanceAfter: raw.balance_after,
      reference: raw.reference,
      notes: raw.notes,
      createdAt: String(raw.created_at),
      createdByEmail: (raw.created_by_email as string | null) ?? '',
    };
  });
}

export function createLiveBinCardApi(rpc: Rpc = moduleRpc): BinCardApi {
  return {
    async listItems(query, signal) {
      const result = await rpc(
        'bin_card_list_items',
        {
          p_hotel_id: query.hotelId,
          p_department_id: query.departmentId,
          p_status: query.status,
          p_search: query.search.trim().slice(0, 150),
          p_low_only: query.lowOnly,
          p_after: query.after,
          p_limit: 50,
        },
        signal,
      );
      return { data: parseItems(result.data, query.hotelId), nextCursor: parseCursor(result.meta) };
    },
    async saveItem(hotelId, input, existing) {
      await rpc('bin_card_save_item', {
        p_hotel_id: hotelId,
        p_department_id: input.departmentId,
        p_input: {
          code: normalizeCode(input.code),
          name: input.name.trim(),
          unit: input.unit,
          location: input.location.trim(),
          minQuantity: input.minQuantity,
        },
        p_item_id: existing?.id ?? null,
        p_expected_version: existing?.version ?? null,
        p_action: 'save',
      });
    },
    async setArchived(hotelId, item, archived) {
      await rpc('bin_card_save_item', {
        p_hotel_id: hotelId,
        p_department_id: item.departmentId,
        p_input: null,
        p_item_id: item.id,
        p_expected_version: item.version,
        p_action: archived ? 'archive' : 'restore',
      });
    },
    async recordEntry(hotelId, itemId, input, idempotencyKey) {
      const result = await rpc('bin_card_record_entry', {
        p_hotel_id: hotelId,
        p_item_id: itemId,
        p_input: {
          type: input.type,
          quantity: input.quantity,
          reference: input.reference.trim(),
          notes: input.notes.trim(),
        },
        p_idempotency_key: idempotencyKey,
      });
      const data = result.data as Record<string, unknown> | null;
      if (!data || !isText(data.id) || !isQuantity(data.balance)) throw invalid();
      return { id: data.id, balance: data.balance };
    },
    async listEntries(hotelId, itemId, before, signal) {
      const result = await rpc(
        'bin_card_list_entries',
        { p_hotel_id: hotelId, p_item_id: itemId, p_before: before, p_limit: 20 },
        signal,
      );
      return { data: parseEntries(result.data, itemId), nextCursor: parseCursor(result.meta) };
    },
  };
}
