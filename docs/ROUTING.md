# Workspace routing

Implemented 2 November 2026 with Vue Router 4 and HTML5 history. The URL is the
source of truth for navigation; no browser storage or global state store is used.

| Page                 | URL                                         |
| -------------------- | ------------------------------------------- |
| Dashboard            | `/`                                         |
| Favorites            | `/favorites`                                |
| Settings             | `/settings`                                 |
| Help                 | `/help`                                     |
| Users (developers)   | `/admin/users`                              |
| Demo tasks           | `/tasks`                                    |
| Vault list           | `/vault`                                    |
| Vault account drawer | `/vault/accounts/:accountId?hotel=:hotelId` |
| Vehicle Checklist    | `/vehicle`                                  |
| Bin Card             | `/bin-card`                                 |
| Documents & SOPs     | `/documents`                                |
| Sales CRM            | `/sales-crm`                                |
| Housekeeping         | `/housekeeping`                             |

`src/router.ts` installs browser history. `src/routes.ts` combines shell routes
with module-owned routes. Shell content remains in App.vue to preserve the
approved layout. Unknown paths show localized page-not-found content. Production
tasks remain unavailable, including when accessed directly by URL.

## New modules

1. Use the existing module generator and availability contract.
2. Add `routes.ts` inside the module. Export `RouteRecordRaw[]` and use lazy
   `component: () => import('./pages/module-list-page.vue')` imports.
3. Name the module's entry route exactly as its manifest ID. Set
   `meta.moduleId` to that ID and `meta.view` to its English system title.
4. Include the module's routes in `src/routes.ts`. The shared shell renders
   module routes through RouterView. Module entry components receive assignments
   and availability props; they must gate their own capabilities.
5. Test direct entry, refresh, Back/Forward, missing records and denied access.
   Navigation availability never replaces server authorization.

## Authentication and state

The existing authentication restoration gate runs before workspace content is
mounted. A signed-out visitor keeps the requested URL while signing in; successful
email/password sign-in opens that URL. Google OAuth is currently disabled; its
existing callback still targets `/`. Before enabling Google, implement and verify
return navigation together with the server redirect allowlist. Expired sessions hide workspace content without discarding
the destination. Explicit sign-out replaces the URL with `/` and unmounts modules.
The demo requires entering preview again after refresh and then restores its URL.

Live Vault keeps hotel, submitted search, status, department and access filters in
query parameters. Invalid filter values fall back to allowed defaults. Filter
updates replace history; opening an account pushes history. Back closes a drawer;
Forward reopens it. Closing a drawer explicitly replaces its URL with the list.
Load-more progress resets on refresh; it is not yet URL state. Other shell and
demo filters remain local.

Forms, password reveals, identity checks and confirmation dialogs remain local.
Never put passwords, tokens, notes or unsaved form payloads in route/query state.
Records are fetched from the authenticated server, never serialized into URLs.

## Account restoration boundary

The current server has no dedicated metadata-by-ID read RPC. Direct account
restoration uses the existing authorized `vault_list_accounts` RPC, across at most
20 pages of 100 records for the selected hotel, including archived records.
Each response is scope-validated; navigation cancels stale requests. Missing or
inaccessible accounts show a safe message. Exhausting the scan limit shows a load
error rather than claiming the account does not exist. Add a server-authorized,
audited by-ID RPC before this limit becomes operationally significant.

## Hosting and validation

Cloudflare Pages must return the SPA entry HTML for non-asset workspace paths.
Keep Pages' default SPA fallback (no top-level `404.html`); preserve `/api/session`
Functions routing. Test direct `/vault`, `/settings` and unknown URLs after release.

Automated tests cover route matching, query retention, Back/Forward, missing paths,
authorized detail pagination, foreign response scope, cancellation and scan bounds.
Local demo UI checks cover direct Vault entry, account URL, refresh followed by
preview re-entry, desktop drawer and 390px fullscreen layout. Actual production
session restoration and private account deep links still require authenticated
operator verification; demo checks do not certify them.
