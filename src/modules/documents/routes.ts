import type { RouteRecordRaw } from 'vue-router';

export const documentsRoutes: RouteRecordRaw[] = [
  {
    path: '/documents',
    name: 'documents',
    component: () => import('./pages/ModuleListPage.vue'),
    meta: { view: 'Documents & SOPs', moduleId: 'documents' },
  },
];
