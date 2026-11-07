import assert from 'node:assert/strict';
import { test } from 'node:test';
import { makeUsersHandler, temporaryPassword } from './handler';
import type { UsersServerConfig } from './handler';

const developer = '11111111-1111-4111-8111-111111111111',
  staff = '22222222-2222-4222-8222-222222222222';
const config: UsersServerConfig = {
  supabaseUrl: 'https://backend.example',
  publicKey: 'public-key',
  serviceKey: 'server-key',
  frontendOrigin: 'https://workstel.pages.dev',
};
const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
function token(sub: string, signedInSecondsAgo = 30) {
  const now = Math.floor(Date.now() / 1000);
  return [
    encode({ alg: 'HS256' }),
    encode({
      sub,
      role: 'authenticated',
      exp: now + 600,
      amr: [{ method: 'password', timestamp: now - signedInSecondsAgo }],
    }),
    'signature',
  ].join('.');
}
type Call = { url: string; method: string; body: Record<string, unknown> };
function backend(options: { actor: string; developer: boolean; createStatus?: number }) {
  const calls: Call[] = [];
  const fetcher = (async (url: string, init: RequestInit = {}) => {
    const body = init.body ? JSON.parse(String(init.body)) : {};
    calls.push({ url, method: init.method ?? 'GET', body });
    const json = (status: number, value: unknown) =>
      new Response(JSON.stringify(value), { status });
    if (url.endsWith('/auth/v1/user')) return json(200, { id: options.actor });
    if (url.endsWith('/rpc/workstel_module_access'))
      return json(200, { data: [], meta: { platformAdmin: options.developer } });
    if (url.endsWith('/auth/v1/admin/users'))
      return json(options.createStatus ?? 200, { id: '33333333-3333-4333-8333-333333333333' });
    if (url.includes('/auth/v1/admin/users/')) return json(200, {});
    if (url.includes('/rest/v1/rpc/')) return new Response(null, { status: 204 });
    return json(404, {});
  }) as typeof fetch;
  return { calls, handle: makeUsersHandler(config, fetcher) };
}
function request(operation: string, body: unknown, sub = developer, options: RequestInit = {}) {
  return new Request('https://backend.example/functions/v1/workstel-users/' + operation, {
    method: 'POST',
    headers: {
      origin: config.frontendOrigin,
      authorization: 'Bearer ' + token(sub),
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
    ...options,
  });
}

test('temporary passwords are random, grouped and unambiguous', () => {
  const values = new Set(Array.from({ length: 50 }, () => temporaryPassword()));
  assert.equal(values.size, 50);
  for (const value of values)
    assert.match(value, /^[A-HJ-NP-Za-km-np-z2-9]{4}(-[A-HJ-NP-Za-km-np-z2-9]{4}){3}$/);
});

test('only developers create accounts, and the password is returned once', async () => {
  const denied = backend({ actor: staff, developer: false });
  const refused = await denied.handle(request('create', { email: 'new@example.com' }, staff));
  assert.equal(refused.status, 403);
  assert.ok(
    denied.calls.some(
      (c) => c.url.endsWith('workstel_user_admin_record') && c.body.p_outcome === 'denied',
    ),
  );
  assert.ok(!denied.calls.some((c) => c.url.endsWith('/auth/v1/admin/users')));

  const allowed = backend({ actor: developer, developer: true });
  const created = await allowed.handle(request('create', { email: ' New@Example.com ' }));
  assert.equal(created.status, 200);
  assert.equal(created.headers.get('cache-control'), 'no-store, max-age=0');
  const { data } = await created.json();
  const create = allowed.calls.find((c) => c.url.endsWith('/auth/v1/admin/users'))!;
  assert.equal(create.body.email, 'new@example.com');
  assert.equal(create.body.email_confirm, true);
  assert.deepEqual(create.body.app_metadata, { workstel_admin_created: true });
  assert.equal(create.body.password, data.temporaryPassword);
  const flag = allowed.calls.find((c) => c.url.endsWith('workstel_user_admin_flag'))!;
  assert.deepEqual(flag.body, { p_user_id: data.userId, p_must_change: true });

  const duplicate = backend({ actor: developer, developer: true, createStatus: 422 });
  const exists = await duplicate.handle(request('create', { email: 'staff@example.com' }));
  assert.equal((await exists.json()).error.code, 'EMAIL_EXISTS');
});

test('reset and block target other users only', async () => {
  const api = backend({ actor: developer, developer: true });
  const self = await api.handle(request('block', { userId: developer }));
  assert.equal((await self.json()).error.code, 'SELF_ACTION');
  const reset = await api.handle(request('reset-password', { userId: staff }));
  const { data } = await reset.json();
  const update = api.calls.find((c) => c.url.endsWith('/admin/users/' + staff))!;
  assert.equal(update.method, 'PUT');
  assert.equal(update.body.password, data.temporaryPassword);
  await api.handle(request('block', { userId: staff }));
  await api.handle(request('unblock', { userId: staff }));
  const bans = api.calls
    .filter((c) => c.url.endsWith('/admin/users/' + staff) && 'ban_duration' in c.body)
    .map((c) => c.body.ban_duration);
  assert.deepEqual(bans, ['876000h', 'none']);
  const badInput = await api.handle(request('block', { userId: 'not-a-uuid' }));
  assert.equal(badInput.status, 400);
});

test('users change their own password only after a recent sign-in', async () => {
  const api = backend({ actor: staff, developer: false });
  const weak = await api.handle(request('change-password', { password: 'short' }, staff));
  assert.equal((await weak.json()).error.code, 'WEAK_PASSWORD');
  const stale = new Request(request('change-password', { password: 'long enough secret' }, staff), {
    headers: {
      origin: config.frontendOrigin,
      authorization: 'Bearer ' + token(staff, 3600),
      'content-type': 'application/json',
    },
  });
  assert.equal((await (await api.handle(stale)).json()).error.code, 'REAUTH_REQUIRED');
  const changed = await api.handle(
    request('change-password', { password: 'long enough secret' }, staff),
  );
  assert.equal(changed.status, 200);
  assert.ok(api.calls.some((c) => c.url.endsWith('/admin/users/' + staff) && c.method === 'PUT'));
  const flag = api.calls.find((c) => c.url.endsWith('workstel_user_admin_flag'))!;
  assert.deepEqual(flag.body, { p_user_id: staff, p_must_change: false });
  // Developer checks are skipped: changing one's own password needs no admin role.
  assert.ok(!api.calls.some((c) => c.url.endsWith('workstel_module_access')));
});

test('foreign origins, wrong methods and unknown operations fail closed', async () => {
  const api = backend({ actor: developer, developer: true });
  const foreign = await api.handle(
    new Request(request('create', { email: 'a@b.co' }), {
      headers: {
        origin: 'https://evil.example',
        authorization: 'Bearer ' + token(developer),
        'content-type': 'application/json',
      },
    }),
  );
  assert.equal(foreign.status, 403);
  const get = await api.handle(
    new Request('https://backend.example/functions/v1/workstel-users/create'),
  );
  assert.equal(get.status, 405);
  const unknown = await api.handle(request('delete', {}));
  assert.equal(unknown.status, 404);
  assert.equal(api.calls.length, 0);
});
