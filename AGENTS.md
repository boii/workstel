# Workstel contributor instructions

Read docs/MODULE_STANDARD.md and docs/DESIGN_REFERENCE.md before adding or changing a module.
Preserve the approved desktop/mobile visual baseline. Use Vue, TypeScript, Vuetify, Quicksand, MDI and existing theme tokens.
Use English for code, comments and default system copy. Add typed Indonesian translations for new system copy.
Create modules with npm run module:new -- <module-id> "<English title>".
Every new module must pass npm run modules:check and npm run build.
Do not claim server authorization, SSO, event delivery or vault storage exists until it is implemented and verified.
Do not translate user-entered records or persist secrets in the browser.
Keep scope focused; do not migrate the repository into a monorepo unless that work is requested.

Use the project-local .agents/skills/workstel-development/SKILL.md for Workstel implementation tasks. Run npm run format and npm run check before delivery. Keep source and documentation in English; never translate user-entered data.
