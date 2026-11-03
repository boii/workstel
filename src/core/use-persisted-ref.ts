import { ref, watch } from 'vue';
import type { Ref } from 'vue';

/**
 * Remembers a small, non-secret UI preference in this browser only.
 * Storage failures (private windows, blocked storage, quota) never break rendering,
 * and stored values are validated again before they are reused.
 */
export function usePersistedRef<T>(
  key: string,
  fallback: T,
  isValid: (value: unknown) => value is T,
): Ref<T> {
  const value = ref(read(key, fallback, isValid)) as Ref<T>;
  watch(value, (next) => write(key, next));
  return value;
}

function read<T>(key: string, fallback: T, isValid: (value: unknown) => value is T): T {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return fallback;
    const parsed: unknown = JSON.parse(raw);
    return isValid(parsed) ? parsed : fallback;
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* Keep the preference for the current session when storage is unavailable. */
  }
}
