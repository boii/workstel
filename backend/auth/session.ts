/** Same-origin session bridge. Refresh credentials never enter JavaScript responses. */
export interface SessionEnvironment {
  SESSION_ENCRYPTION_KEY: string;
  SESSION_SUPABASE_URL: string;
  SESSION_SUPABASE_PUBLIC_KEY: string;
}
const frontend = 'https://workstel.pages.dev';
const cookieName = '__Host-workstel-session';
const lifetime = 60 * 60 * 12;
const placeholder = 'http-only-session';
const encoder = new TextEncoder();
function base64(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replaceAll('=', '');
}
function bytes(value: string): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(atob(value.replaceAll('-', '+').replaceAll('_', '/')), (c) =>
    c.charCodeAt(0),
  );
}
export function makeSessionHandler(
  env: SessionEnvironment,
  fetcher: typeof fetch = globalThis.fetch,
) {
  return async (request: Request): Promise<Response> => {
    const headers = new Headers({
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store, max-age=0',
      Pragma: 'no-cache',
      'X-Content-Type-Options': 'nosniff',
      'X-Robots-Tag': 'noindex, nofollow, noarchive',
      'Referrer-Policy': 'no-referrer',
      'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'",
    });
    const reply = (status: number, body: unknown) =>
      new Response(JSON.stringify(body), { status, headers });
    const fail = (status: number, code: string) => reply(status, { error_code: code, msg: code });
    const cookie = (value: string, age: number) =>
      headers.set(
        'Set-Cookie',
        `${cookieName}=${value}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${age}`,
      );
    try {
      // Exact origin plus JSON blocks cross-site form submissions and login CSRF.
      if (
        new URL(request.url).origin !== frontend ||
        request.headers.get('origin') !== frontend ||
        request.headers.get('sec-fetch-site') === 'cross-site'
      )
        return fail(403, 'access_denied');
      if (request.method !== 'POST' && request.method !== 'DELETE')
        return fail(405, 'method_not_allowed');
      const upstream = new URL(env.SESSION_SUPABASE_URL);
      if (
        upstream.protocol !== 'https:' ||
        upstream.origin !== env.SESSION_SUPABASE_URL ||
        !env.SESSION_SUPABASE_PUBLIC_KEY
      )
        return fail(503, 'session_unavailable');
      const rawKey = bytes(env.SESSION_ENCRYPTION_KEY);
      if (rawKey.length !== 32) return fail(503, 'session_unavailable');
      const key = await crypto.subtle.importKey('raw', rawKey, 'AES-GCM', false, [
        'encrypt',
        'decrypt',
      ]);
      const additionalData = encoder.encode(frontend + '/' + cookieName);
      const saved = request.headers
        .get('cookie')
        ?.split(';')
        .map((v) => v.trim())
        .find((v) => v.startsWith(cookieName + '='))
        ?.slice(cookieName.length + 1);
      let refresh = '',
        expires = Math.floor(Date.now() / 1000) + lifetime;
      if (saved) {
        try {
          if (saved.length > 3500) throw Error();
          const [iv, ciphertext] = saved.split('.');
          const value = JSON.parse(
            new TextDecoder().decode(
              await crypto.subtle.decrypt(
                { name: 'AES-GCM', iv: bytes(iv), additionalData },
                key,
                bytes(ciphertext),
              ),
            ),
          );
          if (
            typeof value.token !== 'string' ||
            !Number.isSafeInteger(value.expires) ||
            value.expires <= Date.now() / 1000
          )
            throw Error();
          refresh = value.token;
          expires = value.expires;
        } catch {
          cookie('', 0);
        }
      }
      async function auth(path: string, body?: unknown, authorization?: string) {
        return fetcher(upstream.origin + '/auth/v1/' + path, {
          method: 'POST',
          headers: {
            apikey: env.SESSION_SUPABASE_PUBLIC_KEY,
            'Content-Type': 'application/json',
            ...(authorization ? { Authorization: authorization } : {}),
          },
          body: body === undefined ? undefined : JSON.stringify(body),
          redirect: 'error',
          signal: AbortSignal.timeout(15000),
        });
      }
      if (request.method === 'DELETE') {
        cookie('', 0);
        // Revoke the corresponding Auth session where a current access token is available.
        const authorization = request.headers.get('authorization');
        if (authorization?.startsWith('Bearer ') && authorization.length < 16384) {
          const result = await auth('logout?scope=local', undefined, authorization);
          if (!result.ok && ![401, 403, 404].includes(result.status))
            return fail(503, 'session_unavailable');
        }
        return reply(200, {});
      }
      if (!request.headers.get('content-type')?.startsWith('application/json'))
        return fail(415, 'invalid_input');
      // Bound the body even when Content-Length is absent or untrusted.
      const reader = request.body?.getReader();
      if (!reader) return fail(400, 'invalid_input');
      let input = '',
        size = 0;
      const decoder = new TextDecoder('utf-8', { fatal: true });
      try {
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          size += value.length;
          if (size > 16384) {
            await reader.cancel();
            return fail(413, 'invalid_input');
          }
          input += decoder.decode(value, { stream: true });
        }
        input += decoder.decode();
      } finally {
        reader.releaseLock();
      }
      let body: Record<string, unknown>;
      try {
        body = JSON.parse(input);
      } catch {
        return fail(400, 'invalid_input');
      }
      if (!body || typeof body !== 'object' || Array.isArray(body))
        return fail(400, 'invalid_input');
      const grant = new URL(request.url).searchParams.get('grant_type');
      let payload: Record<string, unknown>;
      if (grant === 'refresh_token') {
        if (!refresh) {
          cookie('', 0);
          return fail(401, 'refresh_token_not_found');
        }
        payload = { refresh_token: refresh };
      } else if (
        grant === 'password' &&
        typeof body.email === 'string' &&
        typeof body.password === 'string' &&
        body.email.length <= 320 &&
        body.password.length <= 4096
      ) {
        payload = { email: body.email, password: body.password };
        expires = Math.floor(Date.now() / 1000) + lifetime;
      } else if (
        grant === 'pkce' &&
        typeof body.auth_code === 'string' &&
        typeof body.code_verifier === 'string' &&
        body.auth_code.length <= 2048 &&
        body.code_verifier.length <= 256
      ) {
        payload = { auth_code: body.auth_code, code_verifier: body.code_verifier };
        expires = Math.floor(Date.now() / 1000) + lifetime;
      } else return fail(400, 'invalid_input');
      const result = await auth('token?grant_type=' + grant, payload);
      if (!result.ok) {
        if (grant === 'refresh_token' && [400, 401, 403].includes(result.status)) cookie('', 0);
        return fail(
          result.status === 429 ? 429 : result.status >= 500 ? 503 : 400,
          result.status === 429
            ? 'over_request_rate_limit'
            : result.status >= 500
              ? 'session_unavailable'
              : 'invalid_credentials',
        );
      }
      const session = (await result.json()) as Record<string, unknown>;
      if (
        typeof session.access_token !== 'string' ||
        typeof session.refresh_token !== 'string' ||
        session.refresh_token.length > 2048 ||
        typeof session.expires_in !== 'number' ||
        !session.user
      )
        return fail(503, 'session_unavailable');
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const ciphertext = await crypto.subtle.encrypt(
        { name: 'AES-GCM', iv, additionalData },
        key,
        encoder.encode(JSON.stringify({ token: session.refresh_token, expires })),
      );
      cookie(
        base64(iv) + '.' + base64(new Uint8Array(ciphertext)),
        Math.max(0, expires - Math.floor(Date.now() / 1000)),
      );
      // Return only the fields needed by the SDK; the refresh token is a non-secret marker.
      return reply(200, {
        access_token: session.access_token,
        refresh_token: placeholder,
        token_type: 'bearer',
        expires_in: session.expires_in,
        user: session.user,
      });
    } catch {
      return fail(503, 'session_unavailable');
    }
  };
}
