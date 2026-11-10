import { defineModule } from '../../core/module';
export default defineModule({
  id: 'casual-attendance',
  version: '1.0.0',
  title: 'Casual Attendance',
  description: 'Daily attendance for casual and trainee staff.',
  category: 'Operations',
  icon: 'mdi-account-clock-outline',
  color: 'peach',
  availability: 'available',
  access: 'module-grants',
  permissions: ['casual-attendance:read', 'casual-attendance:write', 'casual-attendance:manage'],
  publishes: [],
  subscribes: [],
});
