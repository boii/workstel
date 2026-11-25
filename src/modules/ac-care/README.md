# AC Care

Engineering keeps a register of the hotel's air conditioners, sees which services are due, takes a task so no one else does it twice, and records each service with checklist items and measured readings. Each department keeps its own units; service and complaint records are append-only.

## Capabilities

| Permission       | Server flag  | Allows                                                                                         |
| ---------------- | ------------ | ---------------------------------------------------------------------------------------------- |
| `ac-care:read`   | `can_read`   | List units and schedules, read unit history and areas                                          |
| `ac-care:write`  | `can_write`  | Technician: take, release and postpone tasks; record services and complaints                   |
| `ac-care:manage` | `can_manage` | Supervisor / Chief Engineer: add, edit, import, archive units; assign tasks; manage area teams |

Grants live in `workstel_private.module_access` with `module_id = 'ac-care'` and apply only while the matching `staff_access` membership is enabled. A technician is anyone with an enabled write grant in the department. Supervisors and the Chief Engineer share the manage level; v1 has no separate Chief Engineer role.

## Server contract

Migration `supabase/migrations/202611250001_ac_care.sql` (requires the module access and module switch migrations).

- `ac_care_units_list(hotel, department?, includeArchived)`: up to 1000 units with their schedule. `meta.today` is the hotel day (Asia/Jakarta).
- `ac_care_unit_save(hotel, department, input, unit?, expectedVersion?, action)`: `save`, `archive`, `restore`, `broken` or `normal`, with optimistic versioning. Codes are stored in upper case and are unique per department.
- `ac_care_units_import(hotel, department, rows≤500)`: existing codes are skipped.
- `ac_care_work_set(hotel, unit, serviceType, action, note?, user?)`: `claim` (eight hours), `release`, `postpone` (reason required) and `assign` (manage).
- `ac_care_service_record(hotel, unit, input, idempotencyKey)`: the server decides the result.
- `ac_care_complaint_record(hotel, unit, kind, note, idempotencyKey)`: a normal unit then needs attention.
- `ac_care_unit_history(hotel, unit, beforeAt?, beforeId?, limit≤50)`: services and complaints, newest first.
- `ac_care_areas_list(hotel, department)` and `ac_care_area_member_set(hotel, department, area, user, add|remove, backup)`.

Every call records `ac-care.*` audit events with actor, scope, resource and outcome. Error codes: `ACCESS_DENIED`, `INVALID_INPUT`, `VERSION_CONFLICT`, `DUPLICATE_CODE`, `UNIT_ARCHIVED`, `CLAIMED_BY_OTHER`, `NOT_SCHEDULED`, `ASSIGNEE_INVALID`, `READINGS_REQUIRED`, `NOTES_REQUIRED`.

## Schedule rules

- Service kinds nest: filter cleaning ⊂ routine ⊂ major ⊂ annual. Recording a kind resets that kind and every smaller one, and clears their claims.
- Default intervals are 21, 90, 180 and 365 days, editable per unit; 0 turns a kind off.
- A due day is the hotel day of the last service of that kind (or a larger one) plus the interval. A unit never serviced starts on the day it was registered, so importing 200 units does not make everything overdue at once.
- The Tasks tab shows services due within 30 days. When a larger service is due no later than a smaller one, only the larger one is listed. Take task appears only for tasks that are overdue or due within 7 days; upcoming tasks are shown for planning (the server does not enforce this).
- Recording a service that is due more than 7 days ahead shows when it is next due and when it was last recorded, and requires a reason in Notes (for example a guest complaint). After saving, the notice names the next due day. The server does not enforce this.
- A claim lasts eight hours, then the task is free again. Another technician cannot take or record a claimed task; a supervisor can.

## Readings and results

Routine, major and annual services require return and supply air temperatures; major also requires suction pressure and current. The server marks a service **needs attention** when:

- a checklist item has an issue,
- the temperature drop is outside 8–14 °C,
- the suction pressure is outside 100–150 psi (R32, R410A) or 55–80 psi (R22),
- the current is more than 10% above the unit's rated current, or
- refrigerant was added again within 90 days.

These thresholds are general rules of thumb for comfort cooling, fixed in v1. The Chief Engineer should confirm them for the hotel's equipment before staff rely on them. Attention requires notes and sets the unit's condition; a normal service sets it back to normal.

## Frontend

`pages/ModuleListPage.vue` uses `live-api.ts` in production and `demo-api.ts` (in memory) in demo mode. Technicians with an area start on **My tasks**; others start on all tasks. Staff are shown by the part of their email before @, because reading profile display names needs its own approved contract (see `docs/MODULE_STANDARD.md`).

## Not implemented

- No link to Room Turnaround, the PMS or Bin Card (occupied rooms and spare parts are recorded by hand).
- No shift model: claims expire after a fixed eight hours.
- Workload view, shift handover summary and Chief Engineer reports (planned for v2).
- No module audit reader UI; audit records are stored server-side only.
