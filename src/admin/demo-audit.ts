import type { AuditEvent } from './audit-api';

/** Sample platform events for demo mode, held in memory only. */
export function demoAuditEvents(now = Date.now()): AuditEvent[] {
  const hotel = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const frontOffice = 'aaaaaaaa-1111-4111-8111-111111111111';
  const admin = '11111111-1111-4111-8111-111111111111';
  const staff = '22222222-2222-4222-8222-222222222222';
  const rows: [string, 'success' | 'denied', number, string | null, string | null][] = [
    ['platform.audit.read', 'success', 1, admin, null],
    ['platform.user.membership', 'success', 18, admin, staff],
    ['platform.module.documents.enable', 'success', 42, admin, null],
    ['platform.user.list', 'denied', 95, staff, null],
    ['platform.user.developer', 'success', 240, admin, staff],
  ];
  return rows.map(([action, outcome, minutes, actor, resource], index) => {
    const scoped = action === 'platform.user.membership';
    return {
      id: `00000000-0000-4000-8000-00000000000${index + 1}`,
      actor_id: actor,
      actor_database_role: 'authenticated',
      hotel_id: scoped ? hotel : null,
      hotel_name: scoped ? 'Demo Hotel' : null,
      department_id: scoped ? frontOffice : null,
      department_name: scoped ? 'Front Office' : null,
      resource_id: resource,
      action,
      outcome,
      occurred_at: new Date(now - minutes * 60_000).toISOString(),
      correlation_id: `00000000-0000-4000-9000-00000000000${index + 1}`,
    };
  });
}
