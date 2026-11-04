import { ModuleRequestError } from '../../core/module-rpc';
import type { DocumentsApi } from './api';
import type { DocumentLink } from './types';
import { isSafeLink } from './validation';

export const demoHotelId = 'demo-hotel';
export const demoDepartments = [
  { id: 'front-office', name: 'Front Office' },
  { id: 'engineering', name: 'Engineering' },
];

/** In-memory demo library that mirrors the server rules; it resets on reload. */
export function createDemoDocumentsApi(): DocumentsApi {
  const now = new Date().toISOString();
  const documents: DocumentLink[] = [
    ['Guest check-in SOP', 'sop', 'front-office', 'Arrival, ID check and key handover.'],
    ['Lost and found policy', 'policy', 'front-office', 'Logging, storage and guest return.'],
    ['Daily room inspection form', 'form', 'front-office', ''],
    ['Pool maintenance guide', 'guide', 'engineering', 'Chemical levels and weekly cleaning.'],
  ].map(([title, category, departmentId, description], index) => ({
    id: 'demo-document-' + (index + 1),
    hotelId: demoHotelId,
    departmentId,
    departmentName: demoDepartments.find((d) => d.id === departmentId)!.name,
    title,
    category: category as DocumentLink['category'],
    url: 'https://docs.example.com/workstel-demo/' + (index + 1),
    description,
    status: 'active',
    version: 1,
    updatedAt: now,
  }));
  const find = (id: string) => {
    const document = documents.find((entry) => entry.id === id);
    if (!document) throw new ModuleRequestError('ACCESS_DENIED');
    return document;
  };
  return {
    async list(query) {
      const search = query.search.trim().toLowerCase();
      const data = documents
        .filter(
          (d) =>
            (!query.departmentId || d.departmentId === query.departmentId) &&
            (query.status === 'all' || d.status === query.status) &&
            (!query.category || d.category === query.category) &&
            (!search || (d.title + ' ' + d.description).toLowerCase().includes(search)),
        )
        .sort((a, b) => a.title.localeCompare(b.title))
        .map((d) => ({ ...d }));
      return { data, nextCursor: null };
    },
    async save(_hotelId, input, existing) {
      if (!isSafeLink(input.url)) throw new ModuleRequestError('INVALID_URL');
      const fields = {
        title: input.title.trim(),
        category: input.category,
        url: input.url.trim(),
        description: input.description.trim(),
        departmentId: input.departmentId,
        departmentName: demoDepartments.find((d) => d.id === input.departmentId)?.name ?? '',
        updatedAt: new Date().toISOString(),
      };
      if (!existing) {
        documents.push({
          ...fields,
          id: crypto.randomUUID(),
          hotelId: demoHotelId,
          status: 'active',
          version: 1,
        });
        return;
      }
      const document = find(existing.id);
      if (document.version !== existing.version) throw new ModuleRequestError('VERSION_CONFLICT');
      Object.assign(document, fields, { version: document.version + 1 });
    },
    async setArchived(_hotelId, target, archived) {
      const document = find(target.id);
      if (document.version !== target.version) throw new ModuleRequestError('VERSION_CONFLICT');
      Object.assign(document, {
        status: archived ? 'archived' : 'active',
        version: document.version + 1,
      });
    },
  };
}
