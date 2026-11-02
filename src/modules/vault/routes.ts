import type { RouteRecordRaw } from 'vue-router';

export const vaultRoutes: RouteRecordRaw[] = [
  {
    path: '/vault',
    name: 'vault',
    component: () => import('./pages/vault-route-page.vue'),
    meta: { view: 'Password Vault', moduleId: 'vault' },
  },
  {
    path: '/vault/accounts/:accountId',
    name: 'vault-account',
    component: () => import('./pages/vault-route-page.vue'),
    meta: { view: 'Password Vault', moduleId: 'vault' },
  },
];
