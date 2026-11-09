# Sales CRM

Hotel sales pipeline per department: accounts (corporate, travel agent, government, MICE organizer, wedding, other) with one main contact, deals on each account, and an append-only activity log.

## Capabilities

| Permission         | Server flag  | Allows                                              |
| ------------------ | ------------ | --------------------------------------------------- |
| `sales-crm:read`   | `can_read`   | View the pipeline, accounts, deals and activity log |
| `sales-crm:write`  | `can_write`  | Add and edit accounts and deals, and log activities |
| `sales-crm:manage` | `can_manage` | Archive and restore accounts                        |

Grants live in `workstel_private.module_access` with `module_id = 'sales-crm'` and apply only while the matching `staff_access` membership is enabled and the module switch is on. Developers grant levels on the Users page.

## Server contract

Migration `supabase/migrations/202611040010_sales_crm.sql` (requires `202611040001_module_access.sql`, `202611040006_module_switch.sql` and `202611040009_documents.sql`).

- `sales_summary(hotel, department?)`: open pipeline count and value per open stage, overdue follow-ups, follow-ups in the next 7 days, and deals won this month.
- `sales_accounts_list(hotel, department?, status, type?, search, after?, limit≤100)`: keyset pagination by name, with open deal totals, the earliest follow-up and the last activity date.
- `sales_account_save(hotel, department, input, account?, expectedVersion?, action)`: `save` (write), `archive` or `restore` (manage). The department is fixed at creation.
- `sales_deals_list(hotel, department?, stage, account?, followUp, search, after?, limit≤100)`: sorted by next follow-up (none last). Without an account filter, deals of archived accounts are hidden.
- `sales_deal_save(hotel, input, deal?, expectedVersion?)`: a deal stays on its account and inherits its department. Won and lost set `closed_at` and clear the follow-up date; lost needs a reason.
- `sales_activities_list(hotel, account, deal?, after?, limit≤100)` and `sales_activity_log(hotel, account, deal?, input, idempotencyKey)`: activities cannot be edited or deleted. Logging against an open deal can also set its next follow-up date. Each listed activity also carries `recorded_on` (hotel day of the server's `created_at`), `entry_delay_days` and `entry_timing`: `on-time` (same day), `late` (1–2 days after) or `backdated` (3 or more). The client never sends the logging time, so the timing cannot be set from the browser. Thresholds are fixed for all hotels (migration `202611090001`); apply that migration before deploying a frontend that reads these fields.

Follow-up dates are calendar days in Western Indonesia Time (`Asia/Jakarta`). Values are whole rupiah. Every list, write and denial is audited as `sales-crm.*`, and a won or lost deal also records `sales-crm.deal.won` or `sales-crm.deal.lost`. Error codes: `ACCESS_DENIED`, `INVALID_INPUT`, `INVALID_EMAIL`, `INVALID_PHONE`, `LOST_REASON_REQUIRED`, `ACCOUNT_ARCHIVED`, `DEAL_CLOSED`, `VERSION_CONFLICT`.

## Frontend

`pages/ModuleListPage.vue` has a Pipeline tab and an Accounts tab, summary tiles that filter overdue and upcoming follow-ups, an account detail dialog (contact, deals, activity log), and forms for accounts, deals and activities. It uses `live-api.ts` in production and `demo-api.ts` (in memory) in demo mode. Server responses are validated before they are shown.

## Not implemented

Multiple contacts per account, file attachments, reminders or notifications, currency other than IDR, reports and exports are out of scope for this version. The manifest declares `sales-crm.deal-won.v1`, but no event delivery exists.
