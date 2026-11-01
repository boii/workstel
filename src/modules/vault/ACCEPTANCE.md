# Password Vault acceptance

Status: private metadata implementation tested locally; actual-server metadata checks passed; encrypted-password runtime commissioning remains pending.

## Verified locally

- Manifest, module file contract and English/Indonesian locale parity.
- Production/demo isolation and no production demo bypass.
- Server metadata CRUD, version conflict rejection, archive/restore, bounded lists and exact scope enforcement in embedded PostgreSQL.
- Private-by-default ownership; administrative department permissions do not open another user's account.
- Owner-only explicit sharing, read-only recipients, revocation, disabled membership and rollback when durable audit fails.
- Runtime response validation rejects cross-hotel data and malformed records.
- Scoped audit reader, hotel-wide audit isolation and append-only audit protections.
- Interactive commissioning helpers never print passwords or tokens; script/parser tests pass.
- Google UI depends on actual Auth provider settings; sample notifications are hidden in production.

## Operator evidence

- Supabase services healthy; HTTPS Auth and REST CORS reachable.
- Public signup disabled and first administrator provisioned with four department grants.
- Email/password login to the production dashboard confirmed by the operator.

## Still required

- [x] Privacy/audit migrations installed; operator reported all 16 actual-server verifier checks passed.
- [x] verify_production.py passed on the actual server; operator confirmed Vault/audit entry points. Full multi-user dialog and 390px production acceptance still needs verification.
- Commission the local AES-GCM encryption service and gated UI on the actual server. Local orchestration/SQL tests cover token validation, recent authentication, read-only sharing, revocation races, idempotency, rate limits, ciphertext isolation and audit failure. Actual HTTPS/runtime/key recovery and recovery acceptance remain separate.
- Configure and verify Google OAuth if required for rollout.
- Complete off-server backup/restore, audit retention/archival, alerting and restart recovery exercises.

Do not mark the complete Password Vault production-ready based on metadata tests alone.

## Compact account list — 2 November 2026

Implemented a compact desktop account list and two-line mobile rows using the
existing Vuetify theme. Search, access filtering and refresh share one toolbar;
status/department/hotel filters expand on demand. Account details open in a
focus-trapped right-side dialog, full-screen on mobile. Metadata edit, password
write, sharing and archive/restore remain subject to the existing capabilities.

Passwords are fixed-length placeholders until an explicit eye/copy action calls
the existing audited reveal endpoint. Plaintext is kept only in component
memory, cleared after 30 seconds, on blur/hidden tab, list refresh/filter change,
detail/dialog opening and component disposal. Requests are aborted/invalidated
when cleared so a delayed response cannot reopen a password. Copy feedback is
local; the device clipboard and its history cannot be reliably cleared.
Reauthentication reuses the existing identity check and resumes only the
requested action. No secret is fetched automatically for list rows.

The access selector filters loaded metadata only; counts say "loaded accounts"
and a pagination hint explains the scope while more pages remain. Search,
department/status and backend authorization still run on the server. Closing
details retains list state. Saving metadata refreshes the previously loaded
number of pages without replacing the list with an initial loading screen.

Browser acceptance uses isolated fictional fixtures excluded from builds. Real
staff password actions and multi-user acceptance must still be checked on the
deployed application; no real secrets were used in visual checks.

Verified desktop and 390 × 844 browser layouts with long record values and
English/Indonesian labels, including a 390px full-screen detail dialog with no
horizontal document overflow. Browser checks passed for inline reveal/copy,
30-second auto-hide, delayed-response cancellation when opening details, denied
reveal feedback, failed/successful reauthentication, shared-account read-only
menus, loaded access filtering, and search-button/Enter submission with no-result
feedback. These checks exercised actual UI components with fictional API/Auth
fixtures, not production accounts.

## Compact audit log — 2 November 2026

Replaced expanded per-event blocks with 48px desktop summaries and 64px mobile
summaries. Full actor/resource/reference/event IDs remain available in native
keyboard-accessible disclosure sections. The mobile dialog is full-screen;
header, scope controls and refresh remain outside the scrolling activity body.
Result labels remain readable without relying on colored status dots.

Added local search and result filtering over the latest 100 loaded events.
Counts explicitly describe loaded events. Department scope still comes from the
existing server RPC and audit capability; loading the audit log remains audited.
Timestamps include seconds and explicitly use Asia/Jakarta.

Verified desktop and 390 × 844 mobile layouts using 40 fictional events: no
horizontal overflow, disclosure expansion with Enter, complete IDs in details,
combined search/result filters, reset, empty log, no matches, and load failure
with retry control. English and Indonesian copy was inspected. No real audit
records or server authorization changes were used for these visual checks.
