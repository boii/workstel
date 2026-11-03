import vaultModule from './vault/manifest';
import binCardModule from './bin-card/manifest';
import vehicleModule from './vehicle/manifest';
import { defineModule } from '../core/module';
export const modules = [
  vaultModule,
  binCardModule,
  vehicleModule,
  defineModule({
    id: 'sales-crm',
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
    version: '1.0.0',
    title: 'Daily Checklist',
    description: 'Daily and shift task checklists.',
    category: 'Operations',
    color: 'blue',
    permissions: ['checklist:read', 'checklist:write'],
    publishes: ['checklist.completed.v1'],
    subscribes: ['vehicle.inspected.v1'],
  }),
  defineModule({
    id: 'documents',
    version: '1.0.0',
    title: 'Documents & SOPs',
    description: 'Hotel documents and operating procedures.',
    category: 'Administration',
    color: 'mint',
    permissions: ['documents:read', 'documents:write'],
    publishes: ['documents.published.v1'],
    subscribes: [],
  }),
];
