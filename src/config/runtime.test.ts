import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveRuntimeConfig } from './resolveRuntimeConfig';
import { createAuthStorage } from '../auth/storage';
test('production never enables the demo bypass and rejects secret keys or insecure endpoints', () => {
  assert.equal(resolveRuntimeConfig({ VITE_ENABLE_DEMO: 'true' }, false).demo, false);
  const env = {
    VITE_SUPABASE_URL: 'https://api.hotel.example',
    VITE_SUPABASE_ANON_KEY: 'sb_publishable_' + 'a'.repeat(32),
  };
  assert.equal(resolveRuntimeConfig(env, false).configured, true);
  assert.equal(
    resolveRuntimeConfig({ ...env, VITE_SUPABASE_ANON_KEY: 'sb_secret_' + 'a'.repeat(32) }, false)
      .configured,
    false,
  );
  assert.equal(
    resolveRuntimeConfig({ ...env, VITE_SUPABASE_URL: 'http://api.hotel.example' }, false)
      .configured,
    false,
  );
  assert.equal(
    resolveRuntimeConfig({ ...env, VITE_SUPABASE_URL: 'https://supabase.example.invalid' }, false)
      .configured,
    false,
  );
  const jwt = 'e30.' + btoa(JSON.stringify({ role: 'service_role' })) + '.signature';
  assert.equal(
    resolveRuntimeConfig({ ...env, VITE_SUPABASE_ANON_KEY: jwt }, false).configured,
    false,
  );
});
test('auth storage keeps tokens in memory while only the PKCE verifier survives a redirect', async () => {
  const temporaryData = new Map<string, string>();
  const temporary: Storage = {
    getItem: (key) => temporaryData.get(key) ?? null,
    setItem: (key, value) => {
      temporaryData.set(key, value);
    },
    removeItem: (key) => {
      temporaryData.delete(key);
    },
    clear: () => temporaryData.clear(),
    key: (index) => [...temporaryData.keys()][index] ?? null,
    get length() {
      return temporaryData.size;
    },
  };
  const first = createAuthStorage(temporary);
  await first.setItem('workstel-auth', 'sample-token');
  await first.setItem('workstel-auth-code-verifier', 'sample-verifier');
  assert.equal(temporary.getItem('workstel-auth'), null);
  const afterRedirect = createAuthStorage(temporary);
  assert.equal(await afterRedirect.getItem('workstel-auth'), null);
  assert.equal(await afterRedirect.getItem('workstel-auth-code-verifier'), 'sample-verifier');
  temporary.setItem(
    'workstel-auth-code-verifier',
    JSON.stringify({ value: 'expired', expires: 0 }),
  );
  assert.equal(await afterRedirect.getItem('workstel-auth-code-verifier'), null);
});
