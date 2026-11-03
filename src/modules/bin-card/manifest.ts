import { defineModule } from '../../core/module';
export default defineModule({
  id: 'bin-card',
  version: '1.0.0',
  title: 'Bin Card',
  description: 'Track stock receipts, issues, and balances.',
  category: 'Operations',
  icon: 'mdi-package-variant-closed',
  color: 'mint',
  availability: 'available',
  access: 'module-grants',
  permissions: ['bin-card:read', 'bin-card:write', 'bin-card:manage'],
  publishes: ['bin-card.stock-low.v1'],
  subscribes: [],
});
