import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
test('private Vault ownership and explicit sharing are enforced by PostgreSQL', async (t) => {
  const db = new PGlite();
  const owner = '11111111-1111-4111-8111-111111111111',
    recipient = '22222222-2222-4222-8222-222222222222',
    admin = '33333333-3333-4333-8333-333333333333';
  const hotel = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    department = 'aaaaaaaa-1111-4111-8111-111111111111';
  try {
    await db.exec(
      `create role anon;create role authenticated;create schema auth;create table auth.users(id uuid primary key,email text unique);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema auth to anon,authenticated;`,
    );
    for (const migration of [
      '202611010001_vault_metadata',
      '202611010002_audit_visibility',
      '202611010003_private_vault',
    ])
      await db.exec(await readFile('supabase/migrations/' + migration + '.sql', 'utf8'));
    await db.query('insert into auth.users values ($1,$2),($3,$4),($5,$6)', [
      owner,
      'owner@example.com',
      recipient,
      'recipient@example.com',
      admin,
      'admin@example.com',
    ]);
    await db.query("insert into public.workstel_hotels values ($1,'Hotel')", [hotel]);
    await db.query(
      "insert into public.workstel_departments(id,hotel_id,code,name) values ($1,$2,'it','IT')",
      [department, hotel],
    );
    for (const user of [owner, recipient, admin])
      await db.query(
        'insert into workstel_private.staff_access(user_id,hotel_id,department_id,can_read,can_write,can_archive,can_audit) values ($1,$2,$3,true,true,true,true)',
        [user, hotel, department],
      );
    async function as(user: string) {
      await db.exec('reset role');
      await db.query("select set_config('request.jwt.claim.sub',$1,false)", [user]);
      await db.exec('set role authenticated');
    }
    async function rpc(name: string, args: unknown[] = []) {
      const result = await db.query<{
        r: {
          data?: Record<string, unknown> | Record<string, unknown>[];
          error?: string;
          meta?: Record<string, unknown>;
        };
      }>(
        'select public.' + name + '(' + args.map((_, i) => '$' + (i + 1)).join(',') + ') as r',
        args,
      );
      return result.rows[0].r;
    }
    await as(owner);
    assert.equal((await rpc('workstel_session')).meta?.vaultPolicy, 'private-v1');
    const input = JSON.stringify({
      name: 'Private account',
      username: 'personal',
      website: '',
      notes: '',
    });
    const created = await rpc('vault_write_metadata', [hotel, department, input]);
    const id = (created.data as Record<string, unknown>).id;
    await t.test(
      'creator owns records and department administrators cannot read or modify them',
      async () => {
        const own = await rpc('vault_list_accounts', [hotel]);
        assert.equal((own.data as Record<string, unknown>[])[0].owner_id, owner);
        assert.equal((own.data as Record<string, unknown>[])[0].is_owner, true);
        await as(admin);
        const hidden = await rpc('vault_list_accounts', [hotel]);
        assert.deepEqual(hidden.data, []);
        assert.equal(
          (await rpc('vault_write_metadata', [hotel, department, input, id, 1])).error,
          'ACCESS_DENIED',
        );
        assert.equal(
          (await rpc('vault_set_share', [hotel, id, 'recipient@example.com', 1])).error,
          'ACCESS_DENIED',
        );
      },
    );
    await t.test('exact email grant is owner-only, versioned and view-only', async () => {
      await as(owner);
      assert.equal(
        (await rpc('vault_set_share', [hotel, id, 'recipient@example.com', 0])).error,
        'VERSION_CONFLICT',
      );
      assert.equal(
        (await rpc('vault_set_share', [hotel, id, 'missing@example.com', 1])).error,
        'RECIPIENT_UNAVAILABLE',
      );
      assert.equal(
        (await rpc('vault_set_share', [hotel, id, 'RECIPIENT@example.com', 1])).error,
        undefined,
      );
      await as(recipient);
      const shared = (await rpc('vault_list_accounts', [hotel])).data as Record<string, unknown>[];
      assert.equal(shared.length, 1);
      assert.equal(shared[0].is_owner, false);
      assert.equal(shared[0].can_edit, false);
      assert.equal(shared[0].can_archive, false);
      assert.equal(
        (await rpc('vault_write_metadata', [hotel, department, input, id, 2])).error,
        'ACCESS_DENIED',
      );
      assert.equal((await rpc('vault_list_shares', [hotel, id])).error, 'ACCESS_DENIED');
      assert.equal(
        (await rpc('vault_set_share', [hotel, id, 'admin@example.com', 2])).error,
        'ACCESS_DENIED',
      );
    });
    await t.test(
      'revocation and disabled membership immediately remove server access',
      async () => {
        await db.exec('reset role');
        await db.query('update workstel_private.staff_access set enabled=false where user_id=$1', [
          recipient,
        ]);
        await as(recipient);
        assert.equal((await rpc('vault_list_accounts', [hotel])).error, 'ACCESS_DENIED');
        await db.exec('reset role');
        await db.query('update workstel_private.staff_access set enabled=true where user_id=$1', [
          recipient,
        ]);
        await as(owner);
        const shares = await rpc('vault_list_shares', [hotel, id]);
        assert.equal((shares.data as unknown[]).length, 1);
        await rpc('vault_set_share', [hotel, id, 'recipient@example.com', 2, 'revoke']);
        await as(recipient);
        assert.deepEqual((await rpc('vault_list_accounts', [hotel])).data, []);
      },
    );
    await t.test('audit failure rolls sharing back without expanding access', async () => {
      await db.exec(
        "reset role;create function workstel_private.fail_share_audit() returns trigger language plpgsql as $$begin if new.action like 'vault.share.%' then raise exception 'Audit unavailable';end if;return new;end$$;create trigger fail_share before insert on workstel_private.audit_events for each row execute function workstel_private.fail_share_audit();",
      );
      await as(owner);
      await assert.rejects(
        () => rpc('vault_set_share', [hotel, id, 'recipient@example.com', 3]),
        /Audit unavailable/,
      );
      await as(recipient);
      assert.deepEqual((await rpc('vault_list_accounts', [hotel])).data, []);
      await db.exec('reset role');
      const row = await db.query<{ version: number }>(
        'select version from public.vault_accounts where id=$1',
        [id],
      );
      assert.equal(row.rows[0].version, 3);
    });
  } finally {
    await db.close();
  }
});
