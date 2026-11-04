# Housekeeping acceptance

## Implemented and verified locally (4 November 2026)

- [x] Module-specific capabilities (read, write, manage) per hotel department enforced in PostgreSQL; other departments see nothing (`supabase/tests/housekeeping.test.ts`).
- [x] Timer times come from the server clock; durations exclude pauses; one running timer per room and per attendant.
- [x] Supervisors can finish or cancel anyone's timer; cancelled timers are not counted.
- [x] History per day and per room; daily summary with rooms cleaned and average and longest time per kind of cleaning and per attendant.
- [x] Room list: add, edit, import (up to 500, duplicates skipped), archive and restore with version checks.
- [x] Migration `202611040012` refuses to run if data it would remove exists.
- [x] The module switch blocks every Housekeeping RPC when off; tables are not readable by clients.
- [x] Response parsers reject malformed rows (`housekeeping.test.ts`); demo mode mirrors the rules in memory.

## Required before staff use

- [ ] Operator applies `202611040012_housekeeping_timer.sql` with `infra/apply-operations-modules.sh`.
- [ ] A supervisor imports the room list.
- [ ] A developer adds Housekeeping memberships and levels on the Users page (attendants: write; supervisors: manage).
- [ ] Signed-in check from a phone: start, pause, resume and finish a cleaning, then read it in History.
