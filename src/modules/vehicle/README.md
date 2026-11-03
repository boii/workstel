# Vehicle Checklist

Hotel staff record a condition check for each hotel vehicle before use. Each department keeps its own vehicles; inspections are append-only.

## Capabilities

| Permission       | Server flag  | Allows                                    |
| ---------------- | ------------ | ----------------------------------------- |
| `vehicle:read`   | `can_read`   | List vehicles and read inspection history |
| `vehicle:write`  | `can_write`  | Record inspections for active vehicles    |
| `vehicle:manage` | `can_manage` | Add, edit, archive and restore vehicles   |

Grants live in `workstel_private.module_access` with `module_id = 'vehicle'` and apply only while the matching `staff_access` membership is enabled. Vault and department flags in `staff_access` do not grant Vehicle access.

## Server contract

Migration `supabase/migrations/202611040002_vehicle_checklist.sql` (requires `202611040001_module_access.sql`).

- `vehicle_list_units(hotel, department?, status, search, after?, limit≤100)`: keyset pagination by name.
- `vehicle_save_unit(hotel, department, input, unit?, expectedVersion?, action)`: `save`, `archive` or `restore` with optimistic versioning. Plates are stored upper-case with single spaces and are unique per hotel.
- `vehicle_record_inspection(hotel, vehicle, input, idempotencyKey)`: requires all ten checklist items (`ok`/`issue`), a fuel level and, when any issue is marked, notes. A retried key returns the original record.
- `vehicle_list_inspections(hotel, vehicle, before?, limit≤50)`: newest first.

Every call records `vehicle.*` audit events with actor, scope, resource and outcome. Error codes: `ACCESS_DENIED`, `INVALID_INPUT`, `VERSION_CONFLICT`, `DUPLICATE_PLATE`, `VEHICLE_ARCHIVED`, `NOTES_REQUIRED`.

## Frontend

`pages/ModuleListPage.vue` uses `live-api.ts` in production and `demo-api.ts` (in memory) in demo mode. The dashboard card opens only when `workstel_module_access` reports the module installed and grants read access.

## Not implemented

The manifest declares `vehicle.inspected.v1`, but no event outbox or delivery exists yet. There is no module audit reader UI; audit records are stored server-side only.
