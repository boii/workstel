# Casual Attendance

Daily attendance for casual, trainee and daily-worker staff. These people are records, not Workstel accounts: a supervisor in their department checks them in and out, and managers keep the list of people and correct times.

## Capabilities

| Permission                 | Server flag  | Allows                                                                     |
| -------------------------- | ------------ | -------------------------------------------------------------------------- |
| `casual-attendance:read`   | `can_read`   | See the day list, the people and the recap                                 |
| `casual-attendance:write`  | `can_write`  | Check in, check out, mark leave, sick or absent, undo and clear a day      |
| `casual-attendance:manage` | `can_manage` | Add, edit, archive and restore people; correct times; export is read-level |

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
- **Recap:** per-person present, late, leave, sick and absent days and worked time from complete check-in/check-out pairs, for at most 62 days. Wages are not calculated. Export downloads a CSV and is audited as `casual-attendance.recap.export`.

## Server contract

Migration `supabase/migrations/202611100001_casual_attendance.sql` (requires the module access and module switch migrations).

- `casual_attendance_list_people(hotel, department?, type?, period, search, after?, limit≤100)` — period `current`, `ended`, `archived` or `all`; keyset pagination by name.
- `casual_attendance_save_person(hotel, department, input, person?, expectedVersion?, action)` — `save`, `archive` or `restore` with optimistic versioning.
- `casual_attendance_day(hotel, department?, day)` — expected people with their record for the day, morning shift first.
- `casual_attendance_mark(hotel, person, day, action, expectedVersion?, note)` — `check_in`, `check_out`, `leave`, `sick`, `absent`, `reopen` or `reset`.
- `casual_attendance_correct(hotel, person, day, checkIn, checkOut?, reason, expectedVersion?)`.
- `casual_attendance_recap(hotel, department?, type?, from, to, purpose)` — `purpose` is `view` or `export`.

Every call records `casual-attendance.*` audit events with actor, scope, resource and outcome. Error codes: `ACCESS_DENIED`, `INVALID_INPUT`, `VERSION_CONFLICT`, `ALREADY_MARKED`, `NOT_SCHEDULED`, `DAY_CLOSED`, `NOT_CHECKED_IN`, `RECORD_CLOSED`, `DEPARTMENT_LOCKED`, `RANGE_TOO_LONG`.

## Frontend

`pages/ModuleListPage.vue` has three tabs — Today, People and Recap — and uses `live-api.ts` in production and `demo-api.ts` (in memory, with sample people and nine days of history) in demo mode. The dashboard card opens only when `workstel_module_access` reports the module installed and grants read access.

## Not implemented

No self check-in (QR code or kiosk), no photos or location, no wage calculation, no shift schedule beyond the usual shift per person, and no link to Room Turnaround (that would need an approved cross-module contract). Corrections are kept on the server but there is no screen to browse them yet; they are visible to operators in the database and through the audit events.
