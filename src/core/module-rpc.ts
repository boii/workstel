/** Error code from a module RPC; messages are resolved by the calling module. */
export class ModuleRequestError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}

/** Call a scoped Supabase RPC that answers with {data, meta} or {error}. */
export async function moduleRpc(
  name: string,
  args: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<{ data: unknown; meta?: Record<string, unknown> }> {
  const { getSupabase } = await import('../auth/client');
  const request = getSupabase().rpc(name, args);
  const { data, error } = await (signal ? request.abortSignal(signal) : request);
  if (error)
    throw new ModuleRequestError(
      error.code === 'PGRST301' || error.code === 'PGRST303' || error.code === '42501'
        ? 'ACCESS_DENIED'
        : 'REQUEST_FAILED',
    );
  if (!data || typeof data !== 'object') throw new ModuleRequestError('INVALID_RESPONSE');
  if ('error' in data && data.error) throw new ModuleRequestError(String(data.error));
  return data as { data: unknown; meta?: Record<string, unknown> };
}

export const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A next-page cursor must be a UUID or absent. */
export function parseCursor(meta: Record<string, unknown> | undefined): string | null {
  const next = meta?.nextCursor;
  if (next === null || next === undefined) return null;
  if (typeof next !== 'string' || !uuidPattern.test(next))
    throw new ModuleRequestError('INVALID_RESPONSE');
  return next;
}
