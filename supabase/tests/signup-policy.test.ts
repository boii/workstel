import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

type HookResult = { error?: { http_code: number; message: string } };

test('only Google and developer-created accounts may be created', async () => {
  const db = new PGlite();
  try {
    await db.exec(
      `create role anon;create role authenticated;create role service_role;create schema auth;
       create table auth.users(id uuid primary key,email text unique);
       create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
       grant usage on schema auth to anon,authenticated,service_role;`,
    );
    for (const migration of [
      '202611010001_vault_metadata',
      '202611010002_audit_visibility',
      '202611070002_signup_domains',
      '202611070003_google_signup',
    ])
      await db.exec(await readFile('supabase/migrations/' + migration + '.sql', 'utf8'));

    async function hook(appMetadata: Record<string, unknown>): Promise<HookResult> {
      const user = { email: 'someone@example.com', app_metadata: appMetadata };
      const event = JSON.stringify({ metadata: { name: 'before-user-created' }, user });
      return (
        await db.query<{ r: HookResult }>(
          'select workstel_private.before_user_created($1::jsonb) as r',
          [event],
        )
      ).rows[0].r;
    }
    const denied = (r: HookResult) => r.error?.http_code === 403;

    // Any Google account may sign up; it still has no workspace access until granted.
    assert.deepEqual(await hook({ provider: 'google', providers: ['google'] }), {});
    // Developer-created accounts carry a flag only the service role can set.
    assert.deepEqual(await hook({ provider: 'email', workstel_admin_created: true }), {});

    // Public email/password, magic link, phone, anonymous and other providers are refused.
    assert.ok(denied(await hook({ provider: 'email' })));
    assert.ok(denied(await hook({ provider: 'email', workstel_admin_created: 'true' })));
    assert.ok(denied(await hook({ provider: 'email', workstel_admin_created: false })));
    assert.ok(denied(await hook({ provider: 'phone' })));
    assert.ok(denied(await hook({ provider: 'anonymous' })));
    assert.ok(denied(await hook({ provider: 'github' })));
    assert.ok(denied(await hook({ provider: 'Google' })));
    assert.ok(denied(await hook({})));

    // The staff-domain list is gone.
    await assert.rejects(db.query('select * from workstel_private.signup_domains'));

    // Signed-in staff cannot call the hook.
    await db.exec('set role authenticated');
    await assert.rejects(db.query("select workstel_private.before_user_created('{}'::jsonb)"));
  } finally {
    await db.close();
  }
});
