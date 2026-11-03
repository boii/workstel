import type {
  Page,
  StockEntry,
  StockEntryInput,
  StockItem,
  StockItemInput,
  StockQuery,
} from './types';

/** Bin Card service contract. The server derives the actor from the session, checks
 * bin-card:read, bin-card:write and bin-card:manage per hotel department on every call,
 * and maintains balances under a row lock. */
export interface BinCardApi {
  listItems(query: StockQuery, signal?: AbortSignal): Promise<Page<StockItem>>;
  saveItem(
    hotelId: string,
    input: StockItemInput,
    existing?: Pick<StockItem, 'id' | 'version'>,
  ): Promise<void>;
  setArchived(hotelId: string, item: StockItem, archived: boolean): Promise<void>;
  recordEntry(
    hotelId: string,
    itemId: string,
    input: StockEntryInput,
    idempotencyKey: string,
  ): Promise<{ id: string; balance: number }>;
  listEntries(
    hotelId: string,
    itemId: string,
    before: string | null,
    signal?: AbortSignal,
  ): Promise<Page<StockEntry>>;
}
