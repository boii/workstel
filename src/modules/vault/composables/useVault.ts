import { computed, ref } from 'vue';
import { normalizeEntry, validateEntry } from '../validation';
import type { VaultEntry, VaultEntryInput, VaultActivity, VaultAction } from '../types';
export function useVault() {
  const initialDate = new Date().toISOString();
  const examples: VaultEntryInput[] = [
    {
      name: 'Guest messaging portal',
      username: 'frontoffice@example.com',
      departmentId: 'front-office',
      website: 'https://guest.example.com',
      notes: 'Shared Front Office service account.',
    },
    {
      name: 'Corporate sales portal',
      username: 'sales@example.com',
      departmentId: 'sales',
      website: 'https://sales.example.com',
      notes: 'Corporate enquiries and proposals.',
    },
    {
      name: 'Network monitoring',
      username: 'it.ops@example.com',
      departmentId: 'it',
      website: 'https://network.example.com',
      notes: 'Monitoring dashboard account.',
    },
  ];
  const entries = ref<VaultEntry[]>(
    examples.map((item, index) => ({
      ...item,
      id: 'demo-account-' + index,
      hotelId: 'demo-hotel',
      createdAt: initialDate,
      updatedAt: initialDate,
      createdBy: 'demo-admin',
      updatedBy: 'demo-admin',
      references: [],
      status: 'active',
      secretStatus: 'not-connected',
      version: 1,
    })),
  );
  const activity = ref<VaultActivity[]>([]);
  function log(entryId: string, action: VaultAction) {
    activity.value.unshift({
      id: crypto.randomUUID(),
      entryId,
      action,
      occurredAt: new Date().toISOString(),
      actorId: 'demo-admin',
    });
  }
  function save(input: VaultEntryInput, id?: string) {
    const errors = validateEntry(input);
    if (Object.keys(errors).length) return { errors };
    const normalized = normalizeEntry(input),
      now = new Date().toISOString();
    if (id) {
      const entry = entries.value.find((item) => item.id === id);
      if (!entry) throw Error('Vault metadata record not found.');
      Object.assign(entry, normalized, {
        updatedAt: now,
        updatedBy: 'demo-admin',
        version: entry.version + 1,
      });
      log(id, 'updated');
      return { entry, errors: {} };
    }
    const entry: VaultEntry = {
      ...normalized,
      id: crypto.randomUUID(),
      hotelId: 'demo-hotel',
      createdAt: now,
      updatedAt: now,
      createdBy: 'demo-admin',
      updatedBy: 'demo-admin',
      references: [],
      status: 'active',
      secretStatus: 'not-connected',
      version: 1,
    };
    entries.value.unshift(entry);
    log(entry.id, 'created');
    return { entry, errors: {} };
  }
  function setStatus(id: string, status: 'active' | 'archived') {
    const entry = entries.value.find((item) => item.id === id);
    if (!entry) return;
    if (entry.status === status) return;
    entry.status = status;
    entry.updatedAt = new Date().toISOString();
    entry.version++;
    log(id, status === 'archived' ? 'archived' : 'restored');
  }
  function reset() {
    entries.value = [];
    activity.value = [];
  }
  return { entries, activity, save, setStatus, reset, total: computed(() => entries.value.length) };
}
