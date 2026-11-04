# Room Turnaround

Module ID `room-turnaround` (route `/room-turnaround`), used by the Housekeeping department. Times how long each room takes to clean. A room attendant taps a room, picks the kind of cleaning and the timer starts; pause, resume and finish are one tap each. Supervisors see who is cleaning which room and the average time per room, per kind of cleaning and per attendant.

## Capabilities

| Permission               | Server flag  | Allows                                                     |
| ------------------------ | ------------ | ---------------------------------------------------------- |
| `room-turnaround:read`   | `can_read`   | View rooms, running timers, history and the daily summary  |
| `room-turnaround:write`  | `can_write`  | Start, pause, resume, finish and cancel own timers         |
| `room-turnaround:manage` | `can_manage` | Act on anyone's timer; add, edit, import and archive rooms |

Grants live in `workstel_private.module_access` with `module_id = 'room-turnaround'` and apply only while the matching `staff_access` membership in the Housekeeping department is enabled and the module switch is on.

## Rules

- Kinds of cleaning: check-out (`departure`), make-up room (`make-up`) and other (`other`).
- One running timer per room and per attendant (`ROOM_BUSY`, `ATTENDANT_BUSY`).
- Start, pause and finish times come from the database clock (`clock_timestamp()`); the duration excludes pauses. A cancelled timer has no duration and is not counted.

## Server contract

Migrations `202611040011_housekeeping.sql` (Housekeeping department, rooms, tasks), `202611040012_housekeeping_timer.sql` (narrowed to the timer) and `202611040013_room_turnaround.sql` (renamed to Room Turnaround).

- `room_turnaround_rooms_list(hotel, department?, includeArchived)`: rooms with the running timer and the last finished cleaning; `meta.now` gives the server time for live timers.
- `room_turnaround_room_save(hotel, department, input, room?, expectedVersion?, action)` and `room_turnaround_rooms_import(hotel, department, rows≤500)` (manage).
- `room_turnaround_task_start(hotel, room, type)` and `room_turnaround_task_update(hotel, task, action)` with `pause`, `resume`, `finish` or `cancel`.
- `room_turnaround_tasks_list(hotel, department?, day?, room?, after?, limit≤100)` and `room_turnaround_summary(hotel, department?, day?)`: one hotel calendar day in `Asia/Jakarta`, or one room.

Every list, write and denial is audited as `room-turnaround.*`. Error codes: `ACCESS_DENIED`, `INVALID_INPUT`, `VERSION_CONFLICT`, `DUPLICATE_ROOM`, `ROOM_BUSY`, `ATTENDANT_BUSY`, `TASK_OPEN`, `TASK_CLOSED`.

## Frontend

`pages/ModuleListPage.vue` shows the caller's running timer at the top, a room grid by floor (running timers and the last cleaning time), a room dialog with three start buttons and recent times for that room, and a history tab with average and longest time per kind of cleaning and per attendant. The list refreshes every 30 seconds while visible. It uses `live-api.ts` in production and `demo-api.ts` (in memory) in demo mode.

## Not implemented

Room status, inspections, PMS integration, shift assignments, time targets and exports are out of scope. The manifest declares `room-turnaround.room-cleaned.v1`, but no event delivery exists.
