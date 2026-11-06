# Workstel module standard

Status: mandatory for all new modules. Approved visual reference: DESIGN_REFERENCE.md.
The production shell uses Supabase authentication, membership authorization, Vault metadata RPCs and, once their migrations are installed, the Vehicle Checklist and Bin Card RPCs with module-specific grants. Other modules and cross-module event delivery remain unavailable. See DEPLOYMENT.md for verified commissioning evidence; source implementation alone does not prove production acceptance.

## Create a module

Implemented modules must expose module-owned lazy routes following [ROUTING.md](ROUTING.md).
Use the manifest ID as the entry route name; include module routes in src/routes.ts.
Page navigation belongs in URLs so refresh and browser history preserve location.

Run: npm run module:new -- stock-transfer "Stock Transfer"
Then run: npm run modules:check and npm run build.
The generator copies src/modules/_template and adds its manifest to src/modules/registry.ts.
The generated dashboard card opens the existing metadata preview. Wire ModuleListPage.vue into production routing when implementing the module; generation alone does not enable operational functionality.
Do not generate modules directly in production.

## Required files

- manifest.ts: immutable identity, version, category, icon, permissions and events.
- pages/ModuleListPage.vue: initial page built with shared/ModulePage.vue.
- locales/en.ts and locales/id.ts: typed, matching system message keys.
- types.ts: domain records and request types.
- api.ts: API service contract, never direct database access from the browser.
- README.md: module purpose, setup, dependencies and integration details.
- ACCEPTANCE.md: acceptance evidence before release.
  Add components/, composables/, pages/ModuleDetailPage.vue and pages/ModuleFormPage.vue as real requirements emerge; do not create empty abstractions.
  Keep business logic inside its module. Share only domain-independent primitives.
  Future monorepo destinations: apps/web/src/modules, apps/api/src/modules, packages/contracts and packages/ui.

## Manifest and integration

IDs must be unique, permanent kebab-case; versions use semver.
English titles/descriptions are source metadata; display them through module translation keys.
Use MDI icons, the approved category values, and theme color tokens.
Permissions use module-id:action. Every mutation needs a specific permission.
Events use module-id.action.vN; published events belong to the publishing module.
Declare every subscription; registered publishers must exist. External events need an explicit adapter contract.
Use ModuleEvent and RecordReference, not direct cross-module table access.
Validate event payloads on the server. Publish after transaction commit using an outbox.
Consumers must be idempotent by event ID and support retry, dead-letter handling and correlation IDs.
Breaking event payload changes require a new event version.

## Module isolation

Modules are isolated by default, including records, APIs, permissions, audit readers and events. Shared authentication, canonical identity and domain-independent UI primitives do not grant access to another module's business data.
Cross-module access requires explicit approval and a documented contract naming the source, consumer, purpose, allowed operations, data and server-enforced permissions. A manifest subscription declares a dependency; it does not by itself grant runtime authorization. Do not import another module's internal implementation or read its tables directly.
Each module's audit API must filter its own namespace on the server before ordering and pagination. Frontend filters are not an isolation boundary. Module audit permission must never expose platform events or another module's events. Record audit-reader access in the owning module's namespace.
Platform session, staff-access and bootstrap events remain platform-owned. Preserve existing audit history; do not reclassify platform events as module events to make them visible. A shared physical audit table is allowed only behind scoped server APIs. No cross-module audit aggregation is authorized by default.
The platform audit reader `workstel_admin_list_audit(p_limit)` (migration `202611050001_platform_audit`) is platform-owned. It is open only to platform developers (`workstel_private.is_platform_admin()`), returns only `platform.*` events filtered on the server before ordering and the limit (1–100), and records its own access as `platform.audit.read` (success or denied). It never returns Vault or other module events, and module audit permission does not grant it. The admin audit page (`src/admin`) uses only this reader.

## Shared data and API

Domain records extend BaseRecord; use UUIDs and ISO 8601 UTC timestamps.
The server derives hotel, department and actor scope from its authenticated session.
Share canonical user, hotel, department, location and asset IDs; never duplicate master data.
Define allowed status transitions, units and concurrency/version behavior.
Money uses integer minor units and an explicit currency.
API prefix: /api/v1/modules/<module-id>.
Responses use {data, meta, error}; lists have bounded pagination and allowlisted filters/sorts.
Errors contain code, messageKey, fieldErrors and correlationId. Never expose stacks or secrets.
Validate requests and responses at runtime on the server; TypeScript types alone are insufficient.
Use idempotency keys for critical writes and version checks for conflicting updates.
Use a shared authenticated client once implemented, including cancellation, session expiration and safe error handling.

## Security and audit

SSO login is the first page. Remove demo bypass before production.
Check permissions and hotel/department scope on every server endpoint. Hiding UI is not authorization.
Audit create, update, delete, approve, export and secret reveal without recording secret values.
Vault stores metadata and secret references in the portal; secret values require a dedicated encrypted backend and separate key management.
Never put credentials, secrets or sensitive operational data in localStorage, logs, analytics or events.
Frontend permission states must mirror server capabilities, without replacing server enforcement.

## Visual and interaction standard

Vue + TypeScript + Vite + Vuetify; use shared/ModulePage.vue and the global Vuetify theme.
Quicksand UI, Noto Sans tables, MDI icons; primary #0096C7, background #F2F5F8, white cards, 6px radius.
Use the exact measured shadow tokens in DESIGN_REFERENCE.md.
Write styles with the `:root` tokens in src/styles.css: `--workstel-font-*`, `--workstel-weight-*`, `--workstel-space-*`, `--workstel-radius-*`, `--workstel-shadow-*`, `--workstel-leading-*`, `--workstel-tracking-*`, `--workstel-icon-*` (as `v-icon size="var(--workstel-icon-sm)"`), the height tokens (`--workstel-touch-target`, `--workstel-control-*`, `--workstel-row-*`, `--workstel-header-height`), `--workstel-z-*`, the text, avatar, status and surface colours, and `rgb(var(--v-theme-primary))` for the primary colour. Take dialog widths from `dialogWidth` in src/shared/dialog-widths.ts. Do not write these values as literals in module styles or templates. `npm run styles:check` (part of `npm run build`) rejects such literals; a deliberate exception needs a `token-exempt: <reason>` comment on the same line or the line above.
Render record lists as `<ul class="list-rows">` with `ListRow` from src/shared/list-row.vue: identity in the default slot (with an optional `icon`), status in `#status` (use `list-row-chip` for a status chip), actions in `#actions`. Do not write row grids, padding, separators or narrow-screen row rules in a module.
No sidebar, marketing banners, decorative animations, duplicate headers or fabricated metrics.
Desktop uses the shared thin header. Mobile uses one-column cards, full-width search and navigation beneath the top header row.
Pages include a title, one primary action, search/filter where needed, content and pagination.
Loading uses skeletons; errors have safe messages and retry; distinguish empty data from no search results.
Forms have visible labels, inline validation, saving state, submit protection, success feedback and cancellation.
Verify denied access, expired sessions, offline/network failures and conflicting edits when backend exists.
Preserve focus, dialog Escape behavior, keyboard access, touch targets and reduced-motion preferences.
Verify 390px mobile and desktop with no horizontal page overflow. Dense tables may scroll within a labeled region.

## Language and code

English is the default UI and engineering language.
Use camelCase variables/functions, PascalCase components/types, kebab-case module IDs.
Use English comments, API fields, event names and error codes.
Use typed translation keys for all system copy, labels, validation and accessibility names.
Module locales must contain matching English and Indonesian keys; English is fallback.
Never translate user-entered records. Format values with Intl using locale, hotel time zone and currency.
Do not use translated display labels as persisted identifiers, API values or permission names.
The current prototype shell has a legacy English-text translation adapter; new modules must use explicit keys as shown in the template.

## Automated gates and review

npm run build runs modules:check, Vue/TypeScript checks and the production build.
modules:check validates registry identity, permission/event naming, publisher availability, required scaffold files and locale-key parity.
These checks do not prove secure authorization, correct translations, accessibility or business correctness.
Complete ACCEPTANCE.md, add focused domain/API/event tests and record UI verification before release.
Generated prototype modules must remain clearly identified as demo until production requirements are satisfied.

## Module availability

### Module switch (module-grant modules)

Modules whose manifest sets `access: 'module-grants'` (Vehicle Checklist, Bin Card) have a server switch in `workstel_private.installed_modules.enabled`. `workstel_private.module_allowed()` requires it, so a disabled module denies every module RPC, is omitted from `workstel_module_access()` and shows Temporarily unavailable in the dashboard and on direct URLs. Data and grants are kept, so switching it back on restores access immediately, without a deployment.

Platform developers (`workstel_private.platform_admins`, granted with `infra/grant-platform-admin.sql`) switch modules from **Settings → Modules** or with `workstel_set_module_enabled(module_id, enabled)`. Changes are audited as `platform.module.<id>.enable|disable`, and denied attempts as `platform.module.switch`. The shell reads gating, route props and icons from manifests; a new module-grant module needs no App.vue change. Vault keeps its department-flag model and is not switchable yet.

### Manifest availability

Manifest availability is coming-soon by default. Only explicitly marked preview/available modules can open. Coming-soon modules must show a localized Coming soon label and be disabled in dashboard cards, favorites and the module switcher. Preview status does not mean production readiness.
Password Vault is the first metadata preview; read docs/VAULT_BACKEND_DESIGN.md before implementing real secret operations.

## Approved API and audit policy — 1 November 2026

Use authenticated internal APIs for Workstel. No public or anonymous operational API is planned. Add external integrations only for a defined business need with separately scoped service identities.
Production audit is mandatory, not optional. Record successful and denied access to sensitive resources, metadata mutations, archive/restore, secret writes/reveals, exports, and access-policy changes.
Each audit event must include actor identity, hotel/department scope, resource reference, action, outcome, server timestamp, and correlation ID. Never record secret values, tokens, or credentials.
Persist audit records on the server with append-only protections and restricted read access. Audit readers must have explicit scope and their access must itself be logged. Define retention, backup, and monitoring policies before production.
Secret release must fail closed if durable auditing is unavailable. Other security-critical changes require transactional audit recording or a durable outbox before acknowledging success.
The demo Vault activity display is held in memory. Production uses server audit records; the audit reader requires scoped audit permission and records its own access.

## Private-by-default Vault policy — 1 November 2026

The user selected private accounts by default with explicit owner sharing. This replaces inherited department visibility for Vault account records. Recipients get read-only access to specifically shared accounts, cannot reshare, and must remain enabled at the same hotel. Only owners may edit/archive/share, subject to staff capabilities. Server permission checks are mandatory; UI hiding is not enforcement. Audit capability must not confer account or secret read access. Database/server operators remain trusted administrators; application privacy is not end-to-end encryption against them.

## Vault ownership continuity — 4 November 2026

Owners may transfer an account to a colleague who can edit in the account's department, optionally keeping read-only access, and may share it read-only with whole departments at the same hotel (every enabled reader of that department can view and reveal it). Platform developers may list and transfer the accounts a user owns for offboarding; this does not give developers read access, and accounts the new owner cannot edit are reported and left in place. All transfers and department shares are audited as `vault.ownership.*` and `vault.share.department.*`. The encryption context keeps the owner recorded when the account was created (`secret_owner_id`), so transfers never re-encrypt or lose passwords.
