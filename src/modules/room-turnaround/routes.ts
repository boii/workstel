import type { RouteRecordRaw } from 'vue-router';

export const roomTurnaroundRoutes: RouteRecordRaw[] = [
  {
    path: '/room-turnaround',
    name: 'room-turnaround',
    component: () => import('./pages/ModuleListPage.vue'),
    meta: { view: 'Room Turnaround', moduleId: 'room-turnaround' },
  },
];
