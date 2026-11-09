import type {
  Activity,
  ActivityInput,
  AccountInput,
  AccountQuery,
  Deal,
  DealInput,
  DealQuery,
  EntryReport,
  Page,
  SalesAccount,
  SalesSummary,
} from './types';

/** Sales CRM service contract. The server derives the actor from the session and checks
 * sales-crm:read, sales-crm:write and sales-crm:manage per hotel department. */
export interface SalesCrmApi {
  summary(
    hotelId: string,
    departmentId: string | null,
    signal?: AbortSignal,
  ): Promise<SalesSummary>;
  listAccounts(query: AccountQuery, signal?: AbortSignal): Promise<Page<SalesAccount>>;
  saveAccount(
    hotelId: string,
    input: AccountInput,
    existing?: Pick<SalesAccount, 'id' | 'version'>,
  ): Promise<void>;
  setAccountArchived(hotelId: string, account: SalesAccount, archived: boolean): Promise<void>;
  listDeals(query: DealQuery, signal?: AbortSignal): Promise<Page<Deal>>;
  saveDeal(
    hotelId: string,
    input: DealInput,
    existing?: Pick<Deal, 'id' | 'version'>,
  ): Promise<void>;
  listActivities(
    hotelId: string,
    accountId: string,
    dealId: string | null,
    after: string | null,
    signal?: AbortSignal,
  ): Promise<Page<Activity>>;
  /** The idempotency key makes a retried submit return the first activity. */
  logActivity(
    hotelId: string,
    accountId: string,
    input: ActivityInput,
    idempotencyKey: string,
  ): Promise<void>;
  /** Needs sales-crm:manage in every department covered; month is YYYY-MM. */
  entryReport(
    hotelId: string,
    departmentId: string | null,
    month: string,
    signal?: AbortSignal,
  ): Promise<EntryReport>;
}
