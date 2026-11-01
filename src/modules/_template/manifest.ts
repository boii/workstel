import { defineModule } from '../../core/module';
export default defineModule({
  id: 'new-module',
  version: '1.0.0',
  title: 'New Module',
  description: 'Describe the operational purpose of this module.',
  category: 'Operations',
  icon: 'mdi-view-module-outline',
  color: 'mint',
  permissions: ['new-module:read', 'new-module:write'],
  publishes: [],
  subscribes: [],
});
