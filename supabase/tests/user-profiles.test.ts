import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

type Profile = {
  displayName: string | null;
  jobTitle: string | null;
  extension: string | null;
  locale: string | null;
};
type RpcResult = { data?: Profile; error?: string };

test('staff read and edit only their own profile, with audited identity changes', async () => {
  const db = new PGlite();
  const alice = '11111111-1111-4111-8111-111111111111',
    bob = '22222222-2222-4222-8222-222222222222';
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
      '202611050002_user_profiles',
    ])
      await db.exec(await readFile('supabase/migrations/' + migration + '.sql', 'utf8'));
    await db.query('insert into auth.users(id,email) values ($1,$2),($3,$4)', [
      alice,
      'alice@example.com',
      bob,
      'bob@example.com',
    ]);
    async function as(user: string) {
      await db.exec('reset role');
      await db.query("select set_config('request.jwt.claim.sub',$1,false)", [user]);
      await db.exec('set role authenticated');
    }
    async function get(): Promise<RpcResult> {
      return (await db.query<{ r: RpcResult }>('select public.workstel_profile_get() as r')).rows[0]
        .r;
    }
    async function save(input: unknown): Promise<RpcResult> {
      return (
        await db.query<{ r: RpcResult }>('select public.workstel_profile_save($1::jsonb) as r', [
          JSON.stringify(input),
        ])
      ).rows[0].r;
    }
    async function audits() {
      await db.exec('reset role');
      const rows = await db.query<{ actor_id: string; resource_id: string }>(
        "select actor_id,resource_id from workstel_private.audit_events where action='platform.profile.update'",
      );
      return rows.rows;
    }

    await as('');
    assert.equal((await get()).error, 'ACCESS_DENIED');
    assert.equal((await save({ displayName: 'X' })).error, 'ACCESS_DENIED');

    await as(alice);
    assert.deepEqual((await get()).data, {
      displayName: null,
      jobTitle: null,
      extension: null,
      locale: null,
    });
    // Locale alone is a preference and is not audited.
    assert.equal((await save({ locale: 'id' })).data?.locale, 'id');
    assert.equal((await audits()).length, 0);

    await as(alice);
    const saved = await save({
      displayName: '  Alice Hartono ',
      jobTitle: 'Front Office Supervisor',
      extension: '+62 (21) 101',
    });
    assert.deepEqual(saved.data, {
      displayName: 'Alice Hartono',
      jobTitle: 'Front Office Supervisor',
      extension: '+62 (21) 101',
      locale: 'id',
    });
    assert.deepEqual(await audits(), [{ actor_id: alice, resource_id: alice }]);

    // Partial update keeps other fields; an empty string clears one.
    await as(alice);
    assert.deepEqual((await save({ jobTitle: '' })).data, {
      displayName: 'Alice Hartono',
      jobTitle: null,
      extension: '+62 (21) 101',
      locale: 'id',
    });
    // Saving the same values again writes no audit event.
    await as(alice);
    await save({ displayName: 'Alice Hartono' });
    assert.equal((await audits()).length, 2);

    await as(alice);
    for (const invalid of [
      {},
      [],
      { displayName: 'x'.repeat(81) },
      { displayName: 'Line\nbreak' },
      { extension: 'ext. 12' },
      { locale: 'fr' },
      { displayName: 42 },
      { email: 'other@example.com' },
    ])
      assert.equal((await save(invalid)).error, 'INVALID_INPUT', JSON.stringify(invalid));

    // Another user sees only their own empty profile.
    await as(bob);
    assert.equal((await get()).data?.displayName, null);
    await assert.rejects(
      db.query('select * from workstel_private.user_profiles'),
      /permission denied/,
    );
  } finally {
    await db.close();
  }
});
