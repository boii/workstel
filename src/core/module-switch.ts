import { ref } from 'vue';
import { ModuleRequestError, moduleRpc } from './module-rpc';

/** Server state of one installed module, as shown to platform developers. */
export interface ModuleState {
  moduleId: string;
  schemaVersion: number;
  enabled: boolean;
  updatedAt: string | null;
  updatedByEmail: string;
}
export interface ModuleSwitchApi {
  list(): Promise<ModuleState[]>;
  setEnabled(moduleId: string, enabled: boolean): Promise<void>;
}

const isTime = (value: unknown) => typeof value === 'string' && !Number.isNaN(Date.parse(value));

export function parseModuleStates(data: unknown): ModuleState[] {
  if (!Array.isArray(data) || data.length > 50) throw new ModuleRequestError('INVALID_RESPONSE');
  return data.map((raw: Record<string, unknown>) => {
    if (
      !raw ||
      typeof raw.moduleId !== 'string' ||
      !Number.isInteger(raw.schemaVersion) ||
      typeof raw.enabled !== 'boolean' ||
      !(raw.updatedAt === null || isTime(raw.updatedAt)) ||
      !(raw.updatedByEmail === null || typeof raw.updatedByEmail === 'string')
    )
      throw new ModuleRequestError('INVALID_RESPONSE');
    return {
      moduleId: raw.moduleId,
      schemaVersion: Number(raw.schemaVersion),
      enabled: raw.enabled,
      updatedAt: (raw.updatedAt as string | null) ?? null,
      updatedByEmail: (raw.updatedByEmail as string | null) ?? '',
    };
  });
}

export function createLiveModuleSwitch(rpc = moduleRpc): ModuleSwitchApi {
  return {
    async list() {
      return parseModuleStates((await rpc('workstel_list_modules', {})).data);
    },
    async setEnabled(moduleId, enabled) {
      const result = await rpc('workstel_set_module_enabled', {
        p_module_id: moduleId,
        p_enabled: enabled,
      });
      const data = result.data as Record<string, unknown> | null;
      if (!data || data.moduleId !== moduleId || data.enabled !== enabled)
        throw new ModuleRequestError('INVALID_RESPONSE');
    },
  };
}

/** Demo switches live in memory, so the dashboard reacts the same way and resets on reload. */
export const demoDisabledModules = ref<string[]>([]);
export function createDemoModuleSwitch(moduleIds: string[]): ModuleSwitchApi {
  const changed = new Map<string, string>();
  return {
    async list() {
      return moduleIds.map((moduleId) => ({
        moduleId,
        schemaVersion: 1,
        enabled: !demoDisabledModules.value.includes(moduleId),
        updatedAt: changed.get(moduleId) ?? null,
        updatedByEmail: changed.has(moduleId) ? 'demo.admin@example.com' : '',
      }));
    },
    async setEnabled(moduleId, enabled) {
      demoDisabledModules.value = enabled
        ? demoDisabledModules.value.filter((id) => id !== moduleId)
        : [...new Set([...demoDisabledModules.value, moduleId])];
      changed.set(moduleId, new Date().toISOString());
    },
  };
}
