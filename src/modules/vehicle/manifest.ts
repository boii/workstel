import { defineModule } from '../../core/module';
export default defineModule({
  id: 'vehicle',
  version: '1.0.0',
  title: 'Vehicle Checklist',
  description: 'Inspect vehicle condition.',
  category: 'Operations',
  icon: 'mdi-car-outline',
  color: 'blue',
  availability: 'available',
  access: 'module-grants',
  permissions: ['vehicle:read', 'vehicle:write', 'vehicle:manage'],
  publishes: ['vehicle.inspected.v1'],
  subscribes: [],
});
