import { makeSecretCipher } from './crypto.ts';
/** Server-only Vault orchestration. No keys, plaintext or tokens are logged. */
export interface VaultServerConfig {
  supabaseUrl: string;
  publicKey: string;
  serviceKey: string;
  keyring: string;
  frontendOrigin: string;
  enabled: boolean;
}
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
class SafeError extends Error {
  constructor(
    readonly code: string,
    readonly status = 503,
  ) {
    super(code);
  }
}
function claims(token: string): Record<string, unknown> {
  try {
    return JSON.parse(
      new TextDecoder('utf-8', { fatal: true }).decode(
        Uint8Array.from(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')), (c) =>
          c.charCodeAt(0),
        ),
      ),
    );
  } catch {
    throw new SafeError('UNAUTHENTICATED', 401);
  }
}
function configured(c: VaultServerConfig) {
  try {
    const supabase = new URL(c.supabaseUrl),
      frontend = new URL(c.frontendOrigin);
    return (
      c.enabled &&
      !!c.publicKey &&
      !!c.serviceKey &&
      !!c.keyring &&
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
    throw new SafeError('INVALID_INPUT', 400);
  if (Number(request.headers.get('content-length') ?? 0) > 32768)
    throw new SafeError('INVALID_INPUT', 413);
  const reader = request.body?.getReader();
  if (!reader) throw new SafeError('INVALID_INPUT', 400);
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.length;
      if (length > 32768) {
        await reader.cancel();
        throw new SafeError('INVALID_INPUT', 413);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  try {
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.length;
    }
    const result = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    if (!result || Array.isArray(result) || typeof result !== 'object') throw Error();
    return result as Record<string, unknown>;
  } catch {
    throw new SafeError('INVALID_INPUT', 400);
  }
}
export function makeVaultHandler(config: VaultServerConfig, fetcher: typeof fetch = fetch) {
  const cipher = makeSecretCipher(config.keyring).catch(() => null);
  return async function handle(request: Request): Promise<Response> {
    const reference = crypto.randomUUID();
    let recordFailure: (() => Promise<unknown>) | undefined;
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
    function response(status: number, body: unknown) {
      return new Response(JSON.stringify(body), { status, headers });
    }
    try {
      if (origin && origin !== config.frontendOrigin) throw new SafeError('ACCESS_DENIED', 403);
      if (request.method === 'OPTIONS')
        return new Response(null, {
          status: 204,
          headers: {
            ...headers,
            'Access-Control-Allow-Methods': 'POST, OPTIONS',
            'Access-Control-Allow-Headers': 'authorization, apikey, content-type',
          },
        });
      if (request.method !== 'POST') throw new SafeError('METHOD_NOT_ALLOWED', 405);
      const encryption = await cipher;
      if (!configured(config) || !encryption) throw new SafeError('SERVICE_UNAVAILABLE');
      const operation = new URL(request.url).pathname.split('/').filter(Boolean).at(-1);
      if (!['status', 'inspect', 'write', 'reveal'].includes(operation ?? ''))
        throw new SafeError('NOT_FOUND', 404);
      const authorization = request.headers.get('authorization');
      if (!authorization?.startsWith('Bearer ') || authorization.length > 16384)
        throw new SafeError('UNAUTHENTICATED', 401);
      const token = authorization.slice(7);
      // Auth validates the signature/expiry; locally decoded claims are trusted only afterward.
      async function json(url: string, init: RequestInit) {
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
        if (!result.ok)
          throw new SafeError(
            result.status === 401 ? 'UNAUTHENTICATED' : 'SERVICE_UNAVAILABLE',
            result.status === 401 ? 401 : 503,
          );
        if (result.status === 204) return {};
        try {
          const reader = result.body?.getReader();
          if (!reader) throw Error();
          const chunks: Uint8Array[] = [];
          let length = 0;
          try {
            for (;;) {
              const { done, value } = await reader.read();
              if (done) break;
              length += value.length;
              if (length > 262144) {
                await reader.cancel();
                throw Error();
              }
              chunks.push(value);
            }
          } finally {
            reader.releaseLock();
          }
          const bytes = new Uint8Array(length);
          let offset = 0;
          for (const chunk of chunks) {
            bytes.set(chunk, offset);
            offset += chunk.length;
          }
          return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
        } catch {
          throw new SafeError('SERVICE_UNAVAILABLE');
        }
      }
      const user = await json(config.supabaseUrl + '/auth/v1/user', {
        headers: { apikey: config.publicKey, Authorization: authorization },
      });
      const jwt = claims(token);
      if (
        typeof user.id !== 'string' ||
        !uuid.test(user.id) ||
        jwt.sub !== user.id ||
        jwt.role !== 'authenticated' ||
        typeof jwt.exp !== 'number' ||
        jwt.exp <= Date.now() / 1000
      )
        throw new SafeError('UNAUTHENTICATED', 401);
      const actor = user.id;
      async function rpc(name: string, body: Record<string, unknown>) {
        const serviceHeaders: Record<string, string> = {
          apikey: config.serviceKey,
          'Content-Type': 'application/json',
        };
        if (!config.serviceKey.startsWith('sb_secret_'))
          serviceHeaders.Authorization = 'Bearer ' + config.serviceKey;
        const result = await json(config.supabaseUrl + '/rest/v1/rpc/' + name, {
          method: 'POST',
          headers: serviceHeaders,
          body: JSON.stringify(
            name === 'vault_secret_service_status'
              ? body
              : { ...body, p_correlation_id: reference },
          ),
        });
        if (result?.error) {
          const code = [
            'REAUTH_REQUIRED',
            'ACCESS_DENIED',
            'VERSION_CONFLICT',
            'RATE_LIMITED',
            'INVALID_INPUT',
            'SECRET_UNAVAILABLE',
          ].includes(String(result.error))
            ? String(result.error)
            : 'SERVICE_UNAVAILABLE';
          throw new SafeError(
            code,
            code === 'REAUTH_REQUIRED'
              ? 401
              : code === 'ACCESS_DENIED'
                ? 403
                : code === 'VERSION_CONFLICT'
                  ? 409
                  : code === 'RATE_LIMITED'
                    ? 429
                    : code === 'INVALID_INPUT'
                      ? 400
                      : code === 'SECRET_UNAVAILABLE'
                        ? 404
                        : 503,
          );
        }
        if (!result || typeof result !== 'object') throw new SafeError('SERVICE_UNAVAILABLE');
        return result;
      }
      if (operation === 'status') {
        const session = await json(config.supabaseUrl + '/rest/v1/rpc/workstel_session', {
          method: 'POST',
          headers: {
            apikey: config.publicKey,
            Authorization: authorization,
            'Content-Type': 'application/json',
          },
          body: '{}',
        });
        if (!session.data?.length || session.meta?.vaultPolicy !== 'private-v1')
          throw new SafeError('ACCESS_DENIED', 403);
        const schema = await rpc('vault_secret_service_status', {});
        if (schema.data?.schema !== 'aesgcm-v1') throw new SafeError('SERVICE_UNAVAILABLE');
        return response(200, { data: { available: true }, meta: { reference } });
      }
      const input = await readJson(request);
      const allowed =
        operation === 'write'
          ? ['accountId', 'password', 'expectedVersion', 'requestId']
          : ['accountId'];
      if (
        Object.keys(input).some((k) => !allowed.includes(k)) ||
        typeof input.accountId !== 'string' ||
        !uuid.test(input.accountId)
      )
        throw new SafeError('INVALID_INPUT', 400);
      if (
        operation === 'write' &&
        (typeof input.password !== 'string' ||
          !input.password.length ||
          new TextEncoder().encode(input.password).length > 4096 ||
          !Number.isSafeInteger(input.expectedVersion) ||
          Number(input.expectedVersion) < 0 ||
          typeof input.requestId !== 'string' ||
          !uuid.test(input.requestId))
      )
        throw new SafeError('INVALID_INPUT', 400);
      const methods = Array.isArray(jwt.amr) ? jwt.amr : [];
      const authTime = Math.max(
        0,
        ...methods
          .filter(
            (m: Record<string, unknown>) =>
              m &&
              ['password', 'oauth', 'totp', 'webauthn'].includes(String(m.method)) &&
              Number.isSafeInteger(m.timestamp),
          )
          .map((m: { timestamp: number }) => m.timestamp),
      );
      const prepared = await rpc('vault_secret_prepare', {
        p_actor: actor,
        p_account_id: input.accountId,
        p_action: operation,
        p_auth_time: authTime,
      });
      const data = prepared.data;
      if (
        !data ||
        data.id !== input.accountId ||
        !uuid.test(data.hotelId) ||
        !uuid.test(data.ownerId) ||
        !Number.isSafeInteger(data.accountVersion) ||
        !Number.isSafeInteger(data.secretVersion)
      )
        throw new SafeError('SERVICE_UNAVAILABLE');
      if (operation === 'inspect')
        return response(200, {
          data: {
            hasSecret: data.secretVersion > 0,
            version: data.secretVersion,
            reauthRequired: authTime < Date.now() / 1000 - 300 || authTime > Date.now() / 1000 + 30,
          },
          meta: { reference },
        });
      recordFailure = () =>
        rpc('vault_secret_failed', { p_actor: actor, p_account_id: input.accountId });
      const context = data.hotelId + ':' + data.id + ':' + data.ownerId;
      if (operation === 'write') {
        const ciphertext = await encryption.encrypt(input.password as string, context);
        const committed = await rpc('vault_secret_commit', {
          p_actor: actor,
          p_account_id: input.accountId,
          p_account_version: data.accountVersion,
          p_expected_version: input.expectedVersion,
          p_request_id: input.requestId,
          p_ciphertext: ciphertext,
          p_auth_time: authTime,
        });
        return response(200, { data: committed.data, meta: { reference } });
      }
      if (typeof data.ciphertext !== 'string') throw new SafeError('SECRET_UNAVAILABLE', 404);
      const secret = await encryption.decrypt(data.ciphertext, context);
      if (
        !secret ||
        typeof secret !== 'object' ||
        !('password' in secret) ||
        typeof secret.password !== 'string' ||
        !secret.password.length ||
        new TextEncoder().encode(secret.password).length > 4096
      )
        throw new SafeError('SERVICE_UNAVAILABLE');
      // Recheck ownership/sharing, versions and durable audit after decryption, before release.
      await rpc('vault_secret_finish_reveal', {
        p_actor: actor,
        p_account_id: input.accountId,
        p_account_version: data.accountVersion,
        p_secret_version: data.secretVersion,
        p_auth_time: authTime,
      });
      return response(200, {
        data: { password: secret.password, expiresIn: 30 },
        meta: { reference },
      });
    } catch (error) {
      try {
        await recordFailure?.();
      } catch {
        /* Audit failure never permits plaintext release. */
      }
      const safe = error instanceof SafeError ? error : new SafeError('SERVICE_UNAVAILABLE');
      return response(safe.status, { error: { code: safe.code, reference } });
    }
  };
}
