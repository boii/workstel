import type { RouteRecordRaw } from 'vue-router';

export const casualAttendanceRoutes: RouteRecordRaw[] = [
  {
    path: '/casual-attendance',
    name: 'casual-attendance',
    component: () => import('./pages/ModuleListPage.vue'),
    meta: { view: 'Casual Attendance', moduleId: 'casual-attendance' },
  },
];
