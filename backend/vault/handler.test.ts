import assert from 'node:assert/strict';
import { test } from 'node:test';
import { makeVaultHandler } from './handler';
import type { VaultServerConfig } from './handler';
const owner = '11111111-1111-4111-8111-111111111111',
  account = '22222222-2222-4222-8222-222222222222',
  hotel = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const config: VaultServerConfig = {
  supabaseUrl: 'https://backend.example',
  publicKey: 'public-key',
  serviceKey: 'server-key',
  openBaoUrl: 'https://openbao.example',
  roleId: 'role',
  secretId: 'secret-id',
  frontendOrigin: 'https://workstel.pages.dev',
  enabled: true,
};
const plaintext = 'Fictional secret — not a real credential';
const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64');
function token(overrides: Record<string, unknown> = {}) {
  return (
    'header.' +
    Buffer.from(
      JSON.stringify({
        sub: owner,
        role: 'authenticated',
        exp: Date.now() / 1000 + 300,
        amr: [{ method: 'password', timestamp: Math.floor(Date.now() / 1000) }],
        ...overrides,
      }),
    ).toString('base64url') +
    '.signature'
  );
}
function fixture(
  options: { finishFailure?: string; prepareFailure?: string; authStatus?: number } = {},
) {
  const calls: { url: string; body: Record<string, unknown>; init: RequestInit }[] = [];
  const fetcher = (async (url: unknown, init: RequestInit = {}) => {
    const path = String(url);
    const body = init.body ? JSON.parse(String(init.body)) : {};
    calls.push({ url: path, body, init });
    let data: unknown = {};
    let status = 200;
    if (path.endsWith('/auth/v1/user')) {
      data = { id: owner };
      status = options.authStatus ?? 200;
    } else if (path.endsWith('/workstel_session'))
      data = { data: [{ hotelId: hotel }], meta: { vaultPolicy: 'private-v1' } };
    else if (path.endsWith('/vault_secret_service_status'))
      data = { data: { schema: 'transit-v1' } };
    else if (path.endsWith('/sys/health')) data = { initialized: true, sealed: false };
    else if (path.endsWith('/vault_secret_prepare'))
      data = options.prepareFailure
        ? { error: options.prepareFailure }
        : {
            data: {
              id: account,
              hotelId: hotel,
              ownerId: owner,
              accountVersion: 1,
              secretVersion: 1,
              ciphertext: 'vault:v1:YWJj',
            },
          };
    else if (path.endsWith('/approle/login'))
      data = { auth: { client_token: 'scoped-test-token' } };
    else if (path.endsWith('/encrypt/workstel-passwords'))
      data = { data: { ciphertext: 'vault:v1:YWJj' } };
    else if (path.endsWith('/decrypt/workstel-passwords'))
      data = { data: { plaintext: encode({ password: plaintext }) } };
    else if (path.endsWith('/vault_secret_commit'))
      data = { data: { version: 2, accountVersion: 2 } };
    else if (path.endsWith('/vault_secret_finish_reveal')) {
      data = options.finishFailure
        ? { error: options.finishFailure }
        : { data: { authorized: true } };
      if (options.finishFailure === 'AUDIT_FAILURE') status = 500;
    } else if (path.endsWith('/vault_secret_failed')) data = { data: { recorded: true } };
    if (path.endsWith('/revoke-self')) return new Response(null, { status: 204 });
    return new Response(JSON.stringify(data), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as typeof fetch;
  return { handler: makeVaultHandler(config, fetcher), calls };
}
function request(
  operation: string,
  body: unknown = { accountId: account },
  jwt = token(),
  origin = config.frontendOrigin,
) {
  return new Request('https://backend.example/functions/v1/workstel-vault/' + operation, {
    method: 'POST',
    headers: { origin, Authorization: 'Bearer ' + jwt, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}
test('disabled service and foreign origins fail closed before any upstream call', async () => {
  let calls = 0;
  const handler = makeVaultHandler({ ...config, enabled: false }, async () => {
    calls++;
    throw Error();
  });
  assert.equal((await handler(request('reveal'))).status, 503);
  assert.equal(calls, 0);
  assert.equal(
    (await handler(request('reveal', {}, token(), 'https://other.example'))).status,
    403,
  );
});
test('Auth must validate identity before decoded claims or KMS are used', async () => {
  const f = fixture({ authStatus: 401 });
  const result = await f.handler(request('reveal'));
  assert.equal(result.status, 401);
  assert.equal(f.calls.length, 1);
  const spoof = fixture();
  assert.equal((await spoof.handler(request('reveal', {}, token({ sub: account })))).status, 401);
  assert.equal(spoof.calls.length, 1);
});
test('refresh timestamps do not replace original authentication and expired step-up never reaches KMS', async () => {
  const f = fixture({ prepareFailure: 'REAUTH_REQUIRED' });
  const old = Math.floor(Date.now() / 1000) - 3600;
  const result = await f.handler(
    request(
      'reveal',
      { accountId: account },
      token({
        amr: [
          { method: 'password', timestamp: old },
          { method: 'token_refresh', timestamp: Math.floor(Date.now() / 1000) },
        ],
      }),
    ),
  );
  assert.equal(result.status, 401);
  assert.equal(f.calls.find((c) => c.url.endsWith('/vault_secret_prepare'))?.body.p_auth_time, old);
  assert.ok(!f.calls.some((c) => c.url.includes('openbao')));
});
test('plaintext is released only after final authorization and durable audit; failure never leaks it', async () => {
  for (const failure of ['AUDIT_FAILURE', 'ACCESS_DENIED', 'VERSION_CONFLICT']) {
    const f = fixture({ finishFailure: failure });
    const result = await f.handler(request('reveal'));
    const text = await result.text();
    assert.ok(result.status >= 400);
    assert.ok(!text.includes(plaintext));
    assert.ok(f.calls.some((c) => c.url.includes('/decrypt/')));
    assert.ok(f.calls.some((c) => c.url.endsWith('/vault_secret_failed')));
  }
  const f = fixture();
  const result = await f.handler(request('reveal'));
  assert.equal(result.status, 200);
  assert.equal((await result.json()).data.password, plaintext);
  assert.match(result.headers.get('cache-control') ?? '', /no-store/);
  const paths = f.calls.map((c) => c.url);
  assert.ok(
    paths.findIndex((p) => p.includes('/decrypt/')) <
      paths.findIndex((p) => p.endsWith('/vault_secret_finish_reveal')),
  );
  const references = f.calls
    .filter((c) => c.url.includes('/rest/v1/rpc/vault_secret_'))
    .map((c) => c.body.p_correlation_id);
  assert.ok(references.every((r) => r === result.headers.get('x-request-id')));
});
test('write sends ciphertext to PostgreSQL and binds encryption to owner/hotel/account', async () => {
  const f = fixture();
  const result = await f.handler(
    request('write', {
      accountId: account,
      password: plaintext,
      expectedVersion: 1,
      requestId: crypto.randomUUID(),
    }),
  );
  assert.equal(result.status, 200);
  const encrypted = f.calls.find((c) => c.url.includes('/encrypt/'))!;
  assert.equal(
    Buffer.from(String(encrypted.body.associated_data), 'base64').toString(),
    'workstel:v1:' + hotel + ':' + account + ':' + owner,
  );
  const sql = f.calls.find((c) => c.url.endsWith('/vault_secret_commit'))!;
  assert.equal(sql.body.p_actor, owner);
  assert.ok(!JSON.stringify(sql.body).includes(plaintext));
  assert.equal(sql.body.p_ciphertext, 'vault:v1:YWJj');
  assert.ok(f.calls.every((c) => c.init.redirect === 'error'));
});
test('inspection cannot return ciphertext and actor/scope fields cannot be forged in client inputs', async () => {
  const f = fixture();
  const inspected = await f.handler(request('inspect'));
  assert.ok(!(await inspected.text()).includes('vault:v1:'));
  const forged = fixture();
  assert.equal(
    (await forged.handler(request('reveal', { accountId: account, p_actor: account }))).status,
    400,
  );
  assert.ok(!forged.calls.some((c) => c.url.endsWith('/vault_secret_prepare')));
});

test('status validates scoped KMS credentials and accepts body-free token revocation', async () => {
  const f = fixture();
  const result = await f.handler(request('status', {}));
  assert.equal(result.status, 200);
  assert.equal((await result.json()).data.available, true);
  assert.ok(f.calls.some((c) => c.url.endsWith('/approle/login')));
  assert.ok(f.calls.some((c) => c.url.endsWith('/revoke-self')));
});
