# Housekeeping

Room board and cleaning log for the Housekeeping department: live room status, timed cleaning tasks taken from the server clock, guest-declined service (DND or refused) and supervisor inspections.

## Capabilities

| Permission            | Server flag  | Allows                                                                                         |
| --------------------- | ------------ | ---------------------------------------------------------------------------------------------- |
| `housekeeping:read`   | `can_read`   | View the room board, history and daily summary                                                 |
| `housekeeping:write`  | `can_write`  | Start, pause, resume and finish own tasks; record DND or refused; check-out, check-in, OOO     |
| `housekeeping:manage` | `can_manage` | Inspect rooms, act on anyone's task, override room status, add, edit, import and archive rooms |

Grants live in `workstel_private.module_access` with `module_id = 'housekeeping'` and apply only while the matching `staff_access` membership is enabled and the module switch is on. Rooms belong to the Housekeeping department, so Front Office staff who should see ready rooms (or mark check-out and check-in) need a Housekeeping membership with read or write.

## Room status

| Status         | Code | Becomes                                                         |
| -------------- | ---- | --------------------------------------------------------------- |
| `vacant-dirty` | VD   | VC after a departure clean or deep clean is finished            |
| `vacant-clean` | VC   | VR when a supervisor passes it, VD when sent back with a reason |
| `vacant-ready` | VR   | OC on check-in                                                  |
| `occupied`     | OC   | VD on check-out; make-up room and turndown keep it occupied     |
| `out-of-order` | OOO  | Needs a reason; back in service returns it to VD                |

Task types and the room status they start from: departure (VD), make-up room and turndown (OC), pre-arrival preparation (VC or VR) and deep clean (any vacant status). Each attendant has at most one open task and each room at most one open task.

## Server contract

Migration `supabase/migrations/202611040011_housekeeping.sql` (requires `202611040001_module_access.sql`, `202611040006_module_switch.sql` and `202611040010_sales_crm.sql`). It also adds the `housekeeping` department to every hotel.

- `housekeeping_rooms_list(hotel, department?, includeArchived)`: the whole board (up to 1000 rooms) with each room's open task.
- `housekeeping_room_save(hotel, department, input, room?, expectedVersion?, action)` and `housekeeping_rooms_import(hotel, department, rows≤500)` (manage).
- `housekeeping_room_set_status(hotel, room, status, expectedVersion, note)`: write sets occupied, dirty and out of order; manage may set any status.
- `housekeeping_task_start(hotel, room, type, outcome?, notes)` and `housekeeping_task_update(hotel, task, action, outcome, notes?)`: start, pause, resume, finish (`done`, `dnd`, `refused`) and cancel. Durations exclude pauses and use `clock_timestamp()`.
- `housekeeping_inspect(hotel, room, result, expectedVersion, reason)` (manage): append-only inspections.
- `housekeeping_tasks_list(hotel, department?, day?, room?, after?, limit≤100)` and `housekeeping_summary(hotel, department?, day?)`: one hotel calendar day in `Asia/Jakarta`.

Every list, write and denial is audited as `housekeeping.*`. Error codes: `ACCESS_DENIED`, `INVALID_INPUT`, `VERSION_CONFLICT`, `DUPLICATE_ROOM`, `WRONG_ROOM_STATUS`, `ROOM_BUSY`, `ATTENDANT_BUSY`, `TASK_OPEN`, `TASK_CLOSED`, `NOTE_REQUIRED`.

## Frontend

`pages/ModuleListPage.vue` shows status tiles that filter the board, the caller's current task with a live timer, a room board grouped by floor, a room dialog with the actions the caller may take, and a history tab with per-task and per-attendant times. The board refreshes every 30 seconds while the page is visible. Timers use the server time offset from the summary. It uses `live-api.ts` in production and `demo-api.ts` (in memory) in demo mode.

## Not implemented

PMS integration (check-in and check-out are marked by hand), shift assignments, reports to Engineering, time targets and notifications are out of scope for this version. The manifest declares `housekeeping.room-ready.v1`, but no event delivery exists.
