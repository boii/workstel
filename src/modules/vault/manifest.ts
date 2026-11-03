import { defineModule } from '../../core/module';
export default defineModule({
  id: 'vault',
  version: '0.1.0',
  title: 'Password Vault',
  description: 'Store hotel work accounts by department.',
  category: 'Administration',
  icon: 'mdi-key-outline',
  color: 'yellow',
  availability: 'preview',
  permissions: ['vault:read', 'vault:write', 'vault:archive', 'vault:reveal'],
  publishes: ['vault.account-created.v1', 'vault.account-updated.v1', 'vault.account-archived.v1'],
  subscribes: [],
});
