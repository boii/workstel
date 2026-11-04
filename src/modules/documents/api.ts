import type { DocumentInput, DocumentLink, DocumentQuery, Page } from './types';

/** Documents & SOPs service contract. The server derives the actor from the session and
 * checks documents:read, documents:write and documents:manage per hotel department. */
export interface DocumentsApi {
  list(query: DocumentQuery, signal?: AbortSignal): Promise<Page<DocumentLink>>;
  save(
    hotelId: string,
    input: DocumentInput,
    existing?: Pick<DocumentLink, 'id' | 'version'>,
  ): Promise<void>;
  setArchived(hotelId: string, document: DocumentLink, archived: boolean): Promise<void>;
}
