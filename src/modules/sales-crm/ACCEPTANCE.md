# Sales CRM acceptance

## Implemented and verified locally (4 November 2026)

- [x] Module-specific capabilities (read, write, manage) per hotel department enforced in PostgreSQL; other departments see nothing (`supabase/tests/sales-crm.test.ts`).
- [x] Accounts validate type, phone and email; deals validate values, room nights, stay dates and the lost reason.
- [x] Won and lost deals record `closed_at` and clear follow-ups; reopening clears `closed_at`. Edits need the current version (`VERSION_CONFLICT`).
- [x] Activities are append-only, idempotent per submit, cannot be dated in the future, and can move an open deal's follow-up.
- [x] Every activity shows the day it was recorded by the server and is marked as a late entry (1–2 days after) or backdated (3 or more days after); the form warns before a past date is saved.
- [x] Managers see an Entry report per hotel month: totals, on-time rate per person and the late and backdated entries; staff without manage do not see the tab and the server refuses the report.
- [x] Sales calls, meetings and site inspections need an outcome; the log shows it with the client contact and reference, and the Entry report counts outcomes per month.
- [x] Archiving an account needs manage and blocks new deals and activities; its deals leave the pipeline and summary.
- [x] The module switch blocks every Sales CRM RPC when off; tables are not readable by clients.
- [x] Lists, writes and denials are audited under `sales-crm.*`.
- [x] Response parsers reject malformed rows (`sales-crm.test.ts`).
- [x] Demo mode uses in-memory sample accounts and deals with the same rules.

## Required before staff use

- [ ] Operator applies `202611040010_sales_crm.sql` with `infra/apply-operations-modules.sh`.
- [ ] A developer grants levels on the Users page (usually the Sales & Marketing department).
- [ ] Signed-in check on the live server: add an account, add a deal, log an activity with a follow-up, close a deal as won, archive and restore an account.
