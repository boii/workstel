import { ref, watch } from 'vue';
import type { Ref } from 'vue';

/**
 * A notice for the module snackbar, optionally with an Undo action. Pages may still
 * assign `notice` directly; any message not set through `show` drops the Undo.
 */
export function useUndoNotice() {
  const notice = ref('');
  const undoAction = ref<(() => void) | null>(null);
  let showing = false;
  watch(
    notice,
    () => {
      if (!showing) undoAction.value = null;
    },
    { flush: 'sync' },
  );
  function show(message: string, undo: (() => void) | null = null) {
    showing = true;
    notice.value = message;
    undoAction.value = undo;
    showing = false;
  }
  return { notice, undoAction, show };
}

export interface ArchivableRecord {
  id: string;
  status: 'active' | 'archived';
  version: number;
}

interface OptimisticArchiveOptions<T extends ArchivableRecord> {
  /** The rows currently on screen. */
  rows: Ref<T[]>;
  /** The list's status filter; rows that no longer match leave the list. */
  statusFilter: () => 'active' | 'archived' | 'all';
  /** Calls the module API. The server still checks permissions and the version. */
  commit: (record: T, archived: boolean) => Promise<void>;
  show: (message: string, undo?: (() => void) | null) => void;
  messages: () => { archived: string; restored: string };
  errorMessage: (error: unknown) => string;
  /** Reloads from the server when an Undo is rejected. */
  reload: () => Promise<void> | void;
}

/**
 * Archive and restore update the list at once and offer Undo. A rejected change puts
 * the row back. Every archive/restore RPC raises the record version by one, which Undo
 * relies on to send the expected version without reloading.
 */
export function useOptimisticArchive<T extends ArchivableRecord>(
  options: OptimisticArchiveOptions<T>,
) {
  function place(row: T, index: number) {
    const rest = options.rows.value.filter((entry) => entry.id !== row.id);
    const filter = options.statusFilter();
    if (filter === 'all' || row.status === filter)
      rest.splice(Math.min(index, rest.length), 0, row);
    options.rows.value = rest;
  }
  const doneMessage = (archived: boolean) =>
    archived ? options.messages().archived : options.messages().restored;

  async function toggle(record: T) {
    const archiving = record.status === 'active';
    const index = options.rows.value.findIndex((entry) => entry.id === record.id);
    const changed = { ...record, status: archiving ? 'archived' : 'active' } as T;
    place(changed, index);
    options.show(doneMessage(archiving));
    try {
      await options.commit(record, archiving);
    } catch (error) {
      place(record, index);
      options.show(options.errorMessage(error));
      return;
    }
    const committed = { ...changed, version: record.version + 1 };
    if (options.rows.value.some((entry) => entry.id === committed.id)) place(committed, index);
    options.show(doneMessage(archiving), () => void undo(committed, record, index));
  }

  async function undo(committed: T, original: T, index: number) {
    place({ ...original, version: committed.version + 1 }, index);
    options.show(doneMessage(original.status === 'archived'));
    try {
      await options.commit(committed, original.status === 'archived');
    } catch (error) {
      options.show(options.errorMessage(error));
      await options.reload();
    }
  }

  return { toggle };
}
