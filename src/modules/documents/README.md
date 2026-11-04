# Documents & SOPs

A per-department library of links to hotel documents and SOPs that live elsewhere (for example Google Drive, OneDrive or SharePoint). Workstel stores the title, category, link and a short description; it does not store files.

## Capabilities

| Permission         | Server flag  | Allows                             |
| ------------------ | ------------ | ---------------------------------- |
| `documents:read`   | `can_read`   | List and open documents            |
| `documents:write`  | `can_write`  | Add and edit document links        |
| `documents:manage` | `can_manage` | Archive and restore document links |

Grants live in `workstel_private.module_access` with `module_id = 'documents'` and apply only while the matching `staff_access` membership is enabled and the module switch is on. Developers grant levels on the Users page.

## Server contract

Migration `supabase/migrations/202611040009_documents.sql` (requires `202611040001_module_access.sql` and `202611040006_module_switch.sql`).

- `documents_list(hotel, department?, status, category?, search, after?, limit≤100)`: keyset pagination by title.
- `documents_save(hotel, department, input, document?, expectedVersion?, action)`: `save` (write), `archive` or `restore` (manage) with optimistic versioning.
- Links must be `https://` without embedded credentials (`INVALID_URL` otherwise). Categories: `sop`, `policy`, `form`, `guide`, `other`.

Every list, write and denial is audited as `documents.*`. Error codes: `ACCESS_DENIED`, `INVALID_INPUT`, `INVALID_URL`, `VERSION_CONFLICT`.

## Frontend

`pages/ModuleListPage.vue` uses `live-api.ts` in production and `demo-api.ts` (in memory) in demo mode. Links open in a new tab with `noopener noreferrer`, and responses are rejected if a link is not a safe https address.

## Not implemented

File upload, versions, read confirmation, drafts and review dates are intentionally out of scope for this version. The manifest declares `documents.published.v1`, but no event delivery exists.
