# Workstel.

An internal hotel operations workspace built with Vue, TypeScript, Vite and Vuetify.

## Status

This repository contains the approved desktop/mobile prototype and module development foundation.
SSO, production sessions, server authorization, persistent records, event delivery and secret storage are not implemented.
Demo data is held in memory and resets on page reload. Only the language preference is persisted locally.

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
