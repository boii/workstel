import { RequestError, authenticatedRpc } from '../core/authenticated-rpc';
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export { authenticatedRpc };
/** A platform audit event from workstel_admin_list_audit (platform.* actions only). */
export interface AuditEvent {
  id: string;
  actor_id: string | null;
  actor_database_role: string;
  hotel_id: string | null;
  hotel_name: string | null;
  department_id: string | null;
  department_name: string | null;
  resource_id: string | null;
  action: string;
  outcome: 'success' | 'denied';
  occurred_at: string;
  correlation_id: string;
}
export function parseAudit(data: unknown): AuditEvent[] {
  if (!Array.isArray(data) || data.length > 100) throw new RequestError('INVALID_RESPONSE');
  return data.map((raw) => {
    if (
      !raw ||
      !['id', 'actor_database_role', 'action', 'occurred_at', 'correlation_id'].every(
        (key) => typeof raw[key] === 'string',
      ) ||
      // The server already filters the namespace; reject anything else rather than show it.
      !raw.action.startsWith('platform.') ||
      !uuid.test(raw.id) ||
      !uuid.test(raw.correlation_id) ||
      !['actor_id', 'hotel_id', 'department_id', 'resource_id'].every(
        (key) => raw[key] === null || (typeof raw[key] === 'string' && uuid.test(raw[key])),
      ) ||
      !['hotel_name', 'department_name'].every(
        (key) => raw[key] === null || typeof raw[key] === 'string',
      ) ||
      !['success', 'denied'].includes(raw.outcome) ||
      !Number.isFinite(Date.parse(raw.occurred_at))
    )
      throw new RequestError('INVALID_RESPONSE');
    return {
      id: raw.id,
      actor_id: raw.actor_id,
      actor_database_role: raw.actor_database_role,
      hotel_id: raw.hotel_id,
      hotel_name: raw.hotel_name,
      department_id: raw.department_id,
      department_name: raw.department_name,
      resource_id: raw.resource_id,
      action: raw.action,
      outcome: raw.outcome,
      occurred_at: raw.occurred_at,
      correlation_id: raw.correlation_id,
    };
  });
}
