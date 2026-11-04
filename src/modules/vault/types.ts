import type { BaseRecord } from '../../core/module';
export const departmentIds = [
  'front-office',
  'sales',
  'engineering',
  'it',
  'accounting',
  'human-resource',
  'admin-general',
  'housekeeping',
] as const;
export type DepartmentId = (typeof departmentIds)[number];
export type VaultStatus = 'active' | 'archived';
export interface VaultEntry extends BaseRecord {
  ownerId?: string;
  isOwner?: boolean;
  canEdit?: boolean;
  canArchive?: boolean;
  name: string;
  username: string;
  website: string;
  notes: string;
  departmentId: DepartmentId;
  status: VaultStatus;
  secretStatus: 'not-connected';
  version: number;
}
export interface VaultEntryInput {
  name: string;
  username: string;
  website: string;
  notes: string;
  departmentId: DepartmentId;
}
export type VaultAction = 'created' | 'updated' | 'archived' | 'restored';
export interface VaultActivity {
  id: string;
  entryId: string;
  action: VaultAction;
  occurredAt: string;
  actorId: string;
}
export type VaultField = keyof VaultEntryInput;
export type VaultValidationError = 'required' | 'tooLong' | 'invalidUrl';
