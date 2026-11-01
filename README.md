# Workstel.

An internal hotel operations workspace built with Vue, TypeScript, Vite and Vuetify.

## Status

This repository contains the approved desktop/mobile shell, module development foundation and authenticated Vault metadata service. Email/password login to Cloudflare Pages and the hotel-hosted Supabase backend has been confirmed by the operator.
Private-by-default ownership, explicit read-only sharing and durable audit are implemented. The operator confirmed all 16 actual-server private metadata checks and the live Vault/audit entry points. See docs/DEPLOYMENT.md for release evidence and the server update workflow.
Real password storage/reveal, Google provider setup and cross-module event delivery are not commissioned. Other operational modules remain Coming soon. Do not enter passwords in metadata fields.
Development demo records stay in memory and reset on reload. Production uses scoped server RPCs; tokens stay in memory and reloading requires sign-in. Only language preferences persist locally.

## Development

Use Node.js 24 and npm.

```sh
npm ci
npm run dev
```

Open http://127.0.0.1:5173/ and select **View demo dashboard**.

## Quality checks

```sh
npm run format
npm run check
```

The check command validates formatting, Vue/TypeScript lint, module generator tests, manifest contracts, locale parity, types and the production build.
GitHub Actions runs the same command on pushes and pull requests.

## Add a module

```sh
npm run module:new -- stock-transfer "Stock Transfer"
npm run format
npm run check
```

The generator registers a dashboard metadata card and creates a bilingual example page, service contract, domain types and acceptance checklist.
Connect production routing and backend services separately before enabling operational functionality.

## Project guidance

- [Contributor instructions](AGENTS.md)
- [Module standard](docs/MODULE_STANDARD.md)
- [Approved design reference](docs/DESIGN_REFERENCE.md)
- [Engineering workflow](docs/ENGINEERING.md)
- [Project skill](.agents/skills/workstel-development/SKILL.md)

English is the default UI and coding language. Indonesian can be selected from the login/application header.
Keep the approved compact layout, no-sidebar navigation, mobile single-column cards, bundled fonts and Material Design Icons.

## Production foundation

The selected deployment is Cloudflare Pages plus hotel-hosted Supabase. See docs/DEPLOYMENT.md. Use npm run build:production for an externally deployed build; local npm run dev remains a metadata demo unless explicitly disabled. Real Vault passwords remain unsupported until the secret backend, key management, audit archive and recovery requirements are commissioned.
