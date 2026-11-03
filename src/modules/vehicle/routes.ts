import type { RouteRecordRaw } from 'vue-router';

export const vehicleRoutes: RouteRecordRaw[] = [
  {
    path: '/vehicle',
    name: 'vehicle',
    component: () => import('./pages/ModuleListPage.vue'),
    meta: { view: 'Vehicle Checklist', moduleId: 'vehicle' },
  },
];
