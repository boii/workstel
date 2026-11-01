import { makeVaultHandler } from './handler.ts';
declare const Deno: {
  env: { get(name: string): string | undefined };
  serve(handler: (request: Request) => Promise<Response>): void;
};
const env = (name: string) => Deno.env.get(name) ?? '';
Deno.serve(
  makeVaultHandler({
    supabaseUrl: env('SUPABASE_URL').replace(/\/$/, ''),
    publicKey: env('SUPABASE_ANON_KEY'),
    serviceKey: env('SUPABASE_SERVICE_ROLE_KEY'),
    openBaoUrl: env('WORKSTEL_OPENBAO_URL').replace(/\/$/, ''),
    roleId: env('WORKSTEL_OPENBAO_ROLE_ID'),
    secretId: env('WORKSTEL_OPENBAO_SECRET_ID'),
    frontendOrigin: env('WORKSTEL_FRONTEND_ORIGIN'),
    enabled: env('WORKSTEL_SECRET_SERVICE_ENABLED') === 'true',
  }),
);
