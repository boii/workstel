import { defineModule } from '../../core/module';
export default defineModule({
  id: 'room-turnaround',
  version: '1.0.0',
  title: 'Room Turnaround',
  description: 'How long each room takes to get ready.',
  category: 'Operations',
  icon: 'mdi-timer-outline',
  color: 'mint',
  availability: 'available',
  access: 'module-grants',
  permissions: ['room-turnaround:read', 'room-turnaround:write', 'room-turnaround:manage'],
  publishes: ['room-turnaround.room-cleaned.v1'],
  subscribes: [],
});
