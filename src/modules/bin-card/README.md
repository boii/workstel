# Bin Card

Department stock cards: each item keeps a running balance, and every receipt, issue or stock count is an append-only ledger entry.

## Capabilities

| Permission        | Server flag  | Allows                                   |
| ----------------- | ------------ | ---------------------------------------- |
| `bin-card:read`   | `can_read`   | List items and read their stock card     |
| `bin-card:write`  | `can_write`  | Record receipts, issues and stock counts |
| `bin-card:manage` | `can_manage` | Add, edit, archive and restore items     |

Grants live in `workstel_private.module_access` with `module_id = 'bin-card'` and apply only while the matching `staff_access` membership is enabled. Vault and department flags in `staff_access` do not grant Bin Card access.

## Server contract

Migration `supabase/migrations/202611040003_bin_card.sql` (requires `202611040001_module_access.sql`).

- `bin_card_list_items(hotel, department?, status, search, lowOnly, after?, limit≤100)`: keyset pagination by name; `lowOnly` returns items at or below their minimum.
- `bin_card_save_item(hotel, department, input, item?, expectedVersion?, action)`: `save`, `archive` or `restore` with optimistic versioning. Codes are stored upper-case and are unique per department. The unit and department are locked once stock has moved; archiving requires a zero balance.
- `bin_card_record_entry(hotel, item, input, idempotencyKey)`: `receipt` and `issue` take a positive quantity; `adjustment` takes the counted balance and records the difference. The item row is locked, the balance can never go negative, and a retried key returns the original entry.
- `bin_card_list_entries(hotel, item, before?, limit≤50)`: newest first.

Quantities are `numeric(14,3)`: up to 11 integer digits and 3 decimals, in the item's unit. Every call records `bin-card.*` audit events with actor, scope, resource and outcome. Error codes: `ACCESS_DENIED`, `INVALID_INPUT`, `VERSION_CONFLICT`, `DUPLICATE_CODE`, `UNIT_LOCKED`, `DEPARTMENT_LOCKED`, `BALANCE_NOT_ZERO`, `ITEM_ARCHIVED`, `INSUFFICIENT_STOCK`, `NO_CHANGE`.

## Frontend

`pages/ModuleListPage.vue` uses `live-api.ts` in production and `demo-api.ts` (in memory) in demo mode. The dashboard card opens only when `workstel_module_access` reports the module installed and grants read access.

## Not implemented

The manifest declares `bin-card.stock-low.v1`, but no event outbox or delivery exists yet; low stock is shown in the list only. There is no costing, purchase ordering, transfer between departments or module audit reader UI.
