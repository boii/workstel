# Housekeeping acceptance

## Implemented and verified locally (4 November 2026)

- [x] The Housekeeping department is added to every hotel.
- [x] Module-specific capabilities (read, write, manage) per hotel department enforced in PostgreSQL; other departments see nothing (`supabase/tests/housekeeping.test.ts`).
- [x] Task times come from the server clock; durations exclude pauses; one open task per room and per attendant.
- [x] Task types follow the room status; finishing a departure or deep clean makes a vacant room clean.
- [x] DND and refused are recorded for make-up room and turndown; out of order and redo need a reason.
- [x] Inspections need manage, are append-only, and move rooms to ready or back to dirty.
- [x] Room master: add, edit, import (up to 500, duplicates skipped), archive and restore with version checks.
- [x] The module switch blocks every Housekeeping RPC when off; tables are not readable by clients.
- [x] Lists, writes and denials are audited under `housekeeping.*`.
- [x] Response parsers reject malformed rows (`housekeeping.test.ts`).
- [x] Demo mode uses in-memory sample rooms with the same rules.

## Required before staff use

- [ ] Operator applies `202611040011_housekeeping.sql` with `infra/apply-operations-modules.sh`.
- [ ] A developer adds Housekeeping memberships and grants levels on the Users page (supervisors: manage; room attendants: write; Front Office: read or write).
- [ ] A supervisor imports the room list.
- [ ] Signed-in check on the live server from a phone: start, pause, resume and finish a cleaning, record DND, inspect and pass a room.
