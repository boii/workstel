/** Route token exchange through the same-origin HttpOnly cookie bridge. */
export function createSessionFetch(
  supabaseUrl: string,
  fetcher: typeof fetch = globalThis.fetch,
): typeof fetch {
  return async (input, init) => {
    const url = new URL(
      typeof input === 'string' ? input : input instanceof URL ? input.href : input.url,
    );
    if (
      url.origin === new URL(supabaseUrl).origin &&
      ['/auth/v1/token', '/auth/v1/logout'].includes(url.pathname)
    ) {
      const logout = url.pathname.endsWith('/logout');
      const headers = new Headers(init?.headers);
      headers.delete('apikey');
      headers.set('Content-Type', 'application/json');
      return fetcher('/api/session' + (logout ? '' : url.search), {
        method: logout ? 'DELETE' : 'POST',
        headers,
        body: logout ? undefined : init?.body,
        credentials: 'same-origin',
        cache: 'no-store',
        redirect: 'error',
        signal: AbortSignal.timeout(20000),
      });
    }
    return fetcher(input, init);
  };
}
