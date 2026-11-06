import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

type HookResult = { error?: { http_code: number; message: string } };

test('external-provider sign-ups are limited to listed staff domains', async () => {
  const db = new PGlite();
  try {
    await db.exec(
      `create role anon;create role authenticated;create role service_role;create schema auth;
       create table auth.users(id uuid primary key,email text unique);
       create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
       grant usage on schema auth to anon,authenticated,service_role;`,
    );
    for (const migration of ['202611010001_vault_metadata', '202611070002_signup_domains'])
      await db.exec(await readFile('supabase/migrations/' + migration + '.sql', 'utf8'));

    async function hook(email: string | null, provider: string | null): Promise<HookResult> {
      const user: Record<string, unknown> = { app_metadata: provider ? { provider } : {} };
      if (email !== null) user.email = email;
      const event = JSON.stringify({ metadata: { name: 'before-user-created' }, user });
      return (
        await db.query<{ r: HookResult }>(
          'select workstel_private.before_user_created($1::jsonb) as r',
          [event],
        )
      ).rows[0].r;
    }
    const denied = (r: HookResult) => r.error?.http_code === 403;

    // Fail closed: with no domains listed every Google sign-up is rejected.
    assert.ok(denied(await hook('alice@hotel.example', 'google')));
    // Developer-created email/password accounts are unaffected.
    assert.deepEqual(await hook('alice@elsewhere.example', 'email'), {});

    await db.exec("insert into workstel_private.signup_domains(domain) values ('hotel.example')");
    assert.deepEqual(await hook('alice@hotel.example', 'google'), {});
    assert.deepEqual(await hook('  Alice@Hotel.Example ', 'google'), {});
    assert.ok(denied(await hook('mallory@gmail.com', 'google')));
    // Subdomains and look-alike suffixes must be listed separately.
    assert.ok(denied(await hook('a@sub.hotel.example', 'google')));
    assert.ok(denied(await hook('a@evilhotel.example', 'google')));
    assert.ok(denied(await hook('a@hotel.example.attacker.test', 'google')));
    assert.ok(denied(await hook('a@b@hotel.example', 'google')));
    assert.ok(denied(await hook(null, 'google')));
    assert.ok(denied(await hook('a@other.example', null)));
    assert.ok(denied(await hook('', 'saml')));

    await assert.rejects(
      db.exec("insert into workstel_private.signup_domains(domain) values ('Hotel.Example')"),
    );
    await assert.rejects(
      db.exec("insert into workstel_private.signup_domains(domain) values ('@hotel.example')"),
    );

    // Signed-in staff can neither call the hook nor read the domain list.
    await db.exec('set role authenticated');
    await assert.rejects(db.query("select workstel_private.before_user_created('{}'::jsonb)"));
    await assert.rejects(db.query('select * from workstel_private.signup_domains'));
  } finally {
    await db.close();
  }
});
