import type { RouteRecordRaw } from 'vue-router';
import { vaultRoutes } from './modules/vault/routes';
import { binCardRoutes } from './modules/bin-card/routes';
import { vehicleRoutes } from './modules/vehicle/routes';
import { documentsRoutes } from './modules/documents/routes';
import { salesCrmRoutes } from './modules/sales-crm/routes';

export const shellPaths: Record<string, string> = {
  Dashboard: '/',
  'My tasks': '/tasks',
  Favorites: '/favorites',
  Settings: '/settings',
  Help: '/help',
  Users: '/admin/users',
};

export const routes: RouteRecordRaw[] = [
  ...Object.entries(shellPaths).map(([view, path]) => ({
    path,
    name: view,
    component: { render: () => null },
    meta: { view },
  })),
  ...vaultRoutes,
  ...binCardRoutes,
  ...vehicleRoutes,
  ...documentsRoutes,
  ...salesCrmRoutes,
  {
    path: '/:pathMatch(.*)*',
    name: 'not-found',
    component: { render: () => null },
    meta: { view: 'Not found' },
  },
];
