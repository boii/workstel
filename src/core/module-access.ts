/** Server-granted capabilities for one operational module in one hotel department. */
export interface ModuleAssignment {
  moduleId: string;
  hotelId: string;
  hotelName: string;
  departmentId: string;
  departmentCode: string;
  departmentName: string;
  canRead: boolean;
  canWrite: boolean;
  canManage: boolean;
}
export interface ModuleAccess {
  installed: string[];
  assignments: ModuleAssignment[];
}
export const noModuleAccess: ModuleAccess = Object.freeze({ installed: [], assignments: [] });

const textFields = [
  'moduleId',
  'hotelId',
  'hotelName',
  'departmentId',
  'departmentCode',
  'departmentName',
] as const;
const flagFields = ['canRead', 'canWrite', 'canManage'] as const;

/** Validate the workstel_module_access response; anything unexpected fails closed. */
export function parseModuleAccess(response: unknown): ModuleAccess {
  if (!response || typeof response !== 'object') return noModuleAccess;
  const { data, meta } = response as { data?: unknown; meta?: { installedModules?: unknown } };
  const reported = meta?.installedModules;
  if (
    !Array.isArray(data) ||
    data.length > 500 ||
    !Array.isArray(reported) ||
    !reported.every((id) => typeof id === 'string')
  )
    return noModuleAccess;
  const installed: string[] = reported;
  const valid = data.every((row) => {
    if (!row || typeof row !== 'object') return false;
    const record = row as Record<string, unknown>;
    return (
      textFields.every((field) => typeof record[field] === 'string') &&
      flagFields.every((field) => typeof record[field] === 'boolean') &&
      installed.includes(record.moduleId as string)
    );
  });
  if (!valid) return noModuleAccess;
  return {
    installed: [...installed],
    assignments: (data as ModuleAssignment[]).filter((row) => row.canRead),
  };
}

/** A module opens only when the server installed it and grants read access somewhere. */
export function canUseModule(access: ModuleAccess, moduleId: string) {
  return (
    access.installed.includes(moduleId) &&
    access.assignments.some((row) => row.moduleId === moduleId && row.canRead)
  );
}
