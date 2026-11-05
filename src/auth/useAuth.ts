import { ref, onScopeDispose } from 'vue';
import type { Session } from '@supabase/supabase-js';
import { getSupabase } from './client';
import { runtime } from '../config/runtime';
import { noModuleAccess, parseModuleAccess } from '../core/module-access';
import type { ModuleAccess } from '../core/module-access';
export interface StaffAssignment {
  hotelId: string;
  hotelName: string;
  departmentId: string;
  departmentCode: string;
  departmentName: string;
  canRead: boolean;
  canWrite: boolean;
  canArchive: boolean;
  canAudit: boolean;
}
export function useAuth() {
  const authenticated = ref(false),
    restoring = ref(!runtime.demo && runtime.configured),
    busy = ref(false),
    failure = ref<'authFailed' | 'authUnavailable' | 'accessDenied' | null>(null),
    email = ref(''),
    vaultReady = ref(false),
    googleEnabled = ref(false),
    emailEnabled = ref(false),
    assignments = ref<StaffAssignment[]>([]),
    moduleAccess = ref<ModuleAccess>(noModuleAccess);
  let generation = 0;
  let stop: (() => void) | undefined;
  async function synchronize(session: Session | null) {
    const current = ++generation;
    if (!session) {
      vaultReady.value = false;
      moduleAccess.value = noModuleAccess;
      authenticated.value = false;
      assignments.value = [];
      email.value = '';
      return;
    }
    try {
      const client = getSupabase();
      // The three checks are independent, so they run together. Every RPC still verifies the
      // token on the server, and nothing is applied unless the user check also succeeds.
      const [userResult, sessionResult, modules] = await Promise.all([
        client.auth.getUser(),
        client.rpc('workstel_session'),
        client.rpc('workstel_module_access'),
      ]);
      const { data: user, error: userError } = userResult;
      if (userError || !user.user) throw Error('Invalid session');
      const { data, error } = sessionResult;
      if (current !== generation) return;
      if (error) throw error;
      if (!Array.isArray(data?.data) || !data.data.length) {
        authenticated.value = false;
        assignments.value = [];
        email.value = '';
        failure.value = 'accessDenied';
        return;
      }
      const rows = data.data as unknown[];
      if (
        !rows.every((item) => {
          if (!item || typeof item !== 'object') return false;
          const r = item as Record<string, unknown>;
          return (
            ['hotelId', 'hotelName', 'departmentId', 'departmentCode', 'departmentName'].every(
              (k) => typeof r[k] === 'string',
            ) &&
            ['canRead', 'canWrite', 'canArchive', 'canAudit'].every(
              (k) => typeof r[k] === 'boolean',
            )
          );
        })
      )
        throw Error('Invalid access response');
      // Servers without the operational-module migration keep those modules unavailable.
      moduleAccess.value = modules.error ? noModuleAccess : parseModuleAccess(modules.data);
      assignments.value = rows as StaffAssignment[];
      vaultReady.value = data.meta?.vaultPolicy === 'private-v1';
      email.value = user.user.email ?? '';
      failure.value = null;
      authenticated.value = true;
    } catch {
      if (current === generation) {
        authenticated.value = false;
        assignments.value = [];
        moduleAccess.value = noModuleAccess;
        email.value = '';
        failure.value = 'authFailed';
      }
    }
  }
  /** Loads which sign-in methods the server allows; resolves false when unavailable. */
  async function loadSignInSettings(): Promise<boolean> {
    try {
      const response = await fetch(runtime.supabaseUrl + '/auth/v1/settings', {
        headers: { apikey: runtime.anonKey },
        signal: AbortSignal.timeout(10000),
        redirect: 'error',
      });
      if (!response.ok) return false;
      const settings = await response.json();
      googleEnabled.value = settings.external?.google === true;
      emailEnabled.value = settings.external?.email === true;
      return true;
    } catch {
      return false;
    }
  }
  async function start() {
    if (runtime.demo || !runtime.configured || stop) return;
    const client = getSupabase();
    const { data } = client.auth.onAuthStateChange((event, session) => {
      // Password sign-in synchronizes once below; token refresh still rechecks access.
      if (busy.value && (event === 'SIGNED_IN' || restoring.value)) return;
      queueMicrotask(() => {
        void synchronize(session);
      });
    });
    stop = () => data.subscription.unsubscribe();
    // Sign-in options only matter on the sign-in page, so they load alongside the session
    // restore instead of after it.
    const settingsLoaded = loadSignInSettings();
    try {
      // INITIAL_SESSION may already contain an OAuth callback session. Otherwise restore
      // via the server cookie; the marker is never a real refresh credential.
      const initial = await client.auth.getSession();
      if (!initial.data.session) {
        busy.value = true;
        const restored = await client.auth.refreshSession({ refresh_token: 'http-only-session' });
        await synchronize(restored.data.session);
        busy.value = false;
      }
      // A signed-in user sees the workspace at once; the sign-in page waits for its options.
      if (!authenticated.value && !(await settingsLoaded)) failure.value = 'authUnavailable';
    } catch {
      busy.value = false;
      failure.value = 'authUnavailable';
    } finally {
      restoring.value = false;
    }
    // The initial auth event also handles OAuth callbacks and token expiry.
  }
  async function signIn(email: string, password: string) {
    if (busy.value) return;
    if (!runtime.configured || !emailEnabled.value) {
      failure.value = 'authUnavailable';
      return;
    }
    busy.value = true;
    failure.value = null;
    try {
      const { data, error } = await getSupabase().auth.signInWithPassword({
        email: email.trim(),
        password,
      });
      if (error) throw error;
      await synchronize(data.session);
    } catch {
      failure.value = 'authFailed';
    } finally {
      busy.value = false;
    }
  }
  async function google() {
    if (busy.value) return;
    if (!runtime.configured || !googleEnabled.value) {
      failure.value = 'authUnavailable';
      return;
    }
    busy.value = true;
    failure.value = null;
    try {
      const { error } = await getSupabase().auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: window.location.origin + '/',
          queryParams: { prompt: 'select_account', access_type: 'online' },
        },
      });
      if (error) throw error;
    } catch {
      failure.value = 'authFailed';
      busy.value = false;
    }
  }
  /** Re-read module switches and grants, for example after a developer switches a module. */
  async function reloadModuleAccess() {
    if (runtime.demo || !authenticated.value) return;
    const current = generation;
    const modules = await getSupabase().rpc('workstel_module_access');
    if (current !== generation) return;
    moduleAccess.value = modules.error ? noModuleAccess : parseModuleAccess(modules.data);
  }
  async function signOut() {
    ++generation;
    authenticated.value = false;
    assignments.value = [];
    email.value = '';
    vaultReady.value = false;
    moduleAccess.value = noModuleAccess;
    try {
      if (runtime.configured) await getSupabase().auth.signOut({ scope: 'local' });
    } catch {
      failure.value = 'authFailed';
    }
  }
  onScopeDispose(() => {
    ++generation;
    stop?.();
  });
  return {
    authenticated,
    restoring,
    busy,
    failure,
    email,
    assignments,
    moduleAccess,
    reloadModuleAccess,
    vaultReady,
    googleEnabled,
    emailEnabled,
    start,
    signIn,
    google,
    signOut,
  };
}
