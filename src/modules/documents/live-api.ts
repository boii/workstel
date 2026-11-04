import { ModuleRequestError, moduleRpc, parseCursor, uuidPattern } from '../../core/module-rpc';
import type { DocumentsApi } from './api';
import { categories } from './types';
import type { DocumentLink } from './types';
import { isSafeLink } from './validation';

type Rpc = typeof moduleRpc;
const invalid = () => new ModuleRequestError('INVALID_RESPONSE');
const isText = (value: unknown): value is string => typeof value === 'string';

export function parseDocuments(data: unknown, hotelId: string): DocumentLink[] {
  if (!Array.isArray(data) || data.length > 100) throw invalid();
  return data.map((raw: Record<string, unknown>) => {
    if (
      !raw ||
      !['id', 'hotel_id', 'department_id', 'department_name', 'title', 'url', 'description'].every(
        (key) => isText(raw[key]),
      ) ||
      raw.hotel_id !== hotelId ||
      !uuidPattern.test(String(raw.id)) ||
      !categories.includes(raw.category as never) ||
      !['active', 'archived'].includes(String(raw.status)) ||
      !Number.isInteger(raw.version) ||
      !isText(raw.updated_at) ||
      Number.isNaN(Date.parse(raw.updated_at)) ||
      // Links are opened in the browser, so an unexpected scheme is rejected here too.
      !isSafeLink(String(raw.url))
    )
      throw invalid();
    return {
      id: String(raw.id),
      hotelId,
      departmentId: String(raw.department_id),
      departmentName: String(raw.department_name),
      title: String(raw.title),
      category: raw.category as DocumentLink['category'],
      url: String(raw.url),
      description: String(raw.description),
      status: raw.status as DocumentLink['status'],
      version: Number(raw.version),
      updatedAt: String(raw.updated_at),
    };
  });
}

export function createLiveDocumentsApi(rpc: Rpc = moduleRpc): DocumentsApi {
  return {
    async list(query, signal) {
      const result = await rpc(
        'documents_list',
        {
          p_hotel_id: query.hotelId,
          p_department_id: query.departmentId,
          p_status: query.status,
          p_category: query.category,
          p_search: query.search.trim().slice(0, 150),
          p_after: query.after,
          p_limit: 50,
        },
        signal,
      );
      return {
        data: parseDocuments(result.data, query.hotelId),
        nextCursor: parseCursor(result.meta),
      };
    },
    async save(hotelId, input, existing) {
      await rpc('documents_save', {
        p_hotel_id: hotelId,
        p_department_id: input.departmentId,
        p_input: {
          title: input.title.trim(),
          category: input.category,
          url: input.url.trim(),
          description: input.description.trim(),
        },
        p_document_id: existing?.id ?? null,
        p_expected_version: existing?.version ?? null,
        p_action: 'save',
      });
    },
    async setArchived(hotelId, document, archived) {
      await rpc('documents_save', {
        p_hotel_id: hotelId,
        p_department_id: document.departmentId,
        p_input: null,
        p_document_id: document.id,
        p_expected_version: document.version,
        p_action: archived ? 'archive' : 'restore',
      });
    },
  };
}
