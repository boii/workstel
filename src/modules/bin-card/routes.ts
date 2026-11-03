import type { RouteRecordRaw } from 'vue-router';

export const binCardRoutes: RouteRecordRaw[] = [
  {
    path: '/bin-card',
    name: 'bin-card',
    component: () => import('./pages/ModuleListPage.vue'),
    meta: { view: 'Bin Card', moduleId: 'bin-card' },
  },
];
