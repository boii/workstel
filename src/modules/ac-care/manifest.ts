import { defineModule } from '../../core/module';
export default defineModule({
  id: 'ac-care',
  version: '1.0.0',
  title: 'AC Care',
  description: 'Air-conditioner register, service schedule and readings.',
  category: 'Operations',
  icon: 'mdi-air-conditioner',
  color: 'blue',
  availability: 'available',
  access: 'module-grants',
  permissions: ['ac-care:read', 'ac-care:write', 'ac-care:manage'],
  publishes: [],
  subscribes: [],
});
