import { defineModule } from '../../core/module';
export default defineModule({
  id: 'sales-crm',
  version: '1.0.0',
  title: 'Sales CRM',
  description: 'Manage leads and sales follow-ups.',
  category: 'Commercial',
  icon: 'mdi-handshake-outline',
  color: 'peach',
  availability: 'available',
  access: 'module-grants',
  permissions: ['sales-crm:read', 'sales-crm:write', 'sales-crm:manage'],
  publishes: ['sales-crm.deal-won.v1'],
  subscribes: [],
});
