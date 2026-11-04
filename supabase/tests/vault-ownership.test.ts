import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

type RpcResult = {
  data?: Record<string, unknown> & Record<string, unknown>[];
  error?: string;
  meta?: Record<string, unknown>;
};

test('Vault ownership moves without losing passwords, and department shares are scoped', async (t) => {
  const db = new PGlite();
  const owner = '11111111-1111-4111-8111-111111111111',
    colleague = '22222222-2222-4222-8222-222222222222',
    reader = '33333333-3333-4333-8333-333333333333',
    outsider = '44444444-4444-4444-8444-444444444444',
    developer = '55555555-5555-4555-8555-555555555555';
  const hotel = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    frontOffice = 'aaaaaaaa-1111-4111-8111-111111111111',
    engineering = 'aaaaaaaa-2222-4222-8222-222222222222';
  const now = () => Math.floor(Date.now() / 1000);
  try {
    await db.exec(
      `create role anon;create role authenticated;create role service_role;create schema auth;create table auth.users(id uuid primary key,email text unique);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema auth to anon,authenticated;`,
    );
    for (const name of [
      '202611010001_vault_metadata',
      '202611010002_audit_visibility',
      '202611010003_private_vault',
      '202611010004_secret_boundary',
      '202611010005_local_encryption',
      '202611030001_module_audit_isolation',
      '202611040001_module_access',
      '202611040006_module_switch',
      '202611040008_vault_ownership',
    ])
      await db.exec(await readFile('supabase/migrations/' + name + '.sql', 'utf8'));
    const people: [string, string][] = [
      [owner, 'owner@example.com'],
      [colleague, 'colleague@example.com'],
      [reader, 'reader@example.com'],
      [outsider, 'outsider@example.com'],
      [developer, 'dev@example.com'],
    ];
    for (const [id, email] of people)
      await db.query('insert into auth.users values ($1,$2)', [id, email]);
    await db.query("insert into public.workstel_hotels values ($1,'Hotel')", [hotel]);
    await db.query(
      "insert into public.workstel_departments(id,hotel_id,code,name) values ($1,$3,'front-office','Front Office'),($2,$3,'engineering','Engineering')",
      [frontOffice, engineering, hotel],
    );
    const membership = (user: string, department: string, write: boolean) =>
      db.query(
        'insert into workstel_private.staff_access(user_id,hotel_id,department_id,can_read,can_write,can_archive) values ($1,$2,$3,true,$4,$4)',
        [user, hotel, department, write],
      );
    await membership(owner, frontOffice, true);
    await membership(colleague, frontOffice, true);
    await membership(reader, frontOffice, false);
    await membership(outsider, engineering, true);
    await membership(developer, engineering, false);
    await db.query('insert into workstel_private.platform_admins(user_id) values ($1)', [
      developer,
    ]);
    let currentRole = 'authenticated';
    async function as(user: string, role = 'authenticated') {
      await db.exec('reset role');
      await db.query("select set_config('request.jwt.claim.sub',$1,false)", [user]);
      await db.exec('set role ' + role);
      currentRole = role;
    }
    async function rpc(name: string, args: unknown[] = []): Promise<RpcResult> {
      const result = await db.query<{ r: RpcResult }>(
        'select public.' + name + '(' + args.map((_, i) => '$' + (i + 1)).join(',') + ') as r',
        args,
      );
      return result.rows[0].r;
    }
    const visible = async (user: string) => {
      await as(user);
      const listed = await rpc('vault_list_accounts', [hotel, null, 'all']);
      return ((listed.data ?? []) as Record<string, unknown>[]).map((row) => row.name);
    };
    await as(owner);
    const account = String(
      (
        await rpc('vault_write_metadata', [
          hotel,
          frontOffice,
          JSON.stringify({ name: 'Booking extranet', username: 'fo-team' }),
        ])
      ).data?.id,
    );
    await as(owner, 'service_role');
    assert.ok(
      (
        await rpc('vault_secret_commit', [
          owner,
          account,
          1,
          0,
          crypto.randomUUID(),
          'workstel:aesgcm:v1:k1:YWJj',
          now(),
        ])
      ).data,
    );
    // Reads the current row version as the superuser, then restores the caller's role.
    const version = async () => {
      await db.exec('reset role');
      const result = await db.query<{ v: number }>(
        'select version as v from public.vault_accounts where id=$1',
        [account],
      );
      await db.exec('set role ' + currentRole);
      return Number(result.rows[0].v);
    };

    await t.test('department shares give read access only to that department', async () => {
      assert.deepEqual(await visible(reader), []);
      await as(owner);
      assert.equal(
        (await rpc('vault_set_department_share', [hotel, account, frontOffice, 99])).error,
        'VERSION_CONFLICT',
      );
      assert.ok(
        (await rpc('vault_set_department_share', [hotel, account, frontOffice, await version()]))
          .data,
      );
      const shares = await rpc('vault_list_shares', [hotel, account]);
      assert.deepEqual(
        (shares.meta?.departments as Record<string, unknown>[]).map((d) => d.name),
        ['Front Office'],
      );
      assert.equal((shares.meta?.availableDepartments as unknown[]).length, 2);
      assert.deepEqual(await visible(reader), ['Booking extranet']);
      assert.deepEqual(await visible(outsider), []);
      await as(reader, 'service_role');
      assert.ok((await rpc('vault_secret_prepare', [reader, account, 'reveal', now()])).data);
      await as(reader);
      assert.equal(
        (await rpc('vault_set_department_share', [hotel, account, engineering, await version()]))
          .error,
        'ACCESS_DENIED',
      );
    });

    await t.test('owners transfer to colleagues who can write in the department', async () => {
      await as(owner);
      assert.equal(
        (
          await rpc('vault_transfer_owner', [
            hotel,
            account,
            'reader@example.com',
            await version(),
            false,
          ])
        ).error,
        'RECIPIENT_UNAVAILABLE',
      );
      assert.equal(
        (
          await rpc('vault_transfer_owner', [
            hotel,
            account,
            'outsider@example.com',
            await version(),
            false,
          ])
        ).error,
        'RECIPIENT_UNAVAILABLE',
      );
      assert.ok(
        (
          await rpc('vault_transfer_owner', [
            hotel,
            account,
            'COLLEAGUE@example.com',
            await version(),
            true,
          ])
        ).data,
      );
      await as(colleague);
      const row = (
        (await rpc('vault_list_accounts', [hotel])).data as Record<string, unknown>[]
      )[0];
      assert.equal(row.is_owner, true);
      assert.equal(row.can_edit, true);
      // The previous owner kept read-only access as requested.
      await as(owner);
      const kept = (
        (await rpc('vault_list_accounts', [hotel])).data as Record<string, unknown>[]
      )[0];
      assert.equal(kept.is_owner, false);
      assert.equal(kept.can_edit, false);
    });

    await t.test('the encryption owner stays fixed, so the password stays readable', async () => {
      await as(colleague, 'service_role');
      const prepared = await rpc('vault_secret_prepare', [colleague, account, 'reveal', now()]);
      assert.equal(prepared.data?.ownerId, owner);
      assert.equal(prepared.data?.ciphertext, 'workstel:aesgcm:v1:k1:YWJj');
      await db.exec('reset role');
      await assert.rejects(
        db.query('update public.vault_accounts set secret_owner_id=$1 where id=$2', [
          colleague,
          account,
        ]),
        /cannot change/,
      );
    });

    await t.test(
      'developers move everything a leaver owns, without gaining read access',
      async () => {
        await as(colleague);
        const second = String(
          (
            await rpc('vault_write_metadata', [
              hotel,
              frontOffice,
              JSON.stringify({ name: 'Supplier portal', username: 'purchasing' }),
            ])
          ).data?.id,
        );
        assert.ok(second);
        await as(colleague);
        assert.equal((await rpc('vault_admin_owned_accounts', [colleague])).error, 'ACCESS_DENIED');
        assert.equal(
          (await rpc('vault_admin_transfer_accounts', [colleague, owner])).error,
          'ACCESS_DENIED',
        );
        await as(developer);
        const owned = (await rpc('vault_admin_owned_accounts', [colleague])).data as Record<
          string,
          unknown
        >[];
        assert.deepEqual(
          owned.map((row) => row.name),
          ['Booking extranet', 'Supplier portal'],
        );
        // The outsider cannot write in Front Office, so nothing moves and both are reported.
        const refused = await rpc('vault_admin_transfer_accounts', [colleague, outsider]);
        assert.equal(refused.data?.transferred, 0);
        assert.equal((refused.data?.skipped as unknown[]).length, 2);
        const moved = await rpc('vault_admin_transfer_accounts', [colleague, owner]);
        assert.equal(moved.data?.transferred, 2);
        assert.deepEqual(await visible(developer), []);
        assert.deepEqual((await visible(owner)).sort(), ['Booking extranet', 'Supplier portal']);
        await as(owner, 'service_role');
        assert.equal(
          (await rpc('vault_secret_prepare', [owner, account, 'reveal', now()])).data?.ownerId,
          owner,
        );
      },
    );

    await t.test('ownership and sharing changes are audited in the Vault namespace', async () => {
      await db.exec('reset role');
      const events = (
        await db.query<{ action: string; outcome: string }>(
          "select action,outcome from workstel_private.audit_events where action like 'vault.ownership.%' or action like 'vault.share.department%'",
        )
      ).rows.map((row) => row.action + ':' + row.outcome);
      for (const expected of [
        'vault.share.department.grant:success',
        'vault.share.department:denied',
        'vault.ownership.transfer:denied',
        'vault.ownership.transfer:success',
        'vault.ownership.list:success',
        'vault.ownership.list:denied',
      ])
        assert.ok(events.includes(expected), expected);
    });
  } finally {
    await db.close();
  }
});
