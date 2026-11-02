import { departmentIds } from './types';
import type { DepartmentId, VaultEntry } from './types';

export class VaultRequestError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}
export async function vaultRpc(name: string, args: Record<string, unknown>, signal?: AbortSignal) {
  const { getSupabase } = await import('../../auth/client');
  const request = getSupabase().rpc(name, args);
  const { data, error } = await (signal ? request.abortSignal(signal) : request);
  if (error)
    throw new VaultRequestError(
      error.code === 'PGRST301' || error.code === 'PGRST303' || error.code === '42501'
        ? 'ACCESS_DENIED'
        : 'REQUEST_FAILED',
    );
  if (!data || typeof data !== 'object') throw new VaultRequestError('INVALID_RESPONSE');
  if (data.error) throw new VaultRequestError(String(data.error));
  return data;
}
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export async function findAccount(
  hotelId: string,
  accountId: string,
  signal: AbortSignal,
  request = vaultRpc,
): Promise<VaultEntry | null> {
  if (!uuid.test(accountId)) return null;
  let cursor: string | null = null;
  const seen = new Set<string>();
  // Bound restoration work until the server offers a dedicated account-read RPC.
  for (let page = 0; page < 20; page++) {
    signal.throwIfAborted();
    const result = await request(
      'vault_list_accounts',
      {
        p_hotel_id: hotelId,
        p_department_id: null,
        p_status: 'all',
        p_search: '',
        p_after: cursor,
        p_limit: 100,
      },
      signal,
    );
    signal.throwIfAborted();
    const entries = parseEntries(result.data, hotelId);
    const entry = entries.find((item) => item.id === accountId);
    if (entry) return entry;
    const next = result.meta?.nextCursor;
    if (!next) return null;
    if (typeof next !== 'string' || !uuid.test(next) || seen.has(next)) {
      throw new VaultRequestError('INVALID_RESPONSE');
    }
    seen.add(next);
    cursor = next;
  }
  throw new VaultRequestError('REQUEST_FAILED');
}
export function parseEntries(data: unknown, hotelId: string): VaultEntry[] {
  if (!Array.isArray(data) || data.length > 100) throw new VaultRequestError('INVALID_RESPONSE');
  const ids = new Set<string>();
  return data.map((raw: Record<string, unknown>) => {
    if (
      !raw ||
      ![
        'id',
        'hotel_id',
        'department_code',
        'name',
        'username',
        'website',
        'notes',
        'created_at',
        'updated_at',
        'created_by',
        'updated_by',
      ].every((key) => typeof raw[key] === 'string') ||
      !uuid.test(String(raw.id)) ||
      raw.hotel_id !== hotelId ||
      !uuid.test(String(raw.owner_id)) ||
      !['is_owner', 'can_edit', 'can_archive'].every((key) => typeof raw[key] === 'boolean') ||
      ids.has(String(raw.id)) ||
      !departmentIds.includes(raw.department_code as DepartmentId) ||
      !['active', 'archived'].includes(String(raw.status)) ||
      !Number.isSafeInteger(raw.version) ||
      Number(raw.version) < 1 ||
      !Number.isFinite(Date.parse(String(raw.created_at))) ||
      !Number.isFinite(Date.parse(String(raw.updated_at)))
    )
      throw new VaultRequestError('INVALID_RESPONSE');
    ids.add(String(raw.id));
    return {
      id: String(raw.id),
      hotelId,
      ownerId: String(raw.owner_id),
      isOwner: raw.is_owner as boolean,
      canEdit: raw.can_edit as boolean,
      canArchive: raw.can_archive as boolean,
      departmentId: raw.department_code as DepartmentId,
      name: String(raw.name),
      username: String(raw.username),
      website: String(raw.website),
      notes: String(raw.notes),
      status: raw.status as 'active' | 'archived',
      version: Number(raw.version),
      createdAt: String(raw.created_at),
      updatedAt: String(raw.updated_at),
      createdBy: String(raw.created_by),
      updatedBy: String(raw.updated_by),
      references: [],
      secretStatus: 'not-connected',
    };
  });
}
export interface AuditEvent {
  id: string;
  actor_id: string | null;
  actor_database_role: string;
  hotel_id: string;
  department_id: string | null;
  resource_id: string | null;
  action: string;
  outcome: 'success' | 'denied';
  occurred_at: string;
  correlation_id: string;
}
export function parseAudit(data: unknown, hotelId: string): AuditEvent[] {
  if (!Array.isArray(data) || data.length > 100) throw new VaultRequestError('INVALID_RESPONSE');
  return data.map((raw) => {
    if (
      !raw ||
      raw.hotel_id !== hotelId ||
      !['id', 'actor_database_role', 'action', 'occurred_at', 'correlation_id'].every(
        (key) => typeof raw[key] === 'string',
      ) ||
      !uuid.test(raw.id) ||
      !uuid.test(raw.correlation_id) ||
      !['actor_id', 'department_id', 'resource_id'].every(
        (key) => raw[key] === null || (typeof raw[key] === 'string' && uuid.test(raw[key])),
      ) ||
      !['success', 'denied'].includes(raw.outcome) ||
      !Number.isFinite(Date.parse(raw.occurred_at))
    )
      throw new VaultRequestError('INVALID_RESPONSE');
    return {
      id: raw.id,
      actor_id: raw.actor_id,
      actor_database_role: raw.actor_database_role,
      hotel_id: hotelId,
      department_id: raw.department_id,
      resource_id: raw.resource_id,
      action: raw.action,
      outcome: raw.outcome,
      occurred_at: raw.occurred_at,
      correlation_id: raw.correlation_id,
    };
  });
}
