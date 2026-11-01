import { loadEnv } from 'vite';
import { resolveRuntimeConfig } from '../src/config/resolveRuntimeConfig';
const config = resolveRuntimeConfig(loadEnv('production', process.cwd(), 'VITE_'), false);
if (!config.configured) {
  console.error('Configuration is missing or is not a public client configuration.');
  process.exit(1);
}
console.log('Public frontend configuration is valid; key value is not displayed.');
const checks = [
  { name: 'Auth health', path: '/auth/v1/health', method: 'GET' },
  { name: 'Auth settings', path: '/auth/v1/settings', method: 'GET' },
  { name: 'Metadata RPC presence', path: '/rest/v1/rpc/workstel_session', method: 'POST' },
  { name: 'Browser CORS preflight', path: '/rest/v1/rpc/workstel_session', method: 'OPTIONS' },
];
for (const check of checks) {
  try {
    const headers: Record<string, string> = {
      apikey: config.anonKey,
      Origin: 'https://workstel.pages.dev',
    };
    if (check.method === 'POST') headers['Content-Type'] = 'application/json';
    if (check.method === 'OPTIONS') {
      delete headers.apikey;
      headers['Access-Control-Request-Method'] = 'POST';
      headers['Access-Control-Request-Headers'] = 'apikey,authorization,content-type';
    }
    const response = await fetch(config.supabaseUrl + check.path, {
      method: check.method,
      headers,
      body: check.method === 'POST' ? '{}' : undefined,
      redirect: 'manual',
      signal: AbortSignal.timeout(15000),
    });
    const contentType = response.headers.get('content-type') ?? '';
    const result: Record<string, unknown> = {
      check: check.name,
      status: response.status,
      contentType,
      allowOrigin: response.headers.get('access-control-allow-origin'),
      allowHeaders: response.headers.get('access-control-allow-headers'),
    };
    if (contentType.includes('application/json')) {
      const body = await response.json();
      if (check.name === 'Auth settings') {
        result.googleEnabled = body.external?.google;
        result.emailEnabled = body.external?.email;
        result.publicSignupDisabled = body.disable_signup;
      } else {
        result.errorCode = body.code ?? body.error_code ?? body.error;
        if (typeof body.message === 'string')
          result.message = body.message.replaceAll(config.anonKey, '[REDACTED]').slice(0, 160);
      }
    }
    console.log(JSON.stringify(result));
  } catch {
    console.log(
      JSON.stringify({
        check: check.name,
        error: 'Network/TLS connection could not be completed.',
      }),
    );
  }
}
