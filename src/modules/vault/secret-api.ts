import { getSupabase } from '../../auth/client';
import { runtime } from '../../config/runtime';
export class SecretOperationError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}
export async function secretOperation(
  operation: 'status' | 'inspect' | 'write' | 'reveal',
  body: Record<string, unknown>,
  signal?: AbortSignal,
) {
  const { data, error } = await getSupabase().auth.getSession();
  if (error || !data.session) throw new SecretOperationError('UNAUTHENTICATED');
  let response: Response;
  try {
    response = await fetch(runtime.supabaseUrl + '/functions/v1/workstel-vault/' + operation, {
      method: 'POST',
      headers: {
        apikey: runtime.anonKey,
        Authorization: 'Bearer ' + data.session.access_token,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      redirect: 'error',
      cache: 'no-store',
      signal: signal
        ? AbortSignal.any([signal, AbortSignal.timeout(35000)])
        : AbortSignal.timeout(35000),
    });
  } catch {
    throw new SecretOperationError('SERVICE_UNAVAILABLE');
  }
  let result;
  try {
    result = await response.json();
  } catch {
    throw new SecretOperationError('SERVICE_UNAVAILABLE');
  }
  if (!response.ok)
    throw new SecretOperationError(
      [
        'REAUTH_REQUIRED',
        'ACCESS_DENIED',
        'VERSION_CONFLICT',
        'RATE_LIMITED',
        'SECRET_UNAVAILABLE',
        'UNAUTHENTICATED',
      ].includes(result?.error?.code)
        ? result.error.code
        : 'SERVICE_UNAVAILABLE',
    );
  const value = result?.data;
  if (!value || typeof value !== 'object') throw new SecretOperationError('SERVICE_UNAVAILABLE');
  if (operation === 'status' && value.available === true) return { available: true };
  if (
    operation === 'inspect' &&
    typeof value.hasSecret === 'boolean' &&
    typeof value.reauthRequired === 'boolean' &&
    Number.isSafeInteger(value.version) &&
    value.version >= 0 &&
    value.hasSecret === value.version > 0
  )
    return {
      hasSecret: value.hasSecret as boolean,
      version: value.version as number,
      reauthRequired: value.reauthRequired as boolean,
    };
  if (operation === 'write' && Number.isSafeInteger(value.version) && value.version > 0)
    return { version: value.version as number };
  if (
    operation === 'reveal' &&
    typeof value.password === 'string' &&
    value.password.length &&
    new TextEncoder().encode(value.password).length <= 4096 &&
    value.expiresIn === 30
  )
    return { password: value.password as string, expiresIn: 30 };
  throw new SecretOperationError('SERVICE_UNAVAILABLE');
}
