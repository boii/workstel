# Casual Attendance — self check-in specification

Status: **phase 1 implemented and verified locally on 10 November 2026; frontend published and migration reported applied on the hotel server the same day, not yet tried in production.** Phase 1 is migration `202611100002_casual_attendance_self.sql`, `pages/MyAttendancePage.vue`, `components/SelfSettingsForm.vue` and the attendance-only state in `src/auth/useAuth.ts` and `src/App.vue`; see `ACCEPTANCE.md` for what remains before use. Phases 2 and 3 (location and Wi-Fi) are not implemented. Agreed in discussion with the product owner on 10 November 2026 and aligned with the existing module and app patterns the same day (see [Alignment with the existing module](#alignment-with-the-existing-module)).

## Goal

Casual, trainee and daily workers check in and out themselves with one button on their own phone. Each department decides what makes a self check-in valid. Supervisors keep the existing Today list and only handle the cases that need them.

## Decisions

| Topic                | Decision                                                                                                               |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Device               | The worker's own phone, in the browser.                                                                                |
| Identity             | The worker signs in with Google and is linked to their person record with a one-time code from a manager.              |
| Validity rules       | Set per department: Hotel Wi-Fi on/off, Location on/off, Supervisor confirmation Off / Only when checks fail / Always. |
| Rule combination     | When Wi-Fi and Location are both on, passing either one is enough.                                                     |
| All rules off        | Pressing the button is valid. The attempt is still recorded with whatever network and location facts were available.   |
| Failed checks        | Never reject the time. The attendance is recorded and marked for review or as unverified.                              |
| Worker leave or sick | Not in this version. Supervisors keep marking leave, sick and absent.                                                  |
| Out of scope         | QR codes, selfies, wage calculation, shift rosters and worker-requested leave.                                         |

## Policy change (approved 10 November 2026)

Before this feature, a Google sign-up had no access until a platform developer granted it in Users ([docs/SESSION_AUTH.md](../../../docs/SESSION_AUTH.md)). This feature lets a **department manager** give a Google account one narrow capability: recording its own attendance for one person record. It grants no hotel membership, no `staff_access`, no module read/write/manage and no other module. The product owner approved this on 10 November 2026, and the decision is recorded in `docs/SESSION_AUTH.md`.

## Prerequisites

1. Google sign-in is enabled on the hotel server and verified with the checklist in `docs/SESSION_AUTH.md`.
2. Migration `202611100001_casual_attendance.sql` is applied.
3. For the Wi-Fi rule only: the server can read the caller's public IP reliably (see Open questions). The Wi-Fi option stays hidden until this is verified.

## Account linking

### Flow

1. A manager (`casual-attendance:manage` for the person's department) opens the person's ⋮ menu in **People** and chooses **Create link code**.
2. The server returns a 6-character code from an unambiguous alphabet (no 0/O, 1/I/L) that expires after 24 hours. It is shown once in a dialog with a copy button. Creating a new code replaces any unused one for that person.
3. The worker signs in with Google and sees **Link to attendance** (see [Signed-in worker without workspace access](#signed-in-worker-without-workspace-access)).
4. The worker enters the code. The server links `auth.uid()` to the person and the worker lands on **My attendance**.

### Rules

- The server stores only a hash of the code, the person, the creator and the expiry. Codes are single use.
- One account links to at most one person, and one person to at most one account.
- Wrong or expired codes return the same `CODE_INVALID` error, so the response does not reveal which codes exist. After 5 failed attempts in 15 minutes the account gets `TOO_MANY_ATTEMPTS` until the window passes.
- A manager can **Unlink** at any time, for example when the worker changes phone or Google account. Archiving the person or passing their end date makes the link inactive without deleting it.
- The People list shows Linked / Not linked. It does not show the worker's email or Google name; that would need an approved profile contract under `docs/MODULE_STANDARD.md`.
- Linking does not translate or change the person's name. Records keep showing the name the manager entered.

## Department settings

Stored per hotel department. Only `casual-attendance:manage` for that department can change them. Every change is versioned and audited.

| Setting                 | Values                       | Default    |
| ----------------------- | ---------------------------- | ---------- |
| Self check-in           | on / off                     | off        |
| Hotel Wi-Fi             | on / off                     | off        |
| Location                | on / off, radius 50–1000 m   | off, 200 m |
| Supervisor confirmation | `off` / `on_fail` / `always` | `on_fail`  |

Hotel-level values, shared by every department of a hotel:

- **Hotel networks:** a list of public IP addresses or CIDR ranges with a label.
- **Hotel location:** one latitude/longitude point.

An operator sets these with an SQL script, `infra/casual-attendance-hotel-settings.sql`, in the same way module grants are given with `infra/grant-module-access.sql`. There is no screen for them, because a wrong value affects every department and they rarely change. (Open question: allow managers instead.)

If Location is turned on before a hotel location exists, or Wi-Fi before a network exists, the save is refused with `INVALID_INPUT` and an explaining message.

## Validity

Each self check-in and self check-out is evaluated on the server against the department's settings at that moment:

1. **Checks.** Wi-Fi passes when the caller's IP is in a hotel network. Location passes when the phone's reported position, including its accuracy, is within the radius. If no check is enabled, the checks count as passed.
2. **Result** from the checks and the confirmation mode:

| Checks | `off`        | `on_fail`      | `always`       |
| ------ | ------------ | -------------- | -------------- |
| Passed | `verified`   | `verified`     | `needs_review` |
| Failed | `unverified` | `needs_review` | `needs_review` |

3. A record's verification is the worst of its check-in and check-out results (`rejected` > `needs_review` > `unverified` > `verified`).
4. A supervisor with `casual-attendance:write` can **Approve** (`verified`) or **Reject** (`rejected`) a `needs_review` or `unverified` record, with an optional note. A rejected record can be approved later; rejection is not deletion.
5. Supervisor marks and corrections behave as today and carry no verification value.

The value is named `needs_review`, not `pending`, because the Today list already uses `pending` for "not checked in yet".

### Snapshot

Every self action stores what applied: the settings version, which checks were on, whether each passed, the confirmation mode and the result. Changing the settings later does not change past results.

### Location privacy

- The browser asks for location only when the button is pressed and only when the department has Location on. Location is never tracked in the background.
- The phone sends latitude, longitude and accuracy. The server computes the distance and stores only inside/outside, the distance rounded to 10 m and the accuracy. Coordinates are not stored or logged.
- Refusing location is allowed. The check then fails and the result follows the table above.
- Reported positions can be faked; Location is a deterrent, not proof. This is stated in the settings dialog.

## Attendance rules for self actions

- Times come from the server clock, as today.
- **Work date:** today, except for a person on the night shift before 07:00 hotel time, which belongs to yesterday's shift.
- **Check-in** needs the person to be scheduled on the work date and to have no record yet. Lateness uses the existing 5-minute rule.
- **Check-out** closes the open record for today or yesterday.
- A worker cannot undo, reopen, correct or mark leave. A supervisor fixes mistakes with the existing reset, reopen and correction actions.
- If a supervisor has already checked the worker in, the worker sees that and can check out themselves, and vice versa.
- Self check-in needs: an active link, an active person, the module switched on, and Self check-in on for the person's department. Otherwise `SELF_DISABLED` or `NOT_LINKED`.

## Screens

All screens use the existing shared pieces and tokens listed in `docs/MODULE_STANDARD.md`: `ModulePage`, `ListRow`, `list-row-chip`, `ActionMenu`, `ModuleDialog`, `UndoSnackbar`, `usePhone()` and the `--workstel-*` tokens. No new visual pattern is introduced.

### Signed-in worker without workspace access

Today `src/auth/useAuth.ts` treats an account with no `staff_access` rows as **not signed in** and shows `accessDenied` ("No workspace access yet. Contact your administrator.") on the sign-in page. Self check-in therefore needs a platform change, not only a module screen:

- `useAuth` gains a third outcome next to signed in and signed out: **attendance only**. It is set when `workstel_session` returns no rows and `casual_attendance_self_status()` reports that the account may link or is linked.
- In that state the shell shows the thin header with sign-out and language only. There is no dashboard, favorites, module switcher or Settings.
- Not linked: the page shows **Link to attendance** with a short explanation, a 6-character code field and **Link**. Accounts that cannot link (module off) keep today's `accessDenied` message.
- Linked: `/` and every other URL open `/casual-attendance/me`.
- A staff member who also has a link keeps the normal workspace and reaches My attendance from the Casual Attendance page.

This is the only change outside the module directory, besides `docs/ROUTING.md` and `docs/SESSION_AUTH.md`.

### My attendance (worker, phone first)

Route `/casual-attendance/me`, named `casual-attendance-me`, added to the module's `routes.ts` and to the table in `docs/ROUTING.md`. The worker sees no other module, people or recap.

- Built on `ModulePage`: title "My attendance", description with person name, department, date and shift times.
- A status section modelled on Room Turnaround's own-timer section (`hk-running`): state, time and the primary button (`color="primary" size="large"`, full width on phones). **Check in**, then **Check out**. Check-out opens a `ModuleDialog` confirmation because the worker cannot undo it.
- Below the button, only for enabled checks: Hotel Wi-Fi connected / not detected, Location inside / outside / not shared.
- Today's state: not checked in; checked in at HH:MM; HH:MM–HH:MM with duration; marked leave, sick or absent by a supervisor (no button); not scheduled today (no button).
- Verification label for today using the existing chip tones: Verified, Needs review, Unverified or Rejected, with a line asking the worker to contact their supervisor when it needs review or was rejected.
- History: the last 14 days as `ListRow` rows with times, late flag and verification.
- Loading uses skeletons, errors are safe and retryable, and offline shows a message without queuing the press. Retrying is safe because check-in is refused when a record exists.

### Today tab (supervisors)

- The status chip stays as it is. Self-made records add "Self" and the verification to the existing `<small>` detail line in `#status`, so a row never carries two chips.
- The existing status filter gains **Needs review**.
- **Approve** and **Reject** go in the row's `ActionMenu`. When the record is already checked out and needs review, Approve becomes the row's primary action (`variant="tonal"`, `row-primary-action`), because the row has no other primary action then.
- Approve and Reject show `UndoSnackbar` feedback, like the existing marks.

### People tab (managers)

- Linked / Not linked in the row's `#status` detail line.
- **Create link code** and **Unlink** in the row's `ActionMenu`. Unlink uses a `ModuleDialog` confirmation with `destructive`, because it removes access.

### Self check-in settings (managers)

- A text button **Self check-in** in the page `#actions` slot, next to Export, for managers. The page keeps one primary action (Add).
- It opens a `ModuleDialog` form with a department select (managed departments only), the four settings, `dirty` tracking and version conflict handling as in the existing forms.
- No new tab; the three tabs stay Today, People and Recap.

### Recap tab

Add Needs review and Rejected day counts. Rejected days are not counted as present and add no worked time. Days that need review or are unverified are counted and flagged. The CSV export gains the same two columns.

All new system copy is English with matching Indonesian keys in `locales/en.ts` and `locales/id.ts`. User-entered names and notes are shown as entered.

## Server contract (proposed)

Names follow the existing module: `casual_attendance_<verb>` functions, an `action` parameter for related writes, `expectedVersion` for conflicts, and `{ data }` / `{ error }` responses.

New tables (RLS on, no direct client access, as for the existing tables):

- `casual_attendance_links` — person, user, hotel, department, created by/at, unlinked by/at.
- `casual_attendance_link_codes` — person, code hash, expiry, created by, used at.
- `casual_attendance_link_attempts` — user, time, outcome (for rate limiting).
- `casual_attendance_department_settings` — the settings above with `version`.
- `casual_attendance_hotel_settings` — hotel location and networks.
- `casual_attendance_self_events` — append-only like `casual_attendance_corrections`: record, action, settings snapshot, check results, rounded distance, accuracy, result.
- `casual_attendance_records` gains `source` (`supervisor` / `self`), `verification` (null for supervisor records), `reviewed_by`, `reviewed_at`, `review_note`.

Functions (security definer, empty search path, audited on success and denial):

| Function                                                                  | Who                   |
| ------------------------------------------------------------------------- | --------------------- |
| `casual_attendance_person_link(hotel, person, action)` — `code`, `unlink` | manage                |
| `casual_attendance_mark(...)` — new actions `approve`, `reject`           | write                 |
| `casual_attendance_settings(hotel, department?)`                          | read                  |
| `casual_attendance_save_settings(hotel, department, input, version?)`     | manage                |
| `casual_attendance_redeem_link_code(code)`                                | any signed-in account |
| `casual_attendance_self_status()`                                         | any signed-in account |
| `casual_attendance_self_mark(action, location?)`                          | linked account        |

`casual_attendance_list_people`, `casual_attendance_day` and `casual_attendance_recap` return the new fields.

New error codes: `NOT_LINKED`, `ALREADY_LINKED`, `CODE_INVALID`, `TOO_MANY_ATTEMPTS`, `SELF_DISABLED`, `NOT_REVIEWABLE`.

New audit actions, inside the existing `casual-attendance.person.*` and `casual-attendance.attendance.*` groups: `person.link-code`, `person.link`, `person.unlink`, `attendance.self-check-in`, `attendance.self-check-out`, `attendance.approve`, `attendance.reject`, plus `settings.save`, `hotel-settings.save` and denials. Codes, coordinates and IP addresses are never written to audit events.

Manifest: add `casual-attendance:self`. It is granted only through an active link, never through `module_access`.

## Frontend contract

- `types.ts`: `AttendanceRecord` gains `source` and `verification`; `RecapRow` gains `needsReview` and `rejected`; new `SelfStatus`, `DepartmentSettings` and `LinkCode` types.
- `validation.ts`: the parsers keep rejecting other hotels and invalid values, and also reject unknown `source` and `verification` values.
- `api.ts`, `live-api.ts` and `demo-api.ts` gain the same calls. The demo uses in-memory links and settings with the same rules.
- New error codes get messages in `useCasualAttendanceMessages.ts`.
- `casual-attendance.test.ts` and `supabase/tests/casual-attendance.test.ts` cover the new rules.

## Alignment with the existing module

What was checked against the code on 10 November 2026, and what changed in this draft:

| Area           | Finding in the code                                                                                  | Adjustment                                                                      |
| -------------- | ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| Sign-in        | `useAuth.ts` treats an account without `staff_access` as signed out.                                 | Added the "attendance only" auth state; it is a platform change.                |
| Naming         | The Today list already uses `pending` for "not checked in".                                          | Verification value renamed to `needs_review`.                                   |
| Self-service   | Room Turnaround shows the caller's own timer in an `hk-running` section with a large primary button. | My attendance reuses that layout instead of a new button style.                 |
| Rows           | Today rows have one chip, one tonal primary action and an `ActionMenu`.                              | Verification goes in the detail line; Approve/Reject in the menu.               |
| Primary action | The page has one primary action (Add) and Export as a text button.                                   | Settings is a text button and dialog, not a new tab or a second primary action. |
| Server         | Writes share functions with an `action` parameter (`save_person`, `mark`).                           | Review uses `mark`; linking uses one `person_link` function.                    |
| Audit          | Events are grouped as `casual-attendance.person.*` and `.attendance.*`.                              | New events placed in those groups.                                              |
| Operator tasks | Grants and platform admins are set with SQL scripts in `infra/`.                                     | Hotel networks and location are set with a script, not a screen.                |
| Routes         | Module routes live in the module's `routes.ts` and are listed in `docs/ROUTING.md`.                  | `/casual-attendance/me` added there.                                            |

## Delivery phases

1. **Linking and self check-in** with Supervisor confirmation and no automatic checks, including the auth state change. Usable on its own: departments can run "Always" or "Off".
2. **Location rule.**
3. **Wi-Fi rule**, after the IP question below is answered on the live server.

Each phase updates `README.md` and `ACCEPTANCE.md`, the demo API, the server tests in `supabase/tests/`, and passes `npm run format`, `npm run check`, `npm run modules:check` and `npm run build`, with desktop and 390px phone checks.

## Open questions

1. **Caller IP.** RPCs go from the browser straight to the hotel's Supabase. Confirm whether PostgREST receives a trustworthy client IP (for example `x-forwarded-for` set only by the hotel's own proxy) or whether a small server endpoint must read it. Until then, Wi-Fi stays off.
2. **Static hotel IP.** Confirm with the internet provider that the hotel's public address does not change.
3. **Who sets hotel networks and location:** an operator script (proposed) or department managers.
4. **Session length.** Sessions last 12 hours from sign-in, so workers will usually sign in with Google again each shift. Accept this, or review the session policy separately.
5. **Google return navigation.** `docs/ROUTING.md` notes that the Google callback always returns to `/`. That is fine for workers, because `/` opens My attendance for them.
