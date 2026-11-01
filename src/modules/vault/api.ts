import type { VaultEntry, VaultEntryInput, VaultStatus } from './types';
/** Metadata service contract. live-api.ts implements the authenticated Supabase RPC boundary.
 * Authenticate and authorize every method on the server; derive actor/hotel scopes there.
 * Secret writes and reveal use separate endpoints, never the metadata API.
 */
export interface VaultApi {
  list(input: {
    search?: string;
    departmentId?: string;
    status?: VaultStatus;
    cursor?: string;
    signal?: AbortSignal;
  }): Promise<{ data: VaultEntry[]; meta: { nextCursor: string | null } }>;
  create(input: VaultEntryInput): Promise<VaultEntry>;
  update(id: string, input: VaultEntryInput, expectedVersion: number): Promise<VaultEntry>;
  setStatus(id: string, status: VaultStatus, expectedVersion: number): Promise<VaultEntry>;
}
