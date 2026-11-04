export const categories = ['sop', 'policy', 'form', 'guide', 'other'] as const;
export type Category = (typeof categories)[number];
export type DocumentStatus = 'active' | 'archived';

/** A link to a document kept elsewhere (for example Google Drive or SharePoint). */
export interface DocumentLink {
  id: string;
  hotelId: string;
  departmentId: string;
  departmentName: string;
  title: string;
  category: Category;
  url: string;
  description: string;
  status: DocumentStatus;
  version: number;
  updatedAt: string;
}
export interface DocumentInput {
  title: string;
  category: Category;
  url: string;
  description: string;
  departmentId: string;
}
export interface Page<T> {
  data: T[];
  nextCursor: string | null;
}
export interface DocumentQuery {
  hotelId: string;
  departmentId: string | null;
  status: DocumentStatus | 'all';
  category: Category | null;
  search: string;
  after: string | null;
}
