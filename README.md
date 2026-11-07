# Workstel.

An internal workspace for hotel operations: one sign-in, one compact dashboard, and a set of isolated modules for daily work.

Built with Vue 3, TypeScript, Vite and Vuetify. The frontend runs on Cloudflare Pages, and the backend is a Supabase instance hosted on the hotel's own server.

**Production:** https://workstel.pages.dev (staff sign-in required)

## Contents

- [Modules](#modules)
- [Quick start](#quick-start)
- [Scripts](#scripts)
- [Project structure](#project-structure)
- [Add a module](#add-a-module)
- [Deployment](#deployment)
- [Security and current limits](#security-and-current-limits)
- [Documentation](#documentation)
- [License](#license)

## Modules

| Module            | What it does                                              | Status    |
| ----------------- | --------------------------------------------------------- | --------- |
| Vehicle Checklist | Vehicle register and inspections with history             | Available |
| Bin Card          | Stock items, stock movements and a running ledger         | Available |
| Documents & SOPs  | Links to department documents and SOPs (https links only) | Available |
| Sales CRM         | Accounts, deals, pipeline stages and logged activities    | Available |
| Room Turnaround   | Per-room cleaning timer, attendants and daily summary     | Available |
| Password Vault    | Private-by-default work accounts with explicit sharing    | Preview   |

**Available** modules use module-specific server grants. A module opens for a staff member only after its migration is installed on the hotel server and a developer grants access on the Users page. Developers can switch a module off from **Settings → Modules**; the data and grants are kept.

Every module is isolated: its own records, RPCs, permissions and audit namespace. Cross-module access needs an approved, server-enforced contract (see [Module standard](docs/MODULE_STANDARD.md#module-isolation)).

## Quick start

Requires **Node.js 24** and npm.

```sh
npm ci
npm run dev
```

Open http://127.0.0.1:5173/ and choose **View demo dashboard**.

Demo mode needs no backend. Its records are held in memory and reset on reload.

## Scripts

| Command                                | Purpose                                                                      |
| -------------------------------------- | ---------------------------------------------------------------------------- |
| `npm run dev`                          | Start the local dev server (demo mode)                                       |
| `npm run format`                       | Format the repository with Prettier                                          |
| `npm run check`                        | Format check, lint, all tests and the production build — run before delivery |
| `npm test`                             | Frontend, backend handler and database (PGlite) tests                        |
| `npm run build`                        | Module checks, type checks and the Vite build                                |
| `npm run module:new -- <id> "<Title>"` | Scaffold a new module from `src/modules/_template`                           |
| `npm run modules:check`                | Validate manifests, scaffold files and English/Indonesian locale parity      |
| `npm run build:production`             | Production configuration gate, build and Cloudflare Pages headers            |

## Project structure

```text
src/
  modules/        one folder per module (manifest, pages, components, api, locales, tests)
    _template/    the starting point copied by npm run module:new
  shared/         domain-independent UI: ModulePage, ModuleDialog, FilterGroup, UndoSnackbar …
  core/           module registry, access, RPC client, shared composables
  auth/ admin/ users/ profile/   shell pages and platform features
  i18n/           English (default) and Indonesian system copy
  styles.css      theme tokens (--workstel-*) and global styles
backend/          server handlers (Vault secrets, users, session)
functions/        Cloudflare Pages Functions
supabase/         SQL migrations and database tests
infra/            hotel-server install, migration and verification scripts
docs/             standards, design reference and release records
```

## Add a module

```sh
npm run module:new -- stock-transfer "Stock Transfer"
npm run format
npm run check
```

The generator copies `src/modules/_template`, registers the manifest and creates a bilingual list page, a service contract, domain types and an acceptance checklist. The generated page already uses the shared patterns: `ModulePage`, `ModuleDialog`, `UndoSnackbar`, the floating primary action on phones, and empty states with an action.

Generation alone does not enable anything in production. Wire the routes, server migration and RPCs, then complete `ACCEPTANCE.md`. Read the [module standard](docs/MODULE_STANDARD.md) and [design reference](docs/DESIGN_REFERENCE.md) first.

## Deployment

The frontend is deployed to Cloudflare Pages; the database, auth and functions run on the hotel-hosted Supabase stack. Only public values (`VITE_*`, see [.env.example](.env.example)) belong in the frontend build — never service-role, database or Vault keys.

```sh
npm run build:production
npx wrangler pages deploy dist --project-name workstel --branch main
node scripts/verify-pages-deployment.mjs
```

The [Quality workflow](.github/workflows/ci.yml) runs `npm run check` and deploys `main` when GitHub Actions is available. Server setup, migrations and every release record are in [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).

## Security and current limits

- Sign-in comes first. Email/password and Google sign-in are confirmed in production. Any Google account can sign up, but it has no hotel, department or module access until a developer grants it in Users; every other self-service sign-up is refused ([Session and auth](docs/SESSION_AUTH.md)).
- The server derives hotel, department and user scope from the session and checks permissions on every RPC. Hiding UI is not authorization.
- Create, update, archive, restore and secret access are audited on the server. Audit readers are scoped per module, and the platform audit reader is for platform developers only.
- Vault accounts are private by default, with explicit read-only sharing. Passwords are encrypted server-side with AES-256-GCM ([Vault operations](docs/VAULT_OPERATIONS.md)). Off-server backup and a restore drill of the database plus keyring are not yet done.
- Access tokens stay in memory. A reload restores the session through an encrypted, HttpOnly cookie that lasts 12 hours from sign-in ([Session and auth](docs/SESSION_AUTH.md)). Staff must sign out on shared devices. Passwords, refresh tokens and Vault values are never stored in browser storage.
- Cross-module event delivery (outbox and consumers) is not implemented yet.

## Documentation

| Document                                                                               | Covers                                             |
| -------------------------------------------------------------------------------------- | -------------------------------------------------- |
| [AGENTS.md](AGENTS.md)                                                                 | Contributor rules                                  |
| [Module standard](docs/MODULE_STANDARD.md)                                             | Required files, isolation, API, security, UI rules |
| [Design reference](docs/DESIGN_REFERENCE.md)                                           | Approved desktop/mobile baseline and design tokens |
| [Engineering workflow](docs/ENGINEERING.md)                                            | Development process                                |
| [Routing](docs/ROUTING.md)                                                             | Module routes and URLs                             |
| [Session and auth](docs/SESSION_AUTH.md)                                               | Sign-in and session handling                       |
| [Deployment](docs/DEPLOYMENT.md)                                                       | Server setup and release records                   |
| [Vault backend](docs/VAULT_BACKEND_DESIGN.md) · [operations](docs/VAULT_OPERATIONS.md) | Secret storage design and key handling             |
| [Project skill](.agents/skills/workstel-development/SKILL.md)                          | Guidance for AI coding agents                      |

## Language

English is the default interface and engineering language. Bahasa Indonesia can be selected from the header; every module ships matching English and Indonesian system copy. User-entered records are never translated.

The footer shows the version from `package.json` and the short Git commit of the build (`local` when no Git metadata is available).

## License

Proprietary. Copyright © 2026 Einhver. All rights reserved; see [LICENSE](LICENSE). Viewing this repository does not grant a right to use, copy or run the code.
Open-source components keep their own licences (MIT, Apache-2.0 and SIL OFL 1.1); see [Third-party notices](THIRD_PARTY_NOTICES.md).
