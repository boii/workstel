import type { RouteRecordRaw } from 'vue-router';

export const salesCrmRoutes: RouteRecordRaw[] = [
  {
    path: '/sales-crm',
    name: 'sales-crm',
    component: () => import('./pages/ModuleListPage.vue'),
    meta: { view: 'Sales CRM', moduleId: 'sales-crm' },
  },
];
