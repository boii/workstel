import type { BaseRecord } from '../../core/module';
export interface ModuleRecord extends BaseRecord {
  name: string;
  status: 'active' | 'archived';
  version: number;
}
export interface CreateRecordInput {
  name: string;
}
export interface PageResult<T> {
  data: T[];
  meta: { nextCursor: string | null };
}
