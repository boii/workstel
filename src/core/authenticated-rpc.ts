export class RequestError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}
export async function authenticatedRpc(
  name: string,
  args: Record<string, unknown>,
  signal?: AbortSignal,
) {
  const { getSupabase } = await import('../auth/client');
  const request = getSupabase().rpc(name, args);
  const { data, error } = await (signal ? request.abortSignal(signal) : request);
  if (error)
    throw new RequestError(
      error.code === 'PGRST301' || error.code === 'PGRST303' || error.code === '42501'
        ? 'ACCESS_DENIED'
        : 'REQUEST_FAILED',
    );
  if (!data || typeof data !== 'object') throw new RequestError('INVALID_RESPONSE');
  if (data.error) throw new RequestError(String(data.error));
  return data;
}
