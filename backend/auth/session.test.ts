import assert from 'node:assert/strict';
import { test } from 'node:test';
import { makeSessionHandler, type SessionEnvironment } from './session';
import { createSessionFetch } from '../../src/auth/sessionFetch';
import { createAuthStorage } from '../../src/auth/storage';
import { createClient } from '@supabase/supabase-js';

const origin = 'https://workstel.pages.dev';
const config: SessionEnvironment = {
  SESSION_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64url'),
  SESSION_SUPABASE_URL: 'https://auth.example.com',
  SESSION_SUPABASE_PUBLIC_KEY: 'public-key',
};
function request(
  grant = 'password',
  cookie = '',
  body: unknown = { email: 'staff@example.com', password: 'fictional-password' },
  method = 'POST',
  requestOrigin = origin,
) {
  return new Request(origin + '/api/session?grant_type=' + grant, {
    method,
    headers: {
      origin: requestOrigin,
      cookie,
      'Content-Type': 'application/json',
      authorization: 'Bearer access',
    },
    body: method === 'DELETE' ? undefined : JSON.stringify(body),
  });
}
function session(refresh = 'server-refresh-secret') {
  return {
    access_token: 'access-token',
    refresh_token: refresh,
    expires_in: 3600,
    user: { id: 'fictional-id', email: 'staff@example.com' },
  };
}
test('login and refresh use authenticated encrypted cookies without exposing refresh credentials', async () => {
  const calls: { url: string; body: Record<string, unknown> }[] = [];
  const handler = makeSessionHandler(config, async (url, init) => {
    calls.push({ url: String(url), body: JSON.parse(String(init?.body)) });
    return Response.json(session(calls.length > 1 ? 'rotated-secret' : undefined));
  });
  const login = await handler(request());
  assert.equal(login.status, 200);
  const text = await login.text();
  assert.ok(!text.includes('server-refresh-secret'));
  assert.equal(JSON.parse(text).refresh_token, 'http-only-session');
  assert.equal(login.headers.get('cache-control'), 'no-store, max-age=0');
  const cookie = login.headers.get('set-cookie')!;
  for (const attribute of ['HttpOnly', 'Secure', 'SameSite=Strict', 'Path=/', 'Max-Age=43200'])
    assert.ok(cookie.includes(attribute));
  assert.ok(!cookie.includes('server-refresh-secret'));
  const restored = await handler(
    request('refresh_token', cookie.split(';')[0], { refresh_token: 'attacker-supplied' }),
  );
  assert.equal(restored.status, 200);
  assert.deepEqual(calls[1].body, { refresh_token: 'server-refresh-secret' });
  assert.notEqual(restored.headers.get('set-cookie')!.split(';')[0], cookie.split(';')[0]);
  assert.ok(!(await restored.text()).includes('rotated-secret'));
});
test('foreign origins, missing/tampered cookies, invalid grants and oversized input fail closed', async () => {
  let calls = 0;
  const handler = makeSessionHandler(config, async () => {
    calls++;
    return Response.json(session());
  });
  assert.equal(
    (await handler(request('password', '', {}, 'POST', 'https://attacker.example'))).status,
    403,
  );
  assert.equal((await handler(request('refresh_token'))).status, 401);
  assert.equal(
    (await handler(request('refresh_token', '__Host-workstel-session=invalid.ciphertext'))).status,
    401,
  );
  assert.equal((await handler(request('client_credentials'))).status, 400);
  assert.equal(
    (await handler(request('password', '', { password: 'x'.repeat(17000) }))).status,
    413,
  );
  assert.equal(calls, 0);
  const login = await handler(request());
  const cookie = login.headers.get('set-cookie')!.split(';')[0];
  const otherKey = makeSessionHandler({
    ...config,
    SESSION_ENCRYPTION_KEY: Buffer.alloc(32, 8).toString('base64url'),
  });
  const rejected = await otherKey(request('refresh_token', cookie));
  assert.equal(rejected.status, 401);
  assert.ok(rejected.headers.get('set-cookie')?.includes('Max-Age=0'));
});
test('logout clears the cookie and revokes the upstream session; transient failures never expose upstream details', async () => {
  let revoked = false;
  const handler = makeSessionHandler(config, async (url, init) => {
    assert.ok(String(url).endsWith('/logout?scope=local'));
    assert.equal(new Headers(init?.headers).get('authorization'), 'Bearer access');
    revoked = true;
    return new Response(null, { status: 204 });
  });
  const logout = await handler(request('', '', {}, 'DELETE'));
  assert.equal(logout.status, 200);
  assert.ok(logout.headers.get('set-cookie')?.includes('Max-Age=0'));
  assert.ok(revoked);
  const broken = makeSessionHandler(config, async () => {
    throw Error('private upstream details');
  });
  const result = await broken(request());
  assert.equal(result.status, 503);
  assert.ok(!(await result.text()).includes('private upstream details'));
});
test('refresh preserves the original deadline and expired cookies cannot restore sessions', async (context) => {
  const start = Date.now();
  const clock = context.mock.method(Date, 'now', () => start);
  let calls = 0;
  const handler = makeSessionHandler(config, async () => {
    calls++;
    return Response.json(session());
  });
  const login = await handler(request());
  const saved = login.headers.get('set-cookie')!.split(';')[0];
  clock.mock.mockImplementation(() => start + 3600000);
  const refreshed = await handler(request('refresh_token', saved));
  assert.equal(refreshed.status, 200);
  assert.ok(refreshed.headers.get('set-cookie')?.includes('Max-Age=39600'));
  clock.mock.mockImplementation(() => start + 43200001);
  const expired = await handler(request('refresh_token', saved));
  assert.equal(expired.status, 401);
  assert.equal(calls, 2);
  assert.ok(expired.headers.get('set-cookie')?.includes('Max-Age=0'));
});
test('upstream redirects are rejected without following or exposing credentials', async () => {
  let calls = 0;
  const handler = makeSessionHandler(config, async (_url, init) => {
    calls++;
    assert.equal(init?.redirect, 'manual');
    return new Response(null, { status: 302, headers: { Location: 'https://untrusted.invalid/' } });
  });
  const result = await handler(request());
  assert.equal(result.status, 503);
  assert.equal(calls, 1);
  assert.equal(result.headers.get('set-cookie'), null);
  assert.ok(!(await result.text()).includes('fictional-password'));
});
test('SDK login, new-client restoration, token refresh and logout work through the cookie bridge', async () => {
  let cookie = '',
    count = 0;
  const handler = makeSessionHandler(config, async (_url, init) => {
    if (!init?.body) return new Response(null, { status: 204 });
    count++;
    return Response.json(session('refresh-' + count));
  });
  const fetcher: typeof fetch = async (input, init) => {
    const url = String(input);
    assert.ok(url.startsWith('/api/session'));
    const headers = new Headers(init?.headers);
    headers.set('Origin', origin);
    headers.set('Cookie', cookie);
    const response = await handler(new Request(origin + url, { ...init, headers }));
    const saved = response.headers.get('set-cookie');
    if (saved) cookie = saved.includes('Max-Age=0') ? '' : saved.split(';')[0];
    return response;
  };
  const client = () =>
    createClient(config.SESSION_SUPABASE_URL, 'public-key', {
      global: { fetch: createSessionFetch(config.SESSION_SUPABASE_URL, fetcher) },
      auth: { storage: createAuthStorage(), autoRefreshToken: false, detectSessionInUrl: false },
    });
  const first = client();
  const login = await first.auth.signInWithPassword({
    email: 'staff@example.com',
    password: 'fictional-password',
  });
  assert.equal(login.error, null);
  assert.equal(login.data.session?.refresh_token, 'http-only-session');
  const reloaded = client();
  assert.equal((await reloaded.auth.getSession()).data.session, null);
  const restore = await reloaded.auth.refreshSession({ refresh_token: 'http-only-session' });
  assert.equal(restore.error, null);
  assert.ok(restore.data.session);
  assert.equal((await reloaded.auth.refreshSession()).error, null);
  assert.equal(count, 3);
  assert.equal((await reloaded.auth.signOut({ scope: 'local' })).error, null);
  assert.equal(cookie, '');
  assert.equal((await reloaded.auth.getSession()).data.session, null);
});
