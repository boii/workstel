# Vehicle Checklist acceptance

## Implemented and verified locally (4 November 2026)

- [x] Module-specific capabilities (`vehicle:read`, `vehicle:write`, `vehicle:manage`) enforced in PostgreSQL per hotel department; Vault/department flags grant nothing (`supabase/tests/operations-modules.test.ts`).
- [x] Disabled staff membership removes module access.
- [x] Other departments cannot list, read history of or inspect a vehicle.
- [x] Plates are canonical (upper case, single spaces) and unique per hotel; duplicates return `DUPLICATE_PLATE`.
- [x] Optimistic versioning on vehicle edits (`VERSION_CONFLICT`).
- [x] Inspections require all ten checklist items and a fuel level; marked issues require notes (`NOTES_REQUIRED`); archived vehicles cannot be inspected.
- [x] Inspection submit is idempotent per form; records are append-only (update/delete rejected).
- [x] Every list, write and denial is audited under `vehicle.*`; capability grants under `staff.module-access.*`.
- [x] Response parsers reject malformed rows, foreign hotel rows and bad cursors (`vehicle.test.ts`).
- [x] Demo mode uses in-memory sample data with the same rules.
- [x] Dashboard card opens only when the server reports the module installed and grants read access; direct URLs without access show Temporarily unavailable.
- [x] Desktop and 390px mobile checked in demo mode, English and Indonesian.

## Required before staff use

- [ ] Operator applies migrations with `infra/apply-operations-modules.sh` on the hotel server.
- [ ] Operator grants access with `infra/grant-module-access.sql`.
- [ ] Signed-in check on the live server: add a vehicle, record pass and attention inspections, view history, archive/restore, and confirm a user without grants sees the card as unavailable.

## Not implemented

- `vehicle.inspected.v1` event delivery (no outbox yet).
- Module audit reader UI.
