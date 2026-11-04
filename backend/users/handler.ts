/** Server-only account administration. Passwords, keys and tokens are never logged or stored. */
export interface UsersServerConfig {
  supabaseUrl: string;
  publicKey: string;
  serviceKey: string;
  frontendOrigin: string;
}
type Operation = 'create' | 'reset-password' | 'block' | 'unblock' | 'change-password';
const operations: Operation[] = ['create', 'reset-password', 'block', 'unblock', 'change-password'];
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// Unambiguous characters only, so a temporary password can be read out or typed reliably.
const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
const recentAuthSeconds = 600;
const statusFor: Record<string, number> = {
  INVALID_INPUT: 400,
  SELF_ACTION: 400,
  WEAK_PASSWORD: 400,
  UNAUTHENTICATED: 401,
  REAUTH_REQUIRED: 401,
  ACCESS_DENIED: 403,
  NOT_FOUND: 404,
  METHOD_NOT_ALLOWED: 405,
  EMAIL_EXISTS: 409,
  SERVICE_UNAVAILABLE: 503,
};
class SafeError extends Error {
  constructor(readonly code: keyof typeof statusFor) {
    super(code);
  }
}

/** Four groups of four random characters, for example `Kp7m-Qx2a-…`, about 93 bits. */
export function temporaryPassword(
  random: (bytes: Uint8Array) => Uint8Array = (b) => crypto.getRandomValues(b),
) {
  const characters: string[] = [];
  while (characters.length < 16) {
    for (const byte of random(new Uint8Array(32))) {
      // Rejection sampling keeps every character equally likely.
      if (byte < 224 && characters.length < 16) characters.push(alphabet[byte % alphabet.length]);
    }
  }
  return [0, 4, 8, 12].map((start) => characters.slice(start, start + 4).join('')).join('-');
}

function claims(token: string): Record<string, unknown> {
  try {
    const part = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(
      new TextDecoder('utf-8', { fatal: true }).decode(
        Uint8Array.from(atob(part), (character) => character.charCodeAt(0)),
      ),
    );
  } catch {
    throw new SafeError('UNAUTHENTICATED');
  }
}

function configured(config: UsersServerConfig) {
  try {
    const supabase = new URL(config.supabaseUrl),
      frontend = new URL(config.frontendOrigin);
    return (
      !!config.publicKey &&
      !!config.serviceKey &&
      [supabase, frontend].every(
        (u) => !u.username && !u.password && u.pathname === '/' && !u.search && !u.hash,
      ) &&
      (supabase.protocol === 'https:' ||
        (supabase.protocol === 'http:' && ['api-gw', 'kong'].includes(supabase.hostname))) &&
      frontend.protocol === 'https:'
    );
  } catch {
    return false;
  }
}

async function readJson(request: Request) {
  if (!request.headers.get('content-type')?.startsWith('application/json'))
    throw new SafeError('INVALID_INPUT');
  const text = await request.text();
  if (text.length > 4096) throw new SafeError('INVALID_INPUT');
  try {
    const value = JSON.parse(text);
    if (!value || Array.isArray(value) || typeof value !== 'object') throw Error();
    return value as Record<string, unknown>;
  } catch {
    throw new SafeError('INVALID_INPUT');
  }
}

/** Latest interactive sign-in time from the token's authentication methods. */
function authTime(jwt: Record<string, unknown>) {
  const methods = Array.isArray(jwt.amr) ? (jwt.amr as Record<string, unknown>[]) : [];
  return Math.max(
    0,
    ...methods
      .filter(
        (m) =>
          m &&
          ['password', 'oauth', 'totp', 'webauthn'].includes(String(m.method)) &&
          Number.isSafeInteger(m.timestamp),
      )
      .map((m) => Number(m.timestamp)),
  );
}

export function makeUsersHandler(config: UsersServerConfig, fetcher: typeof fetch = fetch) {
  return async function handle(request: Request): Promise<Response> {
    const reference = crypto.randomUUID();
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store, max-age=0',
      Pragma: 'no-cache',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
      Vary: 'Origin',
      'X-Request-ID': reference,
    };
    const origin = request.headers.get('origin');
    if (origin === config.frontendOrigin) headers['Access-Control-Allow-Origin'] = origin;
    const respond = (status: number, body: unknown) =>
      new Response(JSON.stringify(body), { status, headers });
    try {
      if (origin && origin !== config.frontendOrigin) throw new SafeError('ACCESS_DENIED');
      if (request.method === 'OPTIONS')
        return new Response(null, {
          status: 204,
          headers: {
            ...headers,
            'Access-Control-Allow-Methods': 'POST, OPTIONS',
            'Access-Control-Allow-Headers': 'authorization, apikey, content-type',
          },
        });
      if (request.method !== 'POST') throw new SafeError('METHOD_NOT_ALLOWED');
      if (!configured(config)) throw new SafeError('SERVICE_UNAVAILABLE');
      const operation = new URL(request.url).pathname
        .split('/')
        .filter(Boolean)
        .at(-1) as Operation;
      if (!operations.includes(operation)) throw new SafeError('NOT_FOUND');
      const authorization = request.headers.get('authorization');
      if (!authorization?.startsWith('Bearer ') || authorization.length > 16384)
        throw new SafeError('UNAUTHENTICATED');

      async function call(url: string, init: RequestInit) {
        let result: Response;
        try {
          result = await fetcher(url, {
            ...init,
            redirect: 'error',
            signal: AbortSignal.timeout(10000),
          });
        } catch {
          throw new SafeError('SERVICE_UNAVAILABLE');
        }
        const text = await result.text().catch(() => '');
        if (text.length > 262144) throw new SafeError('SERVICE_UNAVAILABLE');
        let body: Record<string, unknown>;
        try {
          body = text ? JSON.parse(text) : {};
        } catch {
          body = {};
        }
        return { status: result.status, body };
      }
      const serviceHeaders: Record<string, string> = {
        apikey: config.serviceKey,
        'Content-Type': 'application/json',
      };
      if (!config.serviceKey.startsWith('sb_secret_'))
        serviceHeaders.Authorization = 'Bearer ' + config.serviceKey;
      async function serviceRpc(name: string, body: Record<string, unknown>) {
        const result = await call(config.supabaseUrl + '/rest/v1/rpc/' + name, {
          method: 'POST',
          headers: serviceHeaders,
          body: JSON.stringify(body),
        });
        if (result.status >= 300) throw new SafeError('SERVICE_UNAVAILABLE');
      }
      const audit = (target: string | null, action: Operation, outcome: 'success' | 'denied') =>
        serviceRpc('workstel_user_admin_record', {
          p_actor: actor,
          p_target: target,
          p_action: action,
          p_outcome: outcome,
        });
      async function updateUser(id: string, changes: Record<string, unknown>) {
        const result = await call(config.supabaseUrl + '/auth/v1/admin/users/' + id, {
          method: 'PUT',
          headers: serviceHeaders,
          body: JSON.stringify(changes),
        });
        if (result.status === 404) throw new SafeError('NOT_FOUND');
        if (result.status === 422) throw new SafeError('WEAK_PASSWORD');
        if (result.status >= 300) throw new SafeError('SERVICE_UNAVAILABLE');
      }

      // Auth validates the signature and expiry; local claims are trusted only afterward.
      const user = await call(config.supabaseUrl + '/auth/v1/user', {
        headers: { apikey: config.publicKey, Authorization: authorization },
      });
      if (user.status === 401 || user.status === 403) throw new SafeError('UNAUTHENTICATED');
      if (user.status >= 300) throw new SafeError('SERVICE_UNAVAILABLE');
      const jwt = claims(authorization.slice(7));
      const actor = String(user.body.id ?? '');
      if (
        !uuid.test(actor) ||
        jwt.sub !== actor ||
        jwt.role !== 'authenticated' ||
        typeof jwt.exp !== 'number' ||
        jwt.exp <= Date.now() / 1000
      )
        throw new SafeError('UNAUTHENTICATED');
      const input = await readJson(request);

      if (operation === 'change-password') {
        if (
          Object.keys(input).some((key) => key !== 'password') ||
          typeof input.password !== 'string'
        )
          throw new SafeError('INVALID_INPUT');
        const bytes = new TextEncoder().encode(input.password).length;
        if (input.password.trim().length < 12 || bytes > 72) throw new SafeError('WEAK_PASSWORD');
        const signedIn = authTime(jwt);
        if (signedIn < Date.now() / 1000 - recentAuthSeconds)
          throw new SafeError('REAUTH_REQUIRED');
        await updateUser(actor, { password: input.password });
        await serviceRpc('workstel_user_admin_flag', { p_user_id: actor, p_must_change: false });
        await audit(actor, operation, 'success');
        return respond(200, { data: { changed: true }, meta: { reference } });
      }

      // Every other operation is for platform developers, checked with the caller's own token.
      const access = await call(config.supabaseUrl + '/rest/v1/rpc/workstel_module_access', {
        method: 'POST',
        headers: {
          apikey: config.publicKey,
          Authorization: authorization,
          'Content-Type': 'application/json',
        },
        body: '{}',
      });
      const meta = access.body.meta as Record<string, unknown> | undefined;
      if (access.status >= 300 || meta?.platformAdmin !== true) {
        await audit(null, operation, 'denied').catch(() => undefined);
        throw new SafeError('ACCESS_DENIED');
      }

      if (operation === 'create') {
        const email = typeof input.email === 'string' ? input.email.trim().toLowerCase() : '';
        if (
          Object.keys(input).some((key) => key !== 'email') ||
          email.length > 254 ||
          !emailPattern.test(email)
        )
          throw new SafeError('INVALID_INPUT');
        const password = temporaryPassword();
        const created = await call(config.supabaseUrl + '/auth/v1/admin/users', {
          method: 'POST',
          headers: serviceHeaders,
          body: JSON.stringify({ email, password, email_confirm: true }),
        });
        if (created.status === 422 || created.status === 409) throw new SafeError('EMAIL_EXISTS');
        const id = String(created.body.id ?? '');
        if (created.status >= 300 || !uuid.test(id)) throw new SafeError('SERVICE_UNAVAILABLE');
        await serviceRpc('workstel_user_admin_flag', { p_user_id: id, p_must_change: true });
        await audit(id, operation, 'success');
        return respond(200, {
          data: { userId: id, email, temporaryPassword: password },
          meta: { reference },
        });
      }

      const target = input.userId;
      if (
        Object.keys(input).some((key) => key !== 'userId') ||
        typeof target !== 'string' ||
        !uuid.test(target)
      )
        throw new SafeError('INVALID_INPUT');
      // Developers change their own password and cannot lock themselves out.
      if (target === actor) throw new SafeError('SELF_ACTION');
      if (operation === 'reset-password') {
        const password = temporaryPassword();
        await updateUser(target, { password });
        await serviceRpc('workstel_user_admin_flag', { p_user_id: target, p_must_change: true });
        await audit(target, operation, 'success');
        return respond(200, {
          data: { userId: target, temporaryPassword: password },
          meta: { reference },
        });
      }
      await updateUser(target, { ban_duration: operation === 'block' ? '876000h' : 'none' });
      await audit(target, operation, 'success');
      return respond(200, {
        data: { userId: target, blocked: operation === 'block' },
        meta: { reference },
      });
    } catch (error) {
      const code = error instanceof SafeError ? error.code : 'SERVICE_UNAVAILABLE';
      return respond(statusFor[code], { error: { code, reference } });
    }
  };
}
