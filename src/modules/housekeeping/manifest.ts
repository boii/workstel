import { defineModule } from '../../core/module';
export default defineModule({
  id: 'housekeeping',
  version: '1.0.0',
  title: 'Housekeeping',
  description: 'Room status and cleaning times.',
  category: 'Operations',
  icon: 'mdi-broom',
  color: 'mint',
  availability: 'available',
  access: 'module-grants',
  permissions: ['housekeeping:read', 'housekeeping:write', 'housekeeping:manage'],
  publishes: ['housekeeping.room-ready.v1'],
  subscribes: [],
});
