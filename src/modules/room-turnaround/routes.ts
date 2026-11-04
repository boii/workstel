import type { RouteRecordRaw } from 'vue-router';

export const housekeepingRoutes: RouteRecordRaw[] = [
  {
    path: '/housekeeping',
    name: 'housekeeping',
    component: () => import('./pages/ModuleListPage.vue'),
    meta: { view: 'Housekeeping', moduleId: 'housekeeping' },
  },
];
