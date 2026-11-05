import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

type AuditRow = { action: string; outcome: string; department_name: string | null };
type RpcResult = { data?: AuditRow[]; error?: string };

test('the platform audit reader returns only platform events to developers', async () => {
  const db = new PGlite();
  const developer = '11111111-1111-4111-8111-111111111111',
    staff = '22222222-2222-4222-8222-222222222222';
  const hotel = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    frontOffice = 'aaaaaaaa-1111-4111-8111-111111111111';
  try {
    await db.exec(
      `create role anon;create role authenticated;create role service_role;create schema auth;
       create table auth.users(id uuid primary key,email text unique,created_at timestamptz default now(),last_sign_in_at timestamptz,banned_until timestamptz);
       create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
       grant usage on schema auth to anon,authenticated,service_role;`,
    );
    for (const migration of [
      '202611010001_vault_metadata',
      '202611010002_audit_visibility',
      '202611040001_module_access',
      '202611040002_vehicle_checklist',
      '202611040003_bin_card',
      '202611040006_module_switch',
      '202611040007_user_admin',
      '202611050001_platform_audit',
    ])
      await db.exec(await readFile('supabase/migrations/' + migration + '.sql', 'utf8'));
    await db.query('insert into auth.users(id,email) values ($1,$2),($3,$4)', [
      developer,
      'dev@example.com',
      staff,
      'staff@example.com',
    ]);
    await db.query("insert into public.workstel_hotels values ($1,'Hotel')", [hotel]);
    await db.query(
      "insert into public.workstel_departments(id,hotel_id,code,name) values ($1,$2,'front-office','Front Office')",
      [frontOffice, hotel],
    );
    await db.query('insert into workstel_private.platform_admins(user_id) values ($1)', [
      developer,
    ]);
    // A module event and a platform event; only the platform one may reach the admin reader.
    await db.query(
      `insert into workstel_private.audit_events(actor_id,hotel_id,department_id,action,outcome)
       values ($1,$2,$3,'vault.account.create','success'),($1,$2,$3,'platform.user.membership','success')`,
      [developer, hotel, frontOffice],
    );
    async function as(user: string) {
      await db.exec('reset role');
      await db.query("select set_config('request.jwt.claim.sub',$1,false)", [user]);
      await db.exec('set role authenticated');
    }
    async function rpc(limit: number | null = 100): Promise<RpcResult> {
      const result = await db.query<{ r: RpcResult }>(
        'select public.workstel_admin_list_audit($1) as r',
        [limit],
      );
      return result.rows[0].r;
    }

    await as(staff);
    assert.equal((await rpc()).error, 'ACCESS_DENIED');

    await as(developer);
    assert.equal((await rpc(0)).error, 'INVALID_INPUT');
    assert.equal((await rpc(101)).error, 'INVALID_INPUT');
    const events = (await rpc()).data ?? [];
    assert.ok(events.length > 0);
    assert.ok(events.every((event) => event.action.startsWith('platform.')));
    assert.ok(!events.some((event) => event.action.startsWith('vault.')));
    // The staff member's denied read is itself a platform event.
    assert.ok(
      events.some((event) => event.action === 'platform.audit.read' && event.outcome === 'denied'),
    );
    assert.equal(
      events.find((event) => event.action === 'platform.user.membership')?.department_name,
      'Front Office',
    );

    await db.exec('reset role');
    const reads = await db.query<{ outcome: string }>(
      "select outcome from workstel_private.audit_events where action='platform.audit.read' order by occurred_at",
    );
    assert.deepEqual(
      reads.rows.map((row) => row.outcome),
      ['denied', 'success'],
    );
  } finally {
    await db.close();
  }
});
