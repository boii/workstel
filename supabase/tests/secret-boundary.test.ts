import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
test('secret RPC boundary isolates ciphertext and enforces durable release checks', async (t) => {
  const db = new PGlite();
  const owner = '11111111-1111-4111-8111-111111111111',
    recipient = '22222222-2222-4222-8222-222222222222',
    hotel = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    department = 'aaaaaaaa-1111-4111-8111-111111111111';
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
    ])
      await db.exec(await readFile('supabase/migrations/' + name + '.sql', 'utf8'));
    await db.query('insert into auth.users values ($1,$2),($3,$4)', [
      owner,
      'owner@example.com',
      recipient,
      'recipient@example.com',
    ]);
    await db.query("insert into public.workstel_hotels values ($1,'Hotel')", [hotel]);
    await db.query(
      "insert into public.workstel_departments(id,hotel_id,code,name) values ($1,$2,'it','IT')",
      [department, hotel],
    );
    for (const actor of [owner, recipient])
      await db.query(
        'insert into workstel_private.staff_access(user_id,hotel_id,department_id,can_read,can_write,can_archive) values ($1,$2,$3,true,true,true)',
        [actor, hotel, department],
      );
    async function role(name: string, actor = owner) {
      await db.exec('reset role');
      await db.query("select set_config('request.jwt.claim.sub',$1,false)", [actor]);
      await db.exec('set role ' + name);
    }
    async function rpc(name: string, args: unknown[] = []) {
      const result = await db.query<{ r: { data?: Record<string, unknown>; error?: string } }>(
        'select public.' + name + '(' + args.map((_, i) => '$' + (i + 1)).join(',') + ') as r',
        args,
      );
      return result.rows[0].r;
    }
    await role('authenticated');
    const account = (
      await rpc('vault_write_metadata', [
        hotel,
        department,
        JSON.stringify({ name: 'Test metadata', username: 'operator' }),
      ])
    ).data!.id;
    await t.test(
      'staff and anonymous roles cannot call secret RPCs; service cannot select raw ciphertext',
      async () => {
        await assert.rejects(
          () => rpc('vault_secret_prepare', [owner, account, 'reveal', now()]),
          /permission denied/,
        );
        await role('anon');
        await assert.rejects(() => rpc('vault_secret_service_status'), /permission denied/);
        await role('service_role');
        await assert.rejects(
          () => db.query('select * from workstel_private.vault_secrets'),
          /permission denied/,
        );
      },
    );
    await t.test('recent authentication and actor-specific ownership are required', async () => {
      assert.equal(
        (await rpc('vault_secret_prepare', [owner, account, 'write', now() - 3600])).error,
        'REAUTH_REQUIRED',
      );
      assert.equal(
        (await rpc('vault_secret_prepare', [recipient, account, 'reveal', now()])).error,
        'ACCESS_DENIED',
      );
      const prepared = await rpc('vault_secret_prepare', [owner, account, 'write', now()]);
      assert.equal(prepared.data!.secretVersion, 0);
    });
    const requestId = crypto.randomUUID();
    await t.test(
      'ciphertext commits atomically, versions conflict, and request replay cannot overwrite a committed secret',
      async () => {
        assert.equal(
          (
            await rpc('vault_secret_commit', [
              owner,
              account,
              1,
              0,
              requestId,
              'plaintext is forbidden',
              now(),
            ])
          ).error,
          'INVALID_INPUT',
        );
        const committed = await rpc('vault_secret_commit', [
          owner,
          account,
          1,
          0,
          requestId,
          'vault:v1:YWJj',
          now(),
        ]);
        assert.equal(committed.data!.version, 1);
        const repeated = await rpc('vault_secret_commit', [
          owner,
          account,
          2,
          1,
          requestId,
          'vault:v1:ZGVm',
          now(),
        ]);
        assert.equal(repeated.data!.version, 1);
        assert.equal(
          (
            await rpc('vault_secret_commit', [
              owner,
              account,
              1,
              0,
              crypto.randomUUID(),
              'vault:v1:ZGVm',
              now(),
            ])
          ).error,
          'VERSION_CONFLICT',
        );
        await db.exec('reset role');
        const secret = await db.query<{ ciphertext: string; version: number }>(
          'select ciphertext,version from workstel_private.vault_secrets',
        );
        assert.equal(secret.rows[0].ciphertext, 'vault:v1:YWJj');
        assert.equal(secret.rows[0].version, 1);
        await role('service_role');
      },
    );
    await t.test(
      'sharing grants reveal but not writes; revocation is checked again after decryption',
      async () => {
        await role('authenticated');
        await rpc('vault_set_share', [hotel, account, 'recipient@example.com', 2]);
        await role('service_role');
        assert.equal(
          (await rpc('vault_secret_prepare', [recipient, account, 'write', now()])).error,
          'ACCESS_DENIED',
        );
        const prepared = await rpc('vault_secret_prepare', [recipient, account, 'reveal', now()]);
        assert.equal(prepared.data!.ciphertext, 'vault:v1:YWJj');
        await role('authenticated');
        await rpc('vault_set_share', [hotel, account, 'recipient@example.com', 3, 'revoke']);
        await role('service_role');
        assert.equal(
          (await rpc('vault_secret_finish_reveal', [recipient, account, 3, 1, now()])).error,
          'ACCESS_DENIED',
        );
        const finished = await rpc('vault_secret_finish_reveal', [owner, account, 4, 1, now()]);
        assert.equal(finished.data!.authorized, true);
        assert.equal(
          (await rpc('vault_secret_finish_reveal', [owner, account, 3, 1, now()])).error,
          'VERSION_CONFLICT',
        );
      },
    );
    await t.test('unavailable audit prevents release and rolls encrypted writes back', async () => {
      await db.exec(
        "reset role;create function workstel_private.fail_secret_audit() returns trigger language plpgsql as $$begin if new.action in ('vault.secret.write','vault.secret.reveal') then raise exception 'Audit unavailable';end if;return new;end$$;create trigger fail_secret before insert on workstel_private.audit_events for each row execute function workstel_private.fail_secret_audit();",
      );
      await role('service_role');
      await assert.rejects(
        () => rpc('vault_secret_finish_reveal', [owner, account, 4, 1, now()]),
        /Audit unavailable/,
      );
      await assert.rejects(
        () =>
          rpc('vault_secret_commit', [
            owner,
            account,
            4,
            1,
            crypto.randomUUID(),
            'vault:v1:ZGVm',
            now(),
          ]),
        /Audit unavailable/,
      );
      await db.exec('reset role');
      const row = await db.query<{ version: number }>(
        'select version from workstel_private.vault_secrets',
      );
      assert.equal(row.rows[0].version, 1);
      await role('service_role');
    });
    await t.test('database rate limit applies to secret requests', async () => {
      let limited = false;
      for (let i = 0; i < 31; i++) {
        const result = await rpc('vault_secret_prepare', [recipient, account, 'reveal', now()]);
        if (result.error === 'RATE_LIMITED') {
          limited = true;
          break;
        }
      }
      assert.equal(limited, true);
    });
  } finally {
    await db.close();
  }
});
