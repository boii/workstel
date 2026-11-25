import type { RouteRecordRaw } from 'vue-router';

export const acCareRoutes: RouteRecordRaw[] = [
  {
    path: '/ac-care',
    name: 'ac-care',
    component: () => import('./pages/ModuleListPage.vue'),
    meta: { view: 'AC Care', moduleId: 'ac-care' },
  },
];
