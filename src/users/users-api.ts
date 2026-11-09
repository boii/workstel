import { ModuleRequestError, moduleRpc, uuidPattern } from '../core/module-rpc';
import { runtime } from '../config/runtime';

export type ModuleLevel = 'none' | 'read' | 'write' | 'manage';
export const moduleLevels: ModuleLevel[] = ['none', 'read', 'write', 'manage'];
export interface Membership {
  departmentId: string;
  enabled: boolean;
  canRead: boolean;
  canWrite: boolean;
  canArchive: boolean;
  canAudit: boolean;
}
export interface ModuleGrant {
  moduleId: string;
  departmentId: string;
  level: ModuleLevel;
}
export interface UserRecord {
  id: string;
  email: string;
  createdAt: string;
  lastSignInAt: string | null;
  blocked: boolean;
  developer: boolean;
  mustChangePassword: boolean;
  memberships: Membership[];
  moduleGrants: ModuleGrant[];
}
export interface DepartmentRef {
  id: string;
  hotelId: string;
  hotelName: string;
  code: string;
  name: string;
}
export interface UserDirectory {
  users: UserRecord[];
  departments: DepartmentRef[];
  modules: string[];
}
export type MembershipInput = Omit<Membership, 'departmentId'>;
export interface OwnedVaultAccount {
  id: string;
  name: string;
  status: 'active' | 'archived';
  departmentName: string;
}
export interface VaultTransferResult {
  transferred: number;
  skipped: { id: string; name: string; departmentName: string }[];
}
export interface UsersApi {
  list(): Promise<UserDirectory>;
  setMembership(userId: string, departmentId: string, input: MembershipInput): Promise<void>;
  setModuleLevel(
    userId: string,
    departmentId: string,
    moduleId: string,
    level: ModuleLevel,
  ): Promise<void>;
  setDeveloper(userId: string, developer: boolean): Promise<void>;
  /** The name becomes the new account's profile display name. */
  create(
    email: string,
    name: string,
  ): Promise<{ userId: string; email: string; temporaryPassword: string }>;
  resetPassword(userId: string): Promise<{ temporaryPassword: string }>;
  setBlocked(userId: string, blocked: boolean): Promise<void>;
  /** Vault accounts the user owns; null when the server has no ownership support yet. */
  ownedVaultAccounts(userId: string): Promise<OwnedVaultAccount[] | null>;
  transferVaultAccounts(fromUserId: string, toUserId: string): Promise<VaultTransferResult>;
}

const invalid = () => new ModuleRequestError('INVALID_RESPONSE');
const isText = (value: unknown): value is string => typeof value === 'string';
const isTime = (value: unknown) => isText(value) && !Number.isNaN(Date.parse(value));
const flags = ['enabled', 'canRead', 'canWrite', 'canArchive', 'canAudit'] as const;

export function parseDirectory(result: {
  data: unknown;
  meta?: Record<string, unknown>;
}): UserDirectory {
  const { data, meta } = result;
  if (!Array.isArray(data) || data.length > 500) throw invalid();
  const departments = meta?.departments;
  const modules = meta?.modules;
  if (!Array.isArray(departments) || !Array.isArray(modules) || !modules.every(isText))
    throw invalid();
  const parsedDepartments = departments.map((raw: Record<string, unknown>) => {
    if (!raw || !['id', 'hotelId', 'hotelName', 'code', 'name'].every((key) => isText(raw[key])))
      throw invalid();
    return raw as unknown as DepartmentRef;
  });
  const users = data.map((raw: Record<string, unknown>) => {
    if (
      !raw ||
      !isText(raw.id) ||
      !uuidPattern.test(raw.id) ||
      !isText(raw.email) ||
      !isTime(raw.createdAt) ||
      !(raw.lastSignInAt === null || isTime(raw.lastSignInAt)) ||
      typeof raw.blocked !== 'boolean' ||
      typeof raw.developer !== 'boolean' ||
      typeof raw.mustChangePassword !== 'boolean' ||
      !Array.isArray(raw.memberships) ||
      !Array.isArray(raw.moduleGrants)
    )
      throw invalid();
    const memberships = raw.memberships.map((m: Record<string, unknown>) => {
      if (!m || !isText(m.departmentId) || !flags.every((flag) => typeof m[flag] === 'boolean'))
        throw invalid();
      return m as unknown as Membership;
    });
    const moduleGrants = raw.moduleGrants.map((g: Record<string, unknown>) => {
      if (
        !g ||
        !isText(g.moduleId) ||
        !isText(g.departmentId) ||
        !moduleLevels.includes(g.level as ModuleLevel)
      )
        throw invalid();
      return g as unknown as ModuleGrant;
    });
    return {
      id: raw.id,
      email: raw.email,
      createdAt: String(raw.createdAt),
      lastSignInAt: (raw.lastSignInAt as string | null) ?? null,
      blocked: raw.blocked,
      developer: raw.developer,
      mustChangePassword: raw.mustChangePassword,
      memberships,
      moduleGrants,
    };
  });
  return { users, departments: parsedDepartments, modules: [...modules] };
}

const functionErrors = [
  'ACCESS_DENIED',
  'EMAIL_EXISTS',
  'INVALID_INPUT',
  'NOT_FOUND',
  'REAUTH_REQUIRED',
  'SELF_ACTION',
  'UNAUTHENTICATED',
  'WEAK_PASSWORD',
];
/** Call the workstel-users edge function with the caller's own session token. */
export async function usersFunction(operation: string, body: Record<string, unknown>) {
  const { getSupabase } = await import('../auth/client');
  const { data, error } = await getSupabase().auth.getSession();
  if (error || !data.session) throw new ModuleRequestError('UNAUTHENTICATED');
  let response: Response;
  try {
    response = await fetch(runtime.supabaseUrl + '/functions/v1/workstel-users/' + operation, {
      method: 'POST',
      headers: {
        apikey: runtime.anonKey,
        Authorization: 'Bearer ' + data.session.access_token,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      redirect: 'error',
      cache: 'no-store',
      signal: AbortSignal.timeout(20000),
    });
  } catch {
    throw new ModuleRequestError('REQUEST_FAILED');
  }
  const result = await response.json().catch(() => null);
  if (!response.ok) {
    const code = result?.error?.code;
    throw new ModuleRequestError(functionErrors.includes(code) ? code : 'REQUEST_FAILED');
  }
  if (!result?.data || typeof result.data !== 'object') throw invalid();
  return result.data as Record<string, unknown>;
}

const temporary = (value: unknown) => {
  if (!isText(value) || value.length < 12) throw invalid();
  return value;
};

export function createLiveUsersApi(rpc = moduleRpc, call = usersFunction): UsersApi {
  return {
    async list() {
      return parseDirectory(await rpc('workstel_admin_list_users', {}));
    },
    async setMembership(userId, departmentId, input) {
      await rpc('workstel_admin_set_membership', {
        p_user_id: userId,
        p_department_id: departmentId,
        p_input: input,
      });
    },
    async setModuleLevel(userId, departmentId, moduleId, level) {
      await rpc('workstel_admin_set_module_level', {
        p_user_id: userId,
        p_department_id: departmentId,
        p_module_id: moduleId,
        p_level: level,
      });
    },
    async setDeveloper(userId, developer) {
      await rpc('workstel_admin_set_developer', { p_user_id: userId, p_developer: developer });
    },
    async create(email, name) {
      const data = await call('create', { email, name });
      if (!isText(data.userId) || !isText(data.email)) throw invalid();
      return {
        userId: data.userId,
        email: data.email,
        temporaryPassword: temporary(data.temporaryPassword),
      };
    },
    async resetPassword(userId) {
      const data = await call('reset-password', { userId });
      return { temporaryPassword: temporary(data.temporaryPassword) };
    },
    async setBlocked(userId, blocked) {
      await call(blocked ? 'block' : 'unblock', { userId });
    },
    async ownedVaultAccounts(userId) {
      let result;
      try {
        result = await rpc('vault_admin_owned_accounts', { p_user_id: userId });
      } catch (error) {
        if (error instanceof ModuleRequestError && error.code === 'REQUEST_FAILED') return null;
        throw error;
      }
      if (!Array.isArray(result.data) || result.data.length > 1000) throw invalid();
      return result.data.map((raw: Record<string, unknown>) => {
        if (
          !raw ||
          !isText(raw.id) ||
          !isText(raw.name) ||
          !isText(raw.departmentName) ||
          !['active', 'archived'].includes(String(raw.status))
        )
          throw invalid();
        return raw as unknown as OwnedVaultAccount;
      });
    },
    async transferVaultAccounts(fromUserId, toUserId) {
      const result = await rpc('vault_admin_transfer_accounts', {
        p_from: fromUserId,
        p_to: toUserId,
      });
      const data = result.data as Record<string, unknown> | null;
      if (!data || !Number.isSafeInteger(data.transferred) || !Array.isArray(data.skipped))
        throw invalid();
      return {
        transferred: Number(data.transferred),
        skipped: (data.skipped as Record<string, unknown>[]).map((row) => {
          if (!row || !isText(row.id) || !isText(row.name) || !isText(row.departmentName))
            throw invalid();
          return { id: row.id, name: row.name, departmentName: row.departmentName };
        }),
      };
    },
  };
}
