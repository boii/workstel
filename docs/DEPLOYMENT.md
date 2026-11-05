# Production deployment: Cloudflare Pages + self-hosted Supabase

Architecture approved 1 November 2026. Frontend starts on a pages.dev address. Supabase runs on the hotel's local server.
Staff sign in through Google (personal or Workspace accounts) or approved email/password accounts.
Email/password is implemented; a distinct username login needs a server-side directory and rate-limited lookup and is not implemented.

## Current readiness

Implemented in source: production/demo separation, Google PKCE and email/password adapters, server membership gate, metadata RPCs, database scope checks, transactionally recorded metadata audit, frontend production configuration gate and Pages response headers.
Commissioned with operator evidence: hotel Supabase instance, trusted HTTPS hostname, first administrator with four department grants, Pages deployment and successful email/password dashboard sign-in. Not commissioned: Google OAuth client, off-server audit archive, automated backup/restore, alerting or Vault secret encryption/reveal. Metadata write lifecycle on the actual server still requires the interactive verification script below.
The encrypted secret service now uses local backend AES-256-GCM with a mounted server keyring. See VAULT_OPERATIONS.md for current deployment evidence and recovery requirements. Metadata accepts only name, username, website and notes. Do not store passwords in notes.

## Network prerequisite

pages.dev serves the web bundle; browser requests go directly to Supabase on the hotel network.
Each staff browser must resolve and reach a trusted HTTPS Supabase hostname. A LAN address or self-signed certificate alone is insufficient for this deployment.
Google callback registration must use the approved API hostname; Auth redirects back to the exact pages.dev frontend origin.
External staff need an approved network access path to the hotel server. Do not expose PostgreSQL or Supabase Studio publicly.
Configure CORS for the exact frontend origin. It does not replace authentication/authorization.
Local-network access permissions and DNS/certificate behavior must be tested in the actual supported browsers.

## Hotel server

1. Obtain the production hostname and trusted certificate, OS/Docker details, storage capacity and backup destination.
2. Install a pinned official Supabase Docker release following https://supabase.com/docs/guides/self-hosting/docker. The CLI development stack is not a production deployment.
3. Generate unique database/JWT/admin secrets on the server; keep them out of this repository and VITE variables.
4. Merge infra/supabase.env.example with that release's upstream environment template. Configure reverse proxy HTTPS, SMTP and the Auth Google provider in the selected release's format.
5. Disable public email/password sign-up. Provision staff accounts through the admin API; assign access explicitly. Google identity creation does not grant workspace permissions.
6. Configure Google consent to permit the intended personal and Workspace accounts; a Workspace domain hint is not an authorization policy.
7. Apply reviewed SQL migrations to a backup-protected staging database first, then production with an authorized operator. Do not run the schema creation migration twice; use the server's migration history.
8. Provision the hotel, departments and staff_access rows using a restricted operator connection; there is no client endpoint to grant oneself access.
9. Configure gateway/Auth logs to record failed authentication requests without request bodies, passwords, bearer tokens or cookies.
10. Test backup/restore, TLS renewal and restart behavior before enabling staff.

## Frontend build

Set only public values in the Cloudflare Pages build environment:

- VITE_ENABLE_DEMO=false
- VITE_SUPABASE_URL=https://YOUR_TRUSTED_SUPABASE_HOST
- VITE_SUPABASE_ANON_KEY=the public anon/publishable key

Never use a service-role/secret key. The build gate rejects known secret key formats.
Build command: npm run build:production. Output directory: dist. Node.js: 24.
Builds use only bundled fonts/icons; no external font service is needed.
The production build generates a CSP allowing API connections to the configured Supabase origin only.
Configure the exact live pages.dev URL as SITE_URL and allowed redirect. Do not authorize arbitrary preview subdomains for production OAuth.
Do not configure a 404.html: Cloudflare Pages' normal SPA handling serves application routes.

## Sessions

Access/refresh tokens are held in memory, not localStorage/sessionStorage. Only a short-lived OAuth PKCE verifier is stored in sessionStorage for the redirect and removed after exchange.
Reloading the page requires another sign-in. This is an intentional initial session policy, not a guarantee of server-side revocation.
Sign-out clears local state and requests local Supabase session revocation. Server token lifetime and incident revocation procedures must be configured and tested.
Workspace access requires enabled staff_access assignments in the database; successful Google login alone never grants access.

## Metadata database boundary

Browser roles cannot directly select/write hotels, departments, vault_accounts or private audit/membership tables.
Only the explicit authenticated RPCs are exposed. Every RPC checks actor-scoped permissions; account updates check both original and destination department.
The private permission helper uses a fixed empty search_path and explicit schema names.
Metadata writes and their audit event commit together; audit insertion failure rolls back the write.
Denied authorization attempts reaching the RPC are logged without secret content. Requests rejected by the gateway require gateway/Auth audit collection.
Audit update/delete/truncate triggers protect normal SQL usage. Database superusers can change schema/triggers; off-server restricted archives are required before claiming tamper resistance against server administrators.

## Production acceptance

- Run npm run check.
- Run the migration and policy tests against the actual pinned Supabase/PostgreSQL deployment.
- Test Google personal, Google Workspace, email/password, unassigned staff, disabled membership and expired sessions.
- Verify denied hotel/department access, concurrency conflicts and simulated audit failure.
- Test desktop and 390px mobile against the real HTTPS endpoint; verify no demo bypass.
- Verify backup restore to a separate environment, storage recovery, restart recovery and audit retention.
- Commission a separate key-management system and secret-write/reveal audit path before using real Vault passwords.

## Production implementation update

The first migration now implements staff membership, metadata RPC scope checks, transactional metadata audit, membership-change audit and a scoped audit-read RPC. Audit reads are logged. Policies are tested using embedded PostgreSQL (PGlite); repeat integration tests on the actual pinned self-hosted Supabase stack before release.
The production frontend uses authenticated metadata RPCs and bounded pagination, not the in-memory preview store. Password writes and reveals are still deliberately unavailable. Provision named operator database accounts for administrative membership changes so the database-role audit field identifies the operator.

## Deployment addresses — 1 November 2026

Backend candidate confirmed by user: https://workstel.gabot.my.id. The root redirects to Cloudflare Access; /auth/v1/health and /rest/v1/ return 401 without API credentials. This proves HTTPS reachability, not authenticated API correctness or CORS readiness.
Preferred frontend: https://workstel.pages.dev, subject to Cloudflare project-name reservation. A missing DNS record is not proof that the project name is available.
For the current self-hosted Auth configuration, API_EXTERNAL_URL includes /auth/v1; the Google callback remains https://workstel.gabot.my.id/auth/v1/callback. Confirm the mounted Compose/Auth configuration before changing existing server settings.
Cloudflare API/CLI access must be reauthenticated before project reservation or deployment. Never place Cloudflare service tokens in the frontend to pass an Access policy. Keep Studio/admin protection intact while validating staff API routes.

## Cloudflare Pages project reserved

The Cloudflare Pages project workstel was successfully created on 1 November 2026 with production branch main. The assigned production address is https://workstel.pages.dev/ after its first deployment.
Project creation used Direct Upload (Wrangler); no GitHub integration or deployment has been configured yet. Creating a Direct Upload project does not automatically connect it to GitHub.
No application deployment was performed at this step. Configure the frontend public anon/publishable key and validate authenticated Supabase/CORS/OAuth before the first release. The local .env.production.local file is git-ignored.

## Backend connectivity check — 1 November 2026

The configured public key passed local client-key validation without being printed. Auth health and settings responded HTTP 200; REST preflight allowed the pages.dev origin and apikey/authorization/content-type headers.
The server currently reports Google disabled, email enabled and public signup enabled. The workstel_session RPC returned PGRST202 (missing from the schema cache), so the Workstel migration has not been verified as installed. No frontend deployment was performed while these prerequisites remained unresolved.
Use npm run check:connectivity to repeat the non-secret diagnostics. infra/apply-first-migration.sh checks for existing Workstel tables, makes a restricted local database backup and validates its archive listing before applying the transaction and notifying PostgREST. It does not replace off-server backups or a restore drill.
infra/check-auth-config.sh outputs only allowlisted non-secret settings; do not print or share complete container environments.

## Auth commissioning overlay

The server reported API_EXTERNAL_URL correctly ending in /auth/v1, but SITE_URL still pointed to the backend, no redirect allowlist, public signup enabled and Google not configured. Use infra/docker-compose.workstel-auth.yml as a third Compose file alongside the existing base/local files to set the pages.dev redirect and disable signup. Recreate only the auth service without pulling new images or dependencies. Keep the third file in every subsequent Compose operation so updates do not revert this policy.
An anonymous call to workstel_session now returns 42501 (permission denied), replacing the prior missing-function result. This indicates the RPC is installed and blocked to anonymous callers; it does not prove staff provisioning or authenticated runtime behavior.
Google remains disabled until its client credentials are configured server-side. Do not publish them in the frontend or chat.

## First metadata administrator

Use infra/bootstrap_admin.py on the hotel server, with the explicit approved email passed as --email. Password entry is interactive and hidden; never put a password in command arguments or chat.
The script uses the local Auth admin endpoint and reads the server-only service key from the server .env without printing it. Existing accounts keep their password and confirmation state.
For a new hotel it asks for the hotel name; for multiple hotels it requires an explicit --hotel-id. The selected administrator receives read/write/archive/audit capabilities for departments within that hotel, with grants and a bootstrap event recorded in the database.
An Auth account may be created before a later database transaction fails; rerun after correcting the database issue. It will reuse the account, not delete it or reset its password. This operation does not enable real secret storage/reveal.
Local script tests: python -m unittest discover -s infra -p 'test_*.py'.

## First Pages deployment — 1 November 2026

The operator reported successful provisioning of the first metadata administrator for The Alana Hotel & Convention Center Solo, with four department grants. The operator ran the provisioning script from /opt/hotel-portal; the running Supabase Compose project remains /opt/workstel as confirmed by its container labels.

Local npm run check and npm run build:production passed. Connectivity checks confirmed Auth health 200, email enabled, public signup disabled, Google disabled, permitted browser CORS, and anonymous RPC denial (42501).

Wrangler deployed the current working tree through Direct Upload to https://workstel.pages.dev/ (deployment https://99ffa03f.workstel.pages.dev/). The production URL returned HTTP 200 with the expected Workstel HTML and backend-scoped Content-Security-Policy. This deployment was not a GitHub commit or push. Authenticated browser sign-in and actual-server metadata/audit acceptance remain to be performed by the operator. Real secret storage and reveal remain disabled.

## Private Vault release — implementation pending server commissioning

The operator selected private-by-default accounts with explicit sharing. Privacy migration 202611010003 backfills each existing record's owner from created_by, starts with no shares, and restricts writes/sharing to the owner plus existing staff capabilities. Recipients receive read-only access and must remain enabled at the same hotel. Administrative department permissions do not grant access to another user's metadata. This is server-enforced application privacy, not end-to-end encryption against database/server operators.

The frontend enables live Vault only when workstel_session advertises meta.vaultPolicy=private-v1. Older servers leave the card temporarily unavailable. Apply the migration before publishing this frontend to avoid unnecessary downtime.

infra/apply-private-migration.sh validates prerequisites, makes a restricted local custom-format database backup and checks its archive listing, then applies migrations 202611010002 and 202611010003 in a single transaction. The helper skips an already recorded privacy release; it does not remove volumes, reset passwords or delete account/audit records. Archive inspection is not a restore drill.

infra/verify_production.py prompts locally for the operator password without displaying it and reads only the public key from the server .env. It tests login, private policy readiness, explicit membership, anonymous/direct-table denial, unknown hotel/department denial, fictional metadata CRUD, optimistic concurrency, archive/restore and durable audit. It leaves a clearly named fictional record archived as evidence and signs out its test session. Interrupted tests may leave the fictional record active; review and archive it, never delete unrelated records. It does not certify real secret storage, sharing between real staff accounts, browser connectivity, Google login or backup recovery.

The frontend hides Google sign-in when disabled, hides sample notifications, provides an access summary and scoped server audit reader, limits form departments to writable assignments, validates server records, cancels obsolete list requests and clears workspace navigation when the session ends.

## Local validation of the private release

npm run check passed with the private ownership/sharing database tests and response parser tests. The production configuration gate and Pages header preparation passed. Seven Python helper tests passed; the release shell scripts passed bash syntax validation.

The production build login was inspected at desktop and 390 x 844. Mobile document width and scroll width were both 390px. With Google disabled on the actual backend, the Google action was absent. A single fictional invalid login was rejected with a safe message and the password field cleared. The full private Vault/sharing/audit UI on the actual hotel backend remains unverified until the migrations are installed and the operator signs in again.

Server update package: .local-release/workstel-private-vault-20261101.tar.gz (ignored local artifact), with a companion SHA256 file. It contains only reviewed migration scripts, the interactive verifier and release instructions. No frontend, environment file or credentials are included. The new frontend has not been deployed pending the server update.

## Operator-confirmed private release

The operator ran verify_production.py on the actual hotel server and reported all 16 checks passed, including private-v1 readiness, login, membership, anonymous/direct-table denial, unknown hotel/department denial, metadata lifecycle, optimistic conflicts and durable mutation audit. Its fictional account remains archived and its test session was signed out.

The private frontend was published to https://workstel.pages.dev/ (deployment https://9e9be46e.workstel.pages.dev/) and returned HTTP 200 with noindex/nofollow/noarchive. The operator confirmed Vault opens and Audit log is visible after sign-in. This confirms the page/actions are present; it does not substitute for testing every dialog with multiple real staff accounts.

The encrypted service uses backend/vault Web Crypto AES-256-GCM and the service-only SQL boundary (202611010004 plus 202611010005). OpenBao has been replaced by a versioned, root-protected keyring mounted as a Docker secret. Recent authentication, rate/version checks, idempotency and durable fail-closed reveal auditing are preserved. See VAULT_OPERATIONS.md for installation, actual commissioning evidence and remaining recovery acceptance.

The operator explicitly deferred off-VM backup implementation. Track it as an operational limitation, retain local migration backups and preserve recovery shares separately. Do not claim off-server recovery or high availability is verified.

Latest private frontend deployment: https://b6f87319.workstel.pages.dev/; production URL https://workstel.pages.dev returned HTTP 200 and the expected current asset. The password UI remains availability-gated by authenticated backend status; local AES-GCM HTTPS commissioning is recorded in VAULT_OPERATIONS.md. Local production dependency audit reported zero vulnerabilities. The current local-encryption release contains server source, SQL migrations and installation/commissioning helpers; no credentials, keyring or frontend environment are included.

## URL routing release — 2 November 2026

Vue Router navigation and Vault account deep links were deployed to
https://62829a97.workstel.pages.dev/ (production https://workstel.pages.dev/).
The production root, /vault, /settings, a fictional UUID account path and an
unknown path returned HTTP 200 with the matching current application asset.
Unknown-page content is handled by the client router; HTTP 200 is the SPA fallback.

npm run format and npm run check passed, including 50 tests plus the module
generator test. Production configuration and Pages header preparation passed.
Local demo browser checks verified direct module entry, detail URL, refresh with
preview re-entry, Back/Forward, desktop drawer and 390px mobile layout. No real
accounts or secrets were used. Authenticated production refresh/deep-link
acceptance remains for the operator. See ROUTING.md for module integration,
OAuth callback limitations and the bounded metadata restoration scan.

## Interaction release — 3 November 2026

Commit 3909eaa was pushed to GitHub main and deployed through Direct Upload to
https://519753bb.workstel.pages.dev/ (production https://workstel.pages.dev/).
The release adds persisted module favorites, debounced Vault search with
AbortController cancellation, shell and Vault keyboard shortcuts, department
marks in the account list and skip-link/dialog/list accessibility semantics. It
contains no database, schema, RPC, storage or authorization change.

npm run format and npm run check passed, including 55 tests plus the module
generator test, manifest/locale checks, TypeScript and the production build.
Production configuration and Pages header preparation passed. The root, /vault,
/settings and an unknown path returned HTTP 200 with the current asset, and the
deployed asset hashes matched the local dist build.

A production browser check at https://workstel.pages.dev/ ran at 1440 x 900 and
390 x 844. Both widths rendered the real sign-in screen with no demo action and
no horizontal overflow (document width equalled innerWidth). The shortcuts
remained inert without a session, localStorage held only the locale preference,
the sole external request was the anonymous Auth settings probe, and its 401 was
the only console error.

Unavailable check: the debounced search, filter chips and new-account shortcut
need an authenticated Supabase session. They were verified by unit test and
source assertions, not against the production backend. No real staff account,
password reveal, sharing mutation or secret storage was exercised.

## Module audit isolation — 3 November 2026

Apply `supabase/migrations/202611030001_module_audit_isolation.sql` through the existing reviewed database migration process after the existing migrations, before deploying the updated frontend. The previous privacy installer does not apply this migration. Back up the existing database first. This additive migration changes the Vault audit RPC, records its version and reloads the API schema; it does not delete or rewrite audit history. Verify that scoped readers receive only `vault.*`, unauthorized scopes remain denied, and new reader attempts are recorded as `vault.audit.read`. Platform events remain stored but are not available through Vault. Source and embedded PostgreSQL tests do not establish production deployment or acceptance.

## Operational modules release — 4 November 2026

Vehicle Checklist and Bin Card add module-specific capabilities in `workstel_private.module_access` (separate from Vault and `staff_access` flags), their own tables and scoped RPCs, and `public.workstel_module_access()`, which reports installed modules and the caller's grants. Migrations: `202611040001_module_access.sql`, `202611040002_vehicle_checklist.sql`, `202611040003_bin_card.sql`.

Install on the hotel server with `bash infra/apply-operations-modules.sh /path/to/supabase/migrations`. The helper requires the base schema and migration ledger, makes a restricted local custom-format backup and checks its archive listing, applies only migrations not yet recorded, and exits without changes if all three are present. It does not modify Vault data or audit history. Then grant access per staff member and department with `infra/grant-module-access.sql`; no grants exist after installation.

The frontend is safe to deploy before the migration: when `workstel_module_access` is missing or returns no grant, both dashboard cards show Temporarily unavailable and direct URLs show the same message. Embedded PostgreSQL tests cover scope, validation, balances, idempotency, append-only records and audit namespaces; they do not establish acceptance on the actual pinned Supabase stack. Event delivery for `vehicle.inspected.v1` and `bin-card.stock-low.v1` is not implemented.

Migration `202611040004_accounting_department.sql` adds `accounting` to the canonical department codes and creates an Accounting department for every existing hotel. It creates no staff membership or module grant. The frontend Vault recognises the code; Vault flags remain off unless an operator sets them. `infra/apply-operations-modules.sh` now applies all four operational migrations and skips any already recorded.

Migration `202611040005_hr_admin_departments.sql` adds `human-resource` (Human Resource) and `admin-general` (Admin and General) for every existing hotel, again without memberships or grants. The Vault frontend recognises both codes, and the operations installer applies the migration after `202611040004`.

Migration `202611040006_module_switch.sql` adds the module switch (`installed_modules.enabled`, enforced in `module_allowed()`), the `platform_admins` developer role and the audited `workstel_list_modules()` / `workstel_set_module_enabled()` RPCs. Existing modules stay enabled. No developer exists until an operator runs `infra/grant-platform-admin.sql`. The frontend tolerates servers without this migration: the Modules panel stays hidden because `platformAdmin` is absent.

## User management release — 4 November 2026

Migration `202611040007_user_admin.sql` adds developer-only, audited RPCs to list users and set department membership with Vault flags, Vehicle Checklist and Bin Card levels and the developer role (a developer cannot remove their own role), plus a `must_change_password` flag reported by `workstel_module_access()`. Service-role-only helpers record audit events and set the flag.

The `workstel-users` edge function (`backend/users`) creates accounts, resets passwords, blocks and unblocks sign-in through the GoTrue admin API, and changes the caller's own password after a sign-in within the last 10 minutes. Developer status is checked with the caller's own token. Temporary passwords are generated on the server, returned once with `no-store`, and never logged or stored; the user must replace them at the next sign-in. Developers cannot reset, block or change their own account through admin actions. Install it by copying `backend/users/handler.ts` and `index.ts` to `/opt/workstel/volumes/functions/workstel-users/`; it uses the existing function environment (`SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `WORKSTEL_FRONTEND_ORIGIN`).

SMTP on the hotel stack still uses the template sender, so invitation and recovery emails are not used. Blocking ends sign-in and token refresh; an already issued access token remains valid until it expires.

## Vault ownership release — 4 November 2026

Migration `202611040008_vault_ownership.sql` adds `vault_accounts.secret_owner_id` (backfilled from `owner_id`, set on insert and immutable), department shares, owner transfers and developer offboarding RPCs, and replaces `account_allowed_for` and `vault_secret_prepare` so reads include department shares and the encryption context uses `secret_owner_id`. The `workstel-vault` edge function is unchanged; existing ciphertext stays valid because `secret_owner_id` equals the previous owner for every row. Apply it with `infra/apply-operations-modules.sh`.

## Documents & SOPs release — 4 November 2026

Migration `202611040009_documents.sql` adds `documents` to the module and grant allowlists, a `documents_links` table (https links only, no files), the scoped `documents_list` / `documents_save` RPCs, and registers the module as installed and enabled. No grants exist until a developer assigns levels on the Users page. Apply it with `infra/apply-operations-modules.sh`.

## Sales CRM release — 4 November 2026

Migration `202611040010_sales_crm.sql` adds `sales-crm` to the module and grant allowlists, the `sales_accounts`, `sales_deals` and append-only `sales_activities` tables, the scoped `sales_summary`, `sales_accounts_list`, `sales_account_save`, `sales_deals_list`, `sales_deal_save`, `sales_activities_list` and `sales_activity_log` RPCs, and registers the module as installed and enabled. Read lists and opens records, write adds and edits accounts and deals and logs activities, and manage also archives and restores accounts. No grants exist until a developer assigns levels on the Users page. Apply it with `infra/apply-operations-modules.sh`.

## Housekeeping release — 4 November 2026

Migration `202611040011_housekeeping.sql` adds the `housekeeping` department to every hotel, adds `housekeeping` to the module and grant allowlists, creates `housekeeping_rooms`, `housekeeping_tasks` and append-only `housekeeping_inspections`, the scoped room, task, inspection, history and summary RPCs, and registers the module as installed and enabled. Task times use the database clock. No memberships or grants are created; a developer adds Housekeeping memberships and levels on the Users page, and a supervisor imports the room list. Apply it with `infra/apply-operations-modules.sh`.

## Housekeeping timer release — 4 November 2026

Migration `202611040012_housekeeping_timer.sql` narrows Housekeeping to timing each room cleaning. It drops room status, inspections, declined service and task notes, keeps the task types check-out (`departure`), make-up room and other, and replaces the task RPCs with `housekeeping_task_start(hotel, room, type)` and `housekeeping_task_update(hotel, task, action)`. It stops without changes if inspections or the removed task types hold data. Apply it with `infra/apply-operations-modules.sh`.

## Room Turnaround release — 4 November 2026

Migration `202611040013_room_turnaround.sql` renames the Housekeeping timer module to **Room Turnaround** (Indonesian: Waktu Siap Kamar): module ID `room-turnaround`, route `/room-turnaround`, tables `room_turnaround_rooms` and `room_turnaround_tasks`, RPCs `room_turnaround_*` and audit actions `room-turnaround.*`. Existing grants and the module switch move to the new ID. The Housekeeping department keeps its name and code, and earlier `housekeeping.*` audit events stay as recorded. Apply it with `infra/apply-operations-modules.sh`, then deploy the frontend right away, because the old frontend calls the removed `housekeeping_*` RPCs.

## Command palette and adaptive tables release — 5 November 2026

Commit 4875a43 (frontend only; no migration) adds the command palette, adaptive stacked tables for the Bin Card ledger and Room Turnaround attendants, and optimistic Documents archive/restore with Undo. See DESIGN_REFERENCE.md.

The GitHub Actions run for this push (42027486289) did not start: GitHub reported the account as locked due to a billing issue. The previous run (41911176044, commit 9b2c638) failed for the same reason. CI therefore did not run `npm run check` or deploy. `npm run check` passed locally before the commit. `npm run build:production` passed locally, including the production configuration gate. The bundle was then published through Wrangler Direct Upload to https://c7b2cf07.workstel.pages.dev/ (production https://workstel.pages.dev/). `scripts/verify-pages-deployment.mjs` passed, and the production entry asset matched the local build.

Operator acceptance after sign-in, not yet performed:

1. Press Ctrl/⌘ + K on the dashboard and inside a module. Search a module and press Enter. Switch the language from the palette.
2. On a phone, tap the header search icon. The palette opens fullscreen and Cancel closes it.
3. In Documents, with a manage grant, archive a test document. The row disappears and Undo appears. Select Undo, then archive and restore it once more. No version-conflict message should appear. Confirm both actions appear in the module audit.
4. On a phone, open a Bin Card ledger and the Room Turnaround summary. Rows show as labelled cards without sideways scrolling.

Once the GitHub billing issue is resolved, re-run the Quality workflow on main so CI records the check and deployment.

## Mobile density release — 5 November 2026

Commit 64fb3ea (frontend only; no migration) adds compact mobile filters, the collapsing mobile header and the floating primary action, and fixes command palette search focus. See DESIGN_REFERENCE.md.

GitHub Actions remained blocked by the account billing lock. `npm run check` and `npm run build:production` passed locally. The bundle was published through Wrangler Direct Upload to https://92a1da7e.workstel.pages.dev/ (production https://workstel.pages.dev/). `scripts/verify-pages-deployment.mjs` passed, and the production entry asset matched the local build.

Operator acceptance on a phone after sign-in, not yet performed: the Filters button and badge in Documents, Bin Card, Vehicle Checklist, Sales CRM and Room Turnaround; the header navigation row hides on scroll down and returns on scroll up; the floating create button opens its form and does not cover the last record.

## Undo, skeleton and empty state release — 5 November 2026

Commit e115ca3 (frontend only; no migration) extends optimistic archive/restore with Undo to Vehicle Checklist and Bin Card, adds Undo after a confirmed Sales CRM account archive, and adds content-shaped skeletons and actionable empty states. Undo relies on the archive/restore RPCs raising the record version by one. This was confirmed in the `vehicle_save`, `bin_card_item_save` and `sales_account_save` migrations.

GitHub Actions remained blocked by the account billing lock. `npm run check` and `npm run build:production` passed locally. The bundle was published through Wrangler Direct Upload to https://95ee52f3.workstel.pages.dev/ (production https://workstel.pages.dev/). `scripts/verify-pages-deployment.mjs` passed, and the production assets matched the local build.

Operator acceptance after sign-in, not yet performed: archive a test vehicle and a zero-balance Bin Card item, then select Undo for each. Confirm that archiving an item with stock is refused and the row stays. Archive a Sales CRM test account, confirm, then select Undo. No version-conflict message should appear, and every action should appear in the module audit.

## Production inspection fixes — 5 November 2026

The operator signed in, and production build e115ca3 was then inspected in the in-app browser at desktop and 390px widths. No data was changed. Palette, compact filters, floating actions, skeletons and the unfiltered empty state worked. Two display bugs were found:

- An empty Filters button appeared in Room Turnaround because the hotel has one floor and one department.
- Counts read "1 items" and showed "0" while loading.

Commit dd8d7e9 fixes both. It was published through Wrangler Direct Upload to https://f9cf0415.workstel.pages.dev/ (production https://workstel.pages.dev/), because GitHub Actions is still blocked by billing. `npm run check`, `npm run build:production` and `scripts/verify-pages-deployment.mjs` passed, and the production entry asset matched the local build. In the signed-in session, the following were confirmed:

- Room Turnaround shows "Loading records", then "1 room", with no Filters button.
- Vehicle Checklist, Bin Card and Sales CRM show "1 vehicle", "1 item" and "1 deal" and keep their Filters button.

Observed but not addressed: RPCs to the hotel Supabase host took 0.9–4.3 s each for single-row results (slowest: `room_turnaround_rooms_list` 4.3 s, `bin_card_list_items` 3.6 s). The host sends no `Timing-Allow-Origin`, so the browser cannot split network and server time. Investigate on the server. Undo against production data has not been exercised.

## Room floor grouping release — 5 November 2026

Commit 7828c3b (frontend only) lists Room Turnaround rooms without a floor last, under "No floor" ("Tanpa lantai"), after numbered floors in natural order. It was published through Wrangler Direct Upload to https://a1fa3066.workstel.pages.dev/ (production https://workstel.pages.dev/), because GitHub Actions is still blocked by billing. `npm run check`, `npm run build:production` and `scripts/verify-pages-deployment.mjs` passed. In the signed-in production session the groups read Floor 1, Floor 2, Floor 3, Floor 10, No floor.

The production hotel now also holds UI dummy records. They were created on 5 November 2026 through the app's own RPCs, so permissions were checked and every action was audited, as a development fixture: vehicles, Bin Card items, 56 documents, Sales CRM accounts and deals, and Housekeeping rooms and tasks. Undo was confirmed there against the real server: a dummy vehicle was archived, restored by Undo, and the version advanced with no conflict. A Bin Card archive with stock remaining was refused and the row returned. Remove these records before go-live.
