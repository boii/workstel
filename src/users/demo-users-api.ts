import { ModuleRequestError } from '../core/module-rpc';
import type { DepartmentRef, UserRecord, UsersApi } from './users-api';

const demoSelf = '00000000-0000-4000-8000-000000000001';
const departments: DepartmentRef[] = [
  ['front-office', 'Front Office'],
  ['engineering', 'Engineering'],
  ['accounting', 'Accounting'],
].map(([code, name], index) => ({
  id: '00000000-0000-4000-8000-00000000010' + index,
  hotelId: 'demo-hotel',
  hotelName: 'Your Hotel',
  code,
  name,
}));

/** In-memory demo directory with the same rules as the server; it resets on reload. */
export function createDemoUsersApi(): UsersApi {
  const now = new Date().toISOString();
  const users: UserRecord[] = [
    ['demo.admin@example.com', true, false],
    ['front.desk@example.com', false, false],
    ['store.keeper@example.com', false, true],
  ].map(([email, developer, mustChange], index) => ({
    id: '00000000-0000-4000-8000-00000000000' + (index + 1),
    email: String(email),
    createdAt: now,
    lastSignInAt: index === 2 ? null : now,
    blocked: false,
    developer: Boolean(developer),
    mustChangePassword: Boolean(mustChange),
    memberships: (index === 0 ? departments : [departments[index === 1 ? 0 : 2]]).map((d) => ({
      departmentId: d.id,
      enabled: true,
      canRead: true,
      canWrite: index === 0,
      canArchive: index === 0,
      canAudit: index === 0,
    })),
    moduleGrants:
      index === 1
        ? [{ moduleId: 'vehicle', departmentId: departments[0].id, level: 'write' }]
        : index === 2
          ? [{ moduleId: 'bin-card', departmentId: departments[2].id, level: 'manage' }]
          : [],
  }));
  const find = (id: string) => {
    const user = users.find((entry) => entry.id === id);
    if (!user) throw new ModuleRequestError('NOT_FOUND');
    return user;
  };
  const password = () =>
    Array.from({ length: 4 }, () => Math.random().toString(36).slice(2, 6).padEnd(4, 'x')).join(
      '-',
    );
  return {
    async list() {
      return {
        users: structuredClone(users),
        departments: structuredClone(departments),
        modules: ['bin-card', 'vehicle'],
      };
    },
    async setMembership(userId, departmentId, input) {
      const user = find(userId);
      user.memberships = [
        ...user.memberships.filter((m) => m.departmentId !== departmentId),
        { departmentId, ...input },
      ];
    },
    async setModuleLevel(userId, departmentId, moduleId, level) {
      const user = find(userId);
      user.moduleGrants = user.moduleGrants.filter(
        (g) => !(g.departmentId === departmentId && g.moduleId === moduleId),
      );
      if (level !== 'none') user.moduleGrants.push({ moduleId, departmentId, level });
    },
    async setDeveloper(userId, developer) {
      if (!developer && userId === demoSelf) throw new ModuleRequestError('SELF_LOCKOUT');
      find(userId).developer = developer;
    },
    async create(email) {
      const normalized = email.trim().toLowerCase();
      if (users.some((user) => user.email === normalized))
        throw new ModuleRequestError('EMAIL_EXISTS');
      const user: UserRecord = {
        id: crypto.randomUUID(),
        email: normalized,
        createdAt: new Date().toISOString(),
        lastSignInAt: null,
        blocked: false,
        developer: false,
        mustChangePassword: true,
        memberships: [],
        moduleGrants: [],
      };
      users.push(user);
      return { userId: user.id, email: normalized, temporaryPassword: password() };
    },
    async resetPassword(userId) {
      if (userId === demoSelf) throw new ModuleRequestError('SELF_ACTION');
      find(userId).mustChangePassword = true;
      return { temporaryPassword: password() };
    },
    async setBlocked(userId, blocked) {
      if (userId === demoSelf) throw new ModuleRequestError('SELF_ACTION');
      find(userId).blocked = blocked;
    },
  };
}
export const demoSelfId = demoSelf;
