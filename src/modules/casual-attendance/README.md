# Casual Attendance

Daily attendance for casual, trainee and daily-worker staff. These people are records, not Workstel staff accounts: a supervisor in their department checks them in and out, and managers keep the list of people and correct times. Since 1.1.0 a worker can also check in and out from their own phone once a manager links their Google account to their record (see [Self check-in](#self-check-in) and [SELF_CHECK_IN.md](SELF_CHECK_IN.md)).

## Capabilities

| Permission                 | Server flag  | Allows                                                                     |
| -------------------------- | ------------ | -------------------------------------------------------------------------- |
| `casual-attendance:read`   | `can_read`   | See the day list, the people and the recap                                 |
| `casual-attendance:write`  | `can_write`  | Check in, check out, mark leave, sick or absent, undo and clear a day      |
| `casual-attendance:manage` | `can_manage` | Add, edit, archive and restore people; correct times; export is read-level |
| `casual-attendance:self`   | active link  | Check the linked person in and out, and read that person's last 14 days    |

Write also covers approving and rejecting self check-ins; manage also covers link codes, unlinking and the department's self check-in settings. `self` comes only from an active row in `casual_attendance_links`, never from `module_access`, and gives no hotel membership.

Grants live in `workstel_private.module_access` with `module_id = 'casual-attendance'` and apply only while the matching `staff_access` membership is enabled. The module can be switched off in Settings → Modules like the other module-grant modules.

## Rules

- **Shifts:** morning 07:00–15:00, afternoon 15:00–23:00, night 23:00–07:00 (hotel time, Asia/Jakarta). A person has a usual shift; each day's record keeps the shift that applied.
- **Late:** a check-in more than 5 minutes after the shift start (`lateGraceMinutes` in `validation.ts`, `casual_attendance_is_late` on the server).
- **Check-in** is open for today and yesterday (so a night shift that crosses midnight can still be recorded); check-in and check-out times come from the server clock.
- **Leave, sick and absent** can be marked from 7 days back to 30 days ahead, for a day with no record yet.
- **Undo:** a check-in or mark is undone by clearing the day (`reset`), a check-out by `reopen`. Clearing is refused after check-out.
- **Corrections** (manage only): set check-in and optional check-out as HH:MM for a day up to 62 days back. A check-out earlier than the check-in is on the next day; a shift cannot exceed 16 hours or end in the future. A reason is required, and the previous times are kept in the append-only `casual_attendance_corrections` table.
- **Expected people:** a person appears on a day when they are active and the day falls between their start and end dates, or when they already have a record that day.
- **Department lock:** a person with attendance history cannot move to another department.
- **Recap:** per-person present, late, leave, sick and absent days and worked time from complete check-in/check-out pairs, for at most 62 days. Self check-in days that need review are counted and shown in a Needs review column; rejected days are not present, add no worked time and have their own column. Wages are not calculated. Export downloads a CSV and is audited as `casual-attendance.recap.export`.

## Self check-in

Phase 1 of [SELF_CHECK_IN.md](SELF_CHECK_IN.md). There are no automatic Wi-Fi or location checks yet.

- **Linking:** a manager chooses Create link code in a person's ⋮ menu. The 6-character code (no 0/O, 1/I/L) works once, expires after 24 hours and replaces any unused code; only its SHA-256 hash is stored. The worker signs in with Google and enters it. Wrong codes return `CODE_INVALID` whatever the reason, and 5 wrong codes in 15 minutes give `TOO_MANY_ATTEMPTS`. One account links to one person and one person to one account. Unlink ends the link at once; an archived person's link stops working.
- **Department settings** (Self check-in button, managers): Allow self check-in (off by default) and Supervisor review: `off`, `on_fail` (default) or `always`. Without automatic checks, `off` and `on_fail` give `verified` and `always` gives `needs_review`.
- **My attendance** (`/casual-attendance/me`): today's state, one Check in or Check out button (check-out asks first), and the last 14 days. A night-shift person before 07:00 is on yesterday's shift. Workers cannot undo or correct; supervisors use the existing actions.
- **Review:** the Today list shows "Self" and the review state in the row's detail line, filters on Needs review, and offers Approve and Reject (`casual_attendance_mark` actions `approve` and `reject`). Approve is the row's main action once the day is checked out.
- **Accounts without workspace access:** `useAuth` calls `casual_attendance_self_status()` when `workstel_session` returns no rows. If the module is on, the shell shows only My attendance with language and sign-out; otherwise the usual "No workspace access yet" message stays. An unlinked account sees "Your account has no access yet" with its signed-in email: first what hotel staff should do (give that email to the administrator), then, for casual workers and trainees, an Enter code link that opens the code form (the shared `OptionalFields` fold). Staff who are in the workspace and open `/casual-attendance/me` unlinked see the code form directly.

## Server contract

Migrations `supabase/migrations/202611100001_casual_attendance.sql` (requires the module access and module switch migrations) and `202611100002_casual_attendance_self.sql` (self check-in).

- `casual_attendance_list_people(hotel, department?, type?, period, search, after?, limit≤100)` — period `current`, `ended`, `archived` or `all`; keyset pagination by name.
- `casual_attendance_save_person(hotel, department, input, person?, expectedVersion?, action)` — `save`, `archive` or `restore` with optimistic versioning.
- `casual_attendance_day(hotel, department?, day)` — expected people with their record for the day, morning shift first.
- `casual_attendance_mark(hotel, person, day, action, expectedVersion?, note)` — `check_in`, `check_out`, `leave`, `sick`, `absent`, `reopen`, `reset`, `approve` or `reject` (the last two only for self check-in days; `note` becomes the review note).
- `casual_attendance_correct(hotel, person, day, checkIn, checkOut?, reason, expectedVersion?)`.
- `casual_attendance_recap(hotel, department?, type?, from, to, purpose)` — `purpose` is `view` or `export`; rows include `needs_review` and `rejected`.
- `casual_attendance_person_link(hotel, person, action)` — manage; `code` returns `{code, expires_at}`, `unlink` ends the link.
- `casual_attendance_settings(hotel, department?)` (read) and `casual_attendance_save_settings(hotel, department, input, expectedVersion)` (manage; 0 before the first save).
- `casual_attendance_redeem_link_code(code)` and `casual_attendance_self_status()` — any signed-in account while the module is on.
- `casual_attendance_self_mark(action, location?)` — linked account; `check_in` or `check_out`; `location` must be null until phase 2.

Records carry `source` (`supervisor` or `self`), `verification` (null, `verified`, `needs_review`, `unverified` or `rejected`) and `review_note`. Every self action is kept in the append-only `casual_attendance_self_events` table with the settings version and result that applied.

Every call records `casual-attendance.*` audit events with actor, scope, resource and outcome, including `person.link-code`, `person.link`, `person.unlink`, `attendance.self-check-in`, `attendance.self-check-out`, `attendance.self-read`, `attendance.approve`, `attendance.reject` and `settings.save`. Codes are never written to audit events. Error codes: `ACCESS_DENIED`, `INVALID_INPUT`, `VERSION_CONFLICT`, `ALREADY_MARKED`, `NOT_SCHEDULED`, `DAY_CLOSED`, `NOT_CHECKED_IN`, `RECORD_CLOSED`, `DEPARTMENT_LOCKED`, `RANGE_TOO_LONG`, `NOT_LINKED`, `ALREADY_LINKED`, `CODE_INVALID`, `TOO_MANY_ATTEMPTS`, `SELF_DISABLED`, `NOT_REVIEWABLE`.

## Frontend

`pages/ModuleListPage.vue` has three tabs — Today, People and Recap — plus the Self check-in settings dialog (`components/SelfSettingsForm.vue`). `pages/MyAttendancePage.vue` is the worker's page and the link form. Both use `live-api.ts` in production and one shared `demo-api.ts` instance (in memory, with sample people and nine days of history) in demo mode, where the demo user is linked to Rina Kartika. Response parsers accept records without the self check-in fields, so the page keeps working on a server that has not applied `202611100002` yet. The dashboard card opens only when `workstel_module_access` reports the module installed and grants read access.

## Not implemented

No Wi-Fi or location checks yet (phases 2 and 3 of `SELF_CHECK_IN.md`), no QR code, kiosk or photos, no worker-requested leave, no wage calculation, no shift schedule beyond the usual shift per person, and no link to Room Turnaround (that would need an approved cross-module contract). Corrections are kept on the server but there is no screen to browse them yet; they are visible to operators in the database and through the audit events.
