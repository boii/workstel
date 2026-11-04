import { defineModule } from '../../core/module';
export default defineModule({
  id: 'housekeeping',
  version: '1.0.0',
  title: 'Housekeeping',
  description: 'Cleaning time per room.',
  category: 'Operations',
  icon: 'mdi-broom',
  color: 'mint',
  availability: 'available',
  access: 'module-grants',
  permissions: ['housekeeping:read', 'housekeeping:write', 'housekeeping:manage'],
  publishes: ['housekeeping.room-cleaned.v1'],
  subscribes: [],
});
