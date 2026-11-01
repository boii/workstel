import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

test('PostgreSQL Vault metadata enforces isolation, transactional audit and permissions', async (t) => {
  const db = new PGlite();
  try {
    await db.exec(`
 create role anon;create role authenticated;create schema auth;
 create table auth.users(id uuid primary key);
 create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
 grant usage on schema auth to authenticated,anon;
 grant execute on function auth.uid() to authenticated,anon;
 `);
    await db.exec(await readFile('supabase/migrations/202611010001_vault_metadata.sql', 'utf8'));
    await db.exec(await readFile('supabase/migrations/202611010002_audit_visibility.sql', 'utf8'));
    const user = '11111111-1111-4111-8111-111111111111',
      other = '22222222-2222-4222-8222-222222222222';
    const hotel = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      otherHotel = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
    const department = 'aaaaaaaa-1111-4111-8111-111111111111',
      otherDepartment = 'bbbbbbbb-1111-4111-8111-111111111111';
    await db.query('insert into auth.users values ($1),($2)', [user, other]);
    await db.query(
      "insert into public.workstel_hotels(id,name) values ($1,'Hotel A'),($2,'Hotel B')",
      [hotel, otherHotel],
    );
    await db.query(
      "insert into public.workstel_departments(id,hotel_id,code,name) values ($1,$2,'it','IT'),($3,$4,'it','IT')",
      [department, hotel, otherDepartment, otherHotel],
    );
    await db.query(
      'insert into workstel_private.staff_access(user_id,hotel_id,department_id,can_read,can_write,can_archive) values ($1,$2,$3,true,true,true)',
      [user, hotel, department],
    );
    const asUser = async () => {
      await db.exec('reset role');
      await db.query("select set_config('request.jwt.claim.sub',$1,false)", [user]);
      await db.exec('set role authenticated');
    };
    const result = async (sql: string, args: unknown[] = []) => {
      const response = await db.query<{ result: Record<string, unknown> }>(sql, args);
      return response.rows[0].result;
    };
    await asUser();
    await t.test('direct table reads and anonymous RPC calls are forbidden', async () => {
      await assert.rejects(
        () => db.query('select * from public.vault_accounts'),
        /permission denied/,
      );
      await db.exec('set role anon');
      await assert.rejects(() => db.query('select public.workstel_session()'), /permission denied/);
      await asUser();
    });
    await t.test('membership is scoped to the signed-in identity', async () => {
      const session = await result('select public.workstel_session() as result');
      assert.equal((session.data as unknown[]).length, 1);
    });
    let accountId = '';
    await t.test(
      'writes metadata with durable actor-bound audit and rejects secret fields',
      async () => {
        const created = await result(
          'select public.vault_write_metadata($1,$2,$3::jsonb) as result',
          [
            hotel,
            department,
            JSON.stringify({
              name: 'Sample',
              username: 'staff@example.com',
              website: 'https://portal.example.com',
              notes: '',
            }),
          ],
        );
        accountId = (created.data as { id: string }).id;
        assert.ok(accountId);
        const invalid = await result(
          'select public.vault_write_metadata($1,$2,$3::jsonb) as result',
          [
            hotel,
            department,
            JSON.stringify({ name: 'Unsafe', username: 'user', password: 'not-allowed' }),
          ],
        );
        assert.equal(invalid.error, 'INVALID_INPUT');
        await db.exec('reset role');
        const audit = await db.query<{ actor_id: string }>(
          "select actor_id from workstel_private.audit_events where resource_id=$1 and outcome='success'",
          [accountId],
        );
        assert.equal(audit.rows[0].actor_id, user);
        await asUser();
      },
    );
    await t.test(
      'cross-hotel and cross-department operations return denied and log denial',
      async () => {
        const denied = await result('select public.vault_list_accounts($1) as result', [
          otherHotel,
        ]);
        assert.equal(denied.error, 'ACCESS_DENIED');
        const write = await result(
          'select public.vault_write_metadata($1,$2,$3::jsonb,$4,1) as result',
          [
            otherHotel,
            otherDepartment,
            JSON.stringify({ name: 'Hijack', username: 'user' }),
            accountId,
          ],
        );
        assert.equal(write.error, 'ACCESS_DENIED');
        await db.exec('reset role');
        const audit = await db.query<{ count: number }>(
          "select count(*)::int as count from workstel_private.audit_events where outcome='denied'",
        );
        assert.ok(audit.rows[0].count >= 2);
        await asUser();
      },
    );
    await t.test(
      'stale updates are rejected and unauthorized staff see no account data',
      async () => {
        const conflict = await result(
          'select public.vault_write_metadata($1,$2,$3::jsonb,$4,99) as result',
          [hotel, department, JSON.stringify({ name: 'Changed', username: 'staff' }), accountId],
        );
        assert.equal(conflict.error, 'VERSION_CONFLICT');
        await db.exec('reset role');
        await db.query("select set_config('request.jwt.claim.sub',$1,false)", [other]);
        await db.exec('set role authenticated');
        const response = await result('select public.vault_list_accounts($1) as result', [hotel]);
        assert.equal(response.error, 'ACCESS_DENIED');
        await asUser();
      },
    );

    await t.test(
      'same-hotel department permissions and audit-reader scope are enforced',
      async () => {
        await db.exec('reset role');
        const isolated = 'cccccccc-1111-4111-8111-111111111111';
        await db.query(
          "insert into public.workstel_departments(id,hotel_id,code,name) values ($1,$2,'sales','Sales')",
          [isolated, hotel],
        );
        await asUser();
        const denied = await result('select public.vault_list_accounts($1,$2) as result', [
          hotel,
          isolated,
        ]);
        assert.equal(denied.error, 'ACCESS_DENIED');
        const auditDenied = await result('select public.vault_list_audit($1,$2) as result', [
          hotel,
          department,
        ]);
        assert.equal(auditDenied.error, 'ACCESS_DENIED');
        await db.exec('reset role');
        await db.query('update workstel_private.staff_access set can_audit=true where user_id=$1', [
          user,
        ]);
        await asUser();
        const auditAllowed = await result('select public.vault_list_audit($1,$2) as result', [
          hotel,
          department,
        ]);
        assert.ok(Array.isArray(auditAllowed.data));
        const list = auditAllowed.data as { department_id: string }[];
        assert.ok(list.every((event) => event.department_id === department));
        await db.exec('reset role');
        await db.query(
          'update workstel_private.staff_access set can_write=false where user_id=$1',
          [user],
        );
        await asUser();
        const deniedWrite = await result(
          'select public.vault_write_metadata($1,$2,$3::jsonb) as result',
          [hotel, department, JSON.stringify({ name: 'Denied', username: 'staff' })],
        );
        assert.equal(deniedWrite.error, 'ACCESS_DENIED');
        await db.exec('reset role');
        await db.query('update workstel_private.staff_access set can_write=true where user_id=$1', [
          user,
        ]);
        await asUser();
      },
    );

    await t.test(
      'hotel-wide audit events require explicit audit permission for every department',
      async () => {
        const partial = await result('select public.vault_list_audit($1) as result', [hotel]);
        assert.ok(
          (partial.data as { department_id: string | null }[]).every(
            (e) => e.department_id !== null,
          ),
        );
        await db.exec('reset role');
        const isolated = 'cccccccc-1111-4111-8111-111111111111';
        await db.query(
          'insert into workstel_private.staff_access(user_id,hotel_id,department_id,can_audit) values ($1,$2,$3,true)',
          [user, hotel, isolated],
        );
        await asUser();
        const full = await result('select public.vault_list_audit($1) as result', [hotel]);
        assert.ok(
          (full.data as { department_id: string | null }[]).some((e) => e.department_id === null),
        );
        const otherScope = await result('select public.vault_list_audit($1) as result', [
          otherHotel,
        ]);
        assert.equal(otherScope.error, 'ACCESS_DENIED');
        const limit = await result('select public.vault_list_audit($1,null,101) as result', [
          hotel,
        ]);
        assert.equal(limit.error, 'INVALID_INPUT');
      },
    );
    await t.test('disabled memberships block existing sessions and metadata requests', async () => {
      await db.exec('reset role');
      await db.query('update workstel_private.staff_access set enabled=false where user_id=$1', [
        user,
      ]);
      await asUser();
      const session = await result('select public.workstel_session() as result');
      assert.deepEqual(session.data, []);
      const list = await result('select public.vault_list_accounts($1) as result', [hotel]);
      assert.equal(list.error, 'ACCESS_DENIED');
      await db.exec('reset role');
      await db.query('update workstel_private.staff_access set enabled=true where user_id=$1', [
        user,
      ]);
      await asUser();
    });
    await t.test('audit records cannot be changed or truncated', async () => {
      await db.exec('reset role');
      await assert.rejects(
        () => db.query("update workstel_private.audit_events set outcome='success'"),
        /append-only/,
      );
      await assert.rejects(() => db.query('truncate workstel_private.audit_events'), /append-only/);
      await asUser();
    });
    await t.test('audit failure rolls the metadata transaction back', async () => {
      await db.exec(
        "reset role;create function workstel_private.simulate_audit_failure() returns trigger language plpgsql as $$begin raise exception 'Audit unavailable';end$$;create trigger test_fail_audit before insert on workstel_private.audit_events for each row execute function workstel_private.simulate_audit_failure()",
      );
      await asUser();
      await assert.rejects(
        () =>
          db.query('select public.vault_write_metadata($1,$2,$3::jsonb,$4,1)', [
            hotel,
            department,
            JSON.stringify({ name: 'Must roll back', username: 'staff' }),
            accountId,
          ]),
        /Audit unavailable/,
      );
      await db.exec('reset role');
      const record = await db.query<{ name: string; version: number }>(
        'select name,version from public.vault_accounts where id=$1',
        [accountId],
      );
      assert.equal(record.rows[0].name, 'Sample');
      assert.equal(record.rows[0].version, 1);
    });
  } finally {
    await db.close();
  }
});
