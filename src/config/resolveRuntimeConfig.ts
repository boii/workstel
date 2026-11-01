export interface RuntimeConfig {
  demo: boolean;
  supabaseUrl: string;
  anonKey: string;
  configured: boolean;
}
function isPublicKey(value: string): boolean {
  if (value.startsWith('sb_publishable_')) return value.length > 30;
  try {
    const payload = JSON.parse(atob(value.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))) as {
      role?: unknown;
    };
    return payload.role === 'anon';
  } catch {
    return false;
  }
}
export function resolveRuntimeConfig(
  env: Record<string, unknown>,
  development: boolean,
): RuntimeConfig {
  const demo = development && env.VITE_ENABLE_DEMO !== 'false';
  const supabaseUrl = String(env.VITE_SUPABASE_URL ?? ''),
    anonKey = String(env.VITE_SUPABASE_ANON_KEY ?? '');
  let configured = false;
  try {
    const url = new URL(supabaseUrl);
    configured =
      url.protocol === 'https:' &&
      !url.hostname.endsWith('.invalid') &&
      !url.username &&
      !url.password &&
      url.pathname === '/' &&
      !url.search &&
      !url.hash &&
      isPublicKey(anonKey);
  } catch {
    /* Invalid configuration keeps authentication closed. */
  }
  return { demo, supabaseUrl, anonKey, configured };
}
