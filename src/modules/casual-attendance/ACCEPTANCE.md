# Casual Attendance acceptance

## Implemented and verified locally (10 November 2026)

- [x] Manifest `casual-attendance` 1.0.0 with `read`, `write` and `manage` permissions, module grants and no events.
- [x] English source copy and Indonesian translations have matching keys (`npm run modules:check`).
- [x] Module-specific capabilities enforced in PostgreSQL per hotel department: readers cannot mark, supervisors cannot add people or correct, other departments see nothing (`supabase/tests/casual-attendance.test.ts`).
- [x] Check-in and check-out use the server clock; version checks stop double check-ins; clearing is refused after check-out.
- [x] Check-in is limited to today and yesterday, away marks to 7 days back and 30 days ahead, and marks need the person to be scheduled that day.
- [x] Corrections require manage, a reason and valid HH:MM times; previous times are stored in an append-only table.
- [x] Recap counts present, late (more than 5 minutes), leave, sick and absent days and worked minutes; ranges over 62 days are refused.
- [x] People with attendance history cannot change department; archive uses version checks and Undo.
- [x] Switching the module off denies every call.
- [x] List, write, correction, export and denials are audited under `casual-attendance.*`.
- [x] Response parsers reject other hotels, unknown types, negative counts and records with a check-out but no check-in (`casual-attendance.test.ts`).
- [x] Demo mode uses in-memory sample people with the same rules.
- [x] User-entered names, origins and notes are shown as entered.

## Required before staff use

- [ ] Operator applies `supabase/migrations/202611100001_casual_attendance.sql` on the hotel server, after a backup.
- [ ] Operator grants access with `infra/grant-module-access.sql` (`-v module=casual-attendance`).
- [ ] Signed-in check on the live server: add a person, check in and out, mark leave, correct a time, read the recap and export it, and confirm a user without grants sees the card as unavailable.
- [ ] Desktop and 390px phone review by the user in production.

## Not implemented

- Self check-in (QR or kiosk), photos, location, wage calculation and shift rosters.
- A screen listing past corrections.
- Any link to Room Turnaround or other modules.
