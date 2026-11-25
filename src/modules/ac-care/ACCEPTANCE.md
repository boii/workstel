# AC Care acceptance

## Implemented and verified locally (25 November 2026)

- [x] Module-specific capabilities (`ac-care:read`, `ac-care:write`, `ac-care:manage`) enforced in PostgreSQL per hotel department (`supabase/tests/ac-care.test.ts`).
- [x] Other departments cannot list, read history of, claim or service a unit.
- [x] Unit codes are upper case and unique per department (`DUPLICATE_CODE`); optimistic versioning on edits (`VERSION_CONFLICT`); invalid types, intervals, dates and unknown fields are rejected.
- [x] Import adds up to 500 units and skips existing codes.
- [x] Schedules start on the registration day; recording a larger service resets the smaller ones and clears their claims.
- [x] Only one technician can hold a task; expired claims are free; supervisors can assign only to technicians of the department (`ASSIGNEE_INVALID`).
- [x] Postponing requires a reason; another technician cannot release someone else's postponement.
- [x] Services require the checklist items and readings of their kind (`READINGS_REQUIRED`); the server decides the result and requires notes for attention (`NOTES_REQUIRED`); submit is idempotent per form.
- [x] Service and complaint records are append-only.
- [x] Archived units take no claims, services or complaints (`UNIT_ARCHIVED`).
- [x] Area membership requires a technician and keeps the existing spelling of the area.
- [x] Every list, write and denial is audited under `ac-care.*`.
- [x] Response parsers reject malformed rows, foreign hotel rows and bad cursors (`ac-care.test.ts`).
- [x] Demo mode uses in-memory sample data with the same rules.
- [x] Desktop and 390px mobile checked in demo mode, English and Indonesian: tasks, take task, record service with an attention reading, units list, areas dialog; no horizontal page overflow.

## Required before staff use

- [x] Operator applies `202611250001_ac_care.sql` on the hotel server after a backup (reported applied by the operator on 25 November 2026; not seen by Claude, see `docs/DEPLOYMENT.md`).
- [ ] Operator grants access with `infra/grant-module-access.sql` (technicians: write; supervisors and Chief Engineer: manage).
- [ ] Chief Engineer confirms the reading thresholds and default intervals.
- [ ] Signed-in check on the live server: import units, give areas, take and record a task as two technicians, assign as a supervisor, and confirm a user without grants sees the card as unavailable.

## Not implemented

- Integration with Room Turnaround, the PMS or Bin Card.
- Workload view, shift handover and Chief Engineer reports (v2).
- Module audit reader UI.
