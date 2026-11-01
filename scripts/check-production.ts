import { loadEnv } from 'vite';
import { resolveRuntimeConfig } from '../src/config/resolveRuntimeConfig';
const env = loadEnv('production', process.cwd(), 'VITE_');
const config = resolveRuntimeConfig(env, false);
if (env.VITE_ENABLE_DEMO === 'true' || !config.configured) {
  console.error(
    'Production build blocked: configure an HTTPS Supabase origin and public anon/publishable key; disable the demo flag.',
  );
  process.exit(1);
}
console.log(
  'Production frontend configuration is valid. This does not certify server, OAuth, backup or Vault-secret readiness.',
);
