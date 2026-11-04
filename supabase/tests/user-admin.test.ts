import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

type RpcResult = {
  data?: Record<string, unknown> & Record<string, unknown>[];
  error?: string;
  meta?: Record<string, unknown>;
};

test('developers manage staff access through audited server functions', async (t) => {
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
    async function as(user: string) {
      await db.exec('reset role');
      await db.query("select set_config('request.jwt.claim.sub',$1,false)", [user]);
      await db.exec('set role authenticated');
    }
    async function rpc(name: string, args: unknown[] = []): Promise<RpcResult> {
      const result = await db.query<{ r: RpcResult }>(
        'select public.' + name + '(' + args.map((_, i) => '$' + (i + 1)).join(',') + ') as r',
        args,
      );
      return result.rows[0].r;
    }
    const full = JSON.stringify({
      enabled: true,
      canRead: true,
      canWrite: true,
      canArchive: false,
      canAudit: false,
    });

    await t.test('non-developers are denied and audited', async () => {
      await as(staff);
      assert.equal((await rpc('workstel_admin_list_users')).error, 'ACCESS_DENIED');
      assert.equal(
        (await rpc('workstel_admin_set_membership', [staff, frontOffice, full])).error,
        'ACCESS_DENIED',
      );
      assert.equal(
        (await rpc('workstel_admin_set_developer', [staff, true])).error,
        'ACCESS_DENIED',
      );
    });

    await t.test('developers set membership, Vault flags and module levels', async () => {
      await as(developer);
      assert.ok((await rpc('workstel_admin_set_membership', [staff, frontOffice, full])).data);
      assert.equal(
        (
          await rpc('workstel_admin_set_membership', [
            staff,
            frontOffice,
            JSON.stringify({ enabled: true, canRead: 'yes' }),
          ])
        ).error,
        'INVALID_INPUT',
      );
      assert.ok(
        (await rpc('workstel_admin_set_module_level', [staff, frontOffice, 'vehicle', 'write']))
          .data,
      );
      assert.equal(
        (await rpc('workstel_admin_set_module_level', [staff, frontOffice, 'sales-crm', 'read']))
          .error,
        'NOT_FOUND',
      );
      const listed = await rpc('workstel_admin_list_users');
      const row = (listed.data as Record<string, unknown>[]).find((u) => u.id === staff)!;
      assert.deepEqual(row.memberships, [
        {
          departmentId: frontOffice,
          enabled: true,
          canRead: true,
          canWrite: true,
          canArchive: false,
          canAudit: false,
        },
      ]);
      assert.deepEqual(row.moduleGrants, [
        { moduleId: 'vehicle', departmentId: frontOffice, level: 'write' },
      ]);
      assert.equal((listed.meta?.departments as unknown[]).length, 1);
      assert.deepEqual(listed.meta?.modules, ['bin-card', 'vehicle']);
      // The granted user now reaches the module through the normal access path.
      await as(staff);
      const access = await rpc('workstel_module_access');
      assert.equal((access.data as unknown[]).length, 1);
      assert.equal(access.meta?.mustChangePassword, false);
      await as(developer);
      assert.ok(
        (await rpc('workstel_admin_set_module_level', [staff, frontOffice, 'vehicle', 'none']))
          .data,
      );
      await as(staff);
      assert.deepEqual((await rpc('workstel_module_access')).data, []);
    });

    await t.test('developer role changes and self-lockout protection', async () => {
      await as(developer);
      assert.equal(
        (await rpc('workstel_admin_set_developer', [developer, false])).error,
        'SELF_LOCKOUT',
      );
      assert.ok((await rpc('workstel_admin_set_developer', [staff, true])).data);
      await as(staff);
      assert.equal((await rpc('workstel_module_access')).meta?.platformAdmin, true);
      await as(developer);
      assert.ok((await rpc('workstel_admin_set_developer', [staff, false])).data);
    });

    await t.test('service helpers are callable only by the service role', async () => {
      await as(developer);
      await assert.rejects(
        db.query('select public.workstel_user_admin_flag($1,true)', [staff]),
        /permission denied/,
      );
      await db.exec('reset role');
      await db.exec('set role service_role');
      await db.query('select public.workstel_user_admin_flag($1,true)', [staff]);
      await db.query("select public.workstel_user_admin_record($1,$2,'reset-password','success')", [
        developer,
        staff,
      ]);
      // Unknown actions are ignored rather than written into the platform namespace.
      await db.query("select public.workstel_user_admin_record($1,$2,'drop-table','success')", [
        developer,
        staff,
      ]);
      await as(staff);
      assert.equal((await rpc('workstel_module_access')).meta?.mustChangePassword, true);
    });

    await t.test('every change is audited under platform or staff namespaces', async () => {
      await db.exec('reset role');
      const events = (
        await db.query<{ action: string; outcome: string }>(
          "select action,outcome from workstel_private.audit_events where action like 'platform.user.%' or action like 'staff.%' or action like 'platform.admin.%' order by occurred_at",
        )
      ).rows.map((row) => row.action + ':' + row.outcome);
      for (const expected of [
        'platform.user.list:denied',
        'platform.user.membership:denied',
        'platform.user.developer:denied',
        'staff.access.insert:success',
        'staff.module-access.insert:success',
        'staff.module-access.delete:success',
        'platform.admin.insert:success',
        'platform.admin.delete:success',
        'platform.user.list:success',
        'platform.user.reset-password:success',
      ])
        assert.ok(events.includes(expected), expected);
      assert.ok(!events.some((event) => event.includes('drop-table')));
    });
  } finally {
    await db.close();
  }
});
