import vaultModule from './vault/manifest';
import binCardModule from './bin-card/manifest';
import vehicleModule from './vehicle/manifest';
import documentsModule from './documents/manifest';
import salesCrmModule from './sales-crm/manifest';
import roomTurnaroundModule from './room-turnaround/manifest';
import casualAttendanceModule from './casual-attendance/manifest';
import { defineModule } from '../core/module';
export const modules = [
  vaultModule,
  binCardModule,
  vehicleModule,
  roomTurnaroundModule,
  casualAttendanceModule,
  salesCrmModule,
  defineModule({
    id: 'checklist',
    icon: 'mdi-clipboard-check-outline',
    version: '1.0.0',
    title: 'Daily Checklist',
    description: 'Daily and shift task checklists.',
    category: 'Operations',
    color: 'blue',
    permissions: ['checklist:read', 'checklist:write'],
    publishes: ['checklist.completed.v1'],
    subscribes: ['vehicle.inspected.v1'],
  }),
  documentsModule,
];
