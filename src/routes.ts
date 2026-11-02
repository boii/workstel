import type { RouteRecordRaw } from 'vue-router';
import { vaultRoutes } from './modules/vault/routes';

export const shellPaths: Record<string, string> = {
  Dashboard: '/',
  'My tasks': '/tasks',
  Favorites: '/favorites',
  Settings: '/settings',
  Help: '/help',
};

export const routes: RouteRecordRaw[] = [
  ...Object.entries(shellPaths).map(([view, path]) => ({
    path,
    name: view,
    component: { render: () => null },
    meta: { view },
  })),
  ...vaultRoutes,
  {
    path: '/:pathMatch(.*)*',
    name: 'not-found',
    component: { render: () => null },
    meta: { view: 'Not found' },
  },
];
