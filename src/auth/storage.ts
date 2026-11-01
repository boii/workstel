import type { SupportedStorage } from '@supabase/supabase-js';
/** Tokens stay in memory. Only a short-lived OAuth PKCE verifier survives the redirect. */
export function createAuthStorage(temporary?: Storage): SupportedStorage {
  const memory = new Map<string, string>();
  return {
    getItem(key) {
      if (key.endsWith('-code-verifier')) {
        try {
          const saved = temporary?.getItem(key);
          if (!saved) return null;
          const item = JSON.parse(saved) as { value: string; expires: number };
          if (item.expires > Date.now() && typeof item.value === 'string') return item.value;
          temporary?.removeItem(key);
        } catch {
          /* Deny stale or malformed OAuth attempts. */
        }
        return null;
      }
      return memory.get(key) ?? null;
    },
    setItem(key, value) {
      if (key.endsWith('-code-verifier')) {
        if (!temporary) throw Error('OAuth temporary storage is unavailable.');
        temporary.setItem(key, JSON.stringify({ value, expires: Date.now() + 600000 }));
        return;
      }
      memory.set(key, value);
    },
    removeItem(key) {
      memory.delete(key);
      if (key.endsWith('-code-verifier')) temporary?.removeItem(key);
    },
  };
}
