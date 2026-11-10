import type { RouteRecordRaw } from 'vue-router';

export const casualAttendanceRoutes: RouteRecordRaw[] = [
  {
    path: '/casual-attendance',
    name: 'casual-attendance',
    component: () => import('./pages/ModuleListPage.vue'),
    meta: { view: 'Casual Attendance', moduleId: 'casual-attendance' },
  },
  {
    // Self check-in for a linked account. Accounts without workspace access are shown this
    // page by the shell's attendance-only state instead of through the workspace router view.
    path: '/casual-attendance/me',
    name: 'casual-attendance-me',
    component: () => import('./pages/MyAttendancePage.vue'),
    meta: { view: 'Casual Attendance', moduleId: 'casual-attendance' },
  },
];
