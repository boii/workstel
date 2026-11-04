import { defineModule } from '../../core/module';
export default defineModule({
  id: 'documents',
  version: '1.0.0',
  title: 'Documents & SOPs',
  description: 'Hotel documents and operating procedures.',
  category: 'Administration',
  icon: 'mdi-file-document-multiple-outline',
  color: 'mint',
  availability: 'available',
  access: 'module-grants',
  permissions: ['documents:read', 'documents:write', 'documents:manage'],
  publishes: ['documents.published.v1'],
  subscribes: [],
});
