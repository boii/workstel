import { onMounted, onUnmounted } from 'vue';

export interface Shortcut {
  /** A single character, or a named key such as Escape. */
  key: string;
  /** Requires Shift to be held, as with `?`. Defaults to false. */
  shift?: boolean;
  /** Escape must still work while a field or dialog has focus. */
  allowInInputs?: boolean;
  /** When this returns false the shortcut stays inactive and nothing is prevented. */
  when?: () => boolean;
  run: () => void;
}

export interface ShortcutRow {
  keys: string;
  label: string;
}

/** True when the event came from somewhere the user is typing. */
export function isShortcutTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  return ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);
}

/**
 * Registers single-key shortcuts on the window. Browser and operating system
 * combinations (Ctrl, Meta, Alt) are never captured, shortcuts never fire while
 * the user is typing unless they opt in, and an inactive shortcut leaves the
 * event untouched so the screen that owns the key can handle it.
 */
export function useShortcuts(shortcuts: () => Shortcut[], enabled: () => boolean = () => true) {
  function onKeydown(event: KeyboardEvent) {
    if (!enabled() || event.defaultPrevented) return;
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    for (const shortcut of shortcuts()) {
      if (event.key !== shortcut.key || (shortcut.shift ?? false) !== event.shiftKey) continue;
      if (shortcut.when && !shortcut.when()) continue;
      if (isShortcutTarget(event.target) && !shortcut.allowInInputs) return;
      event.preventDefault();
      shortcut.run();
      return;
    }
  }
  onMounted(() => window.addEventListener('keydown', onKeydown));
  onUnmounted(() => window.removeEventListener('keydown', onKeydown));
}
