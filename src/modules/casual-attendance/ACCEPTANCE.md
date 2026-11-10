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

## Self check-in, phase 1 — implemented and verified locally (10 November 2026)

- [x] Manifest 1.1.0 adds `casual-attendance:self`, granted only by an active link.
- [x] Only a manager of the person's department creates a link code; a new code replaces the unused one; only the hash is stored (`supabase/tests/casual-attendance-self.test.ts`).
- [x] Wrong, expired and reused codes give `CODE_INVALID`; 5 wrong codes in 15 minutes block even the right code; one account per person and one person per account.
- [x] A linked account gets no day list, people or recap access.
- [x] Self check-in is off until a manager switches it on per department; settings saves use version checks.
- [x] Self check-in and check-out use the server clock; `always` review gives `needs_review`; every self action is stored in an append-only events table.
- [x] Supervisors approve and reject; rejected days leave the recap's present count and worked time.
- [x] Undoing a check-out clears the review state, so a reopened day shows no Verified badge and cannot be approved until it is checked out again; the next self check-out reviews it again from the check-in's result (migration `202611100003`, added 10 November 2026 after the user saw Verified on a reopened day).
- [x] Unlinking and switching the module off end self check-in at once.
- [x] Parsers accept records from servers without the new fields and reject unknown sources, review states, codes and settings (`casual-attendance.test.ts`).
- [x] Demo mode links the demo user to Rina and mirrors the same rules.
- [x] `npm run check` passes; `/casual-attendance/me` is covered by `src/routes.test.ts`.

## Required before self check-in is used

- [x] Product owner's approval that department managers may give an account self check-in through a link code, recorded in `docs/SESSION_AUTH.md` (approved 10 November 2026).
- [ ] Google sign-in enabled and verified on the hotel server (`docs/SESSION_AUTH.md`).
- [x] Operator applies `supabase/migrations/202611100002_casual_attendance_self.sql` after a backup, after `202611100001` (reported applied by the operator on 10 November 2026; not seen by Claude, see `docs/DEPLOYMENT.md`).
- [ ] Operator applies `supabase/migrations/202611100003_casual_attendance_reopen_review.sql` after a backup, after `202611100002`. Until then the server keeps the Verified badge on a reopened day.
- [ ] Signed-in check on the live server: a new Google account sees Link to attendance, links with a manager's code, checks in and out; the supervisor approves and rejects; unlinking signs the worker's page back to the link form.
- [ ] 390px phone review of My attendance and the link form by the user, on a real phone.

## Required before staff use

- [ ] Operator applies `supabase/migrations/202611100001_casual_attendance.sql` on the hotel server, after a backup.
- [ ] Operator grants access with `infra/grant-module-access.sql` (`-v module=casual-attendance`).
- [ ] Signed-in check on the live server: add a person, check in and out, mark leave, correct a time, read the recap and export it, and confirm a user without grants sees the card as unavailable.
- [ ] Desktop and 390px phone review by the user in production.

## Not implemented

- Wi-Fi and location checks for self check-in (phases 2 and 3), QR or kiosk, photos, worker-requested leave, wage calculation and shift rosters.
- A screen listing past corrections.
- Any link to Room Turnaround or other modules.
