import { createClient } from '@supabase/supabase-js';
import type { SupabaseClient } from '@supabase/supabase-js';
import { runtime } from '../config/runtime';
import { createAuthStorage } from './storage';
import { createSessionFetch } from './sessionFetch';
let client: SupabaseClient | undefined;
export function getSupabase(): SupabaseClient {
  if (!runtime.configured) throw Error('Production authentication is not configured.');
  if (!client)
    client = createClient(runtime.supabaseUrl, runtime.anonKey, {
      global: { fetch: createSessionFetch(runtime.supabaseUrl) },
      auth: {
        flowType: 'pkce',
        persistSession: true,
        storage: createAuthStorage(window.sessionStorage),
        storageKey: 'workstel-auth',
        detectSessionInUrl: true,
        autoRefreshToken: true,
      },
    });
  return client;
}
