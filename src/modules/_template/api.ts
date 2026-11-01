import type { CreateRecordInput, ModuleRecord, PageResult } from './types';
/** Implement with the shared authenticated API client once the backend is available.
 * The server derives hotel, department and actor context from the authenticated session.
 * Never trust client-supplied access scopes or write secrets into browser storage.
 */
export interface ModuleApi {
  list(input: {
    search?: string;
    cursor?: string;
    signal?: AbortSignal;
  }): Promise<PageResult<ModuleRecord>>;
  create(input: CreateRecordInput): Promise<ModuleRecord>;
}
