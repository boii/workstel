import { makeVaultHandler } from './handler.ts';
declare const Deno: {
  env: { get(name: string): string | undefined };
  serve(handler: (request: Request) => Promise<Response>): void;
  createHttpClient(options: { caCerts: string[] }): unknown;
};
const env = (name: string) => Deno.env.get(name) ?? '';
const openBaoUrl = env('WORKSTEL_OPENBAO_URL').replace(/\/$/, '');
// The edge runtime ignores DENO_CERT and cannot read files outside the function bundle,
// so the public OpenBao CA is passed as base64 and trusted only for OpenBao requests.
const caPem = (() => {
  try {
    return atob(env('WORKSTEL_OPENBAO_CA_PEM_B64'));
  } catch {
    return '';
  }
})();
const openBaoClient = caPem.includes('BEGIN CERTIFICATE')
  ? Deno.createHttpClient({ caCerts: [caPem] })
  : undefined;
const fetcher: typeof fetch = (input, init) =>
  openBaoClient && openBaoUrl && String(input).startsWith(openBaoUrl + '/')
    ? fetch(input, { ...init, client: openBaoClient } as RequestInit)
    : fetch(input, init);
Deno.serve(
  makeVaultHandler(
    {
      supabaseUrl: env('SUPABASE_URL').replace(/\/$/, ''),
      publicKey: env('SUPABASE_ANON_KEY'),
      serviceKey: env('SUPABASE_SERVICE_ROLE_KEY'),
      openBaoUrl,
      roleId: env('WORKSTEL_OPENBAO_ROLE_ID'),
      secretId: env('WORKSTEL_OPENBAO_SECRET_ID'),
      frontendOrigin: env('WORKSTEL_FRONTEND_ORIGIN'),
      enabled: env('WORKSTEL_SECRET_SERVICE_ENABLED') === 'true',
    },
    fetcher,
  ),
);
