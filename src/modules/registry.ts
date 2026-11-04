import vaultModule from './vault/manifest';
import binCardModule from './bin-card/manifest';
import vehicleModule from './vehicle/manifest';
import documentsModule from './documents/manifest';
import { defineModule } from '../core/module';
export const modules = [
  vaultModule,
  binCardModule,
  vehicleModule,
  defineModule({
    id: 'sales-crm',
    icon: 'mdi-handshake-outline',
    version: '1.0.0',
    title: 'Sales CRM',
    description: 'Manage leads and sales follow-ups.',
    category: 'Commercial',
    color: 'peach',
    permissions: ['sales-crm:read', 'sales-crm:write'],
    publishes: ['sales-crm.deal-won.v1'],
    subscribes: [],
  }),
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
