---
name: workstel-development
description: Implement or review Workstel Vue/Vuetify modules while preserving its approved visual baseline, English-first localization, and module contracts.
---

# Workstel development

Use for work in this repository, especially new operational modules or shared UI changes.

Read the repository AGENTS.md, docs/MODULE_STANDARD.md and docs/DESIGN_REFERENCE.md first.
Use npm run module:new for module scaffolding. Keep module business rules inside its own directory.
Use shared/ModulePage.vue and the global Vuetify theme. Preserve the no-sidebar desktop and single-column mobile baseline.
Default system copy and all identifiers/comments are English; add matching Indonesian locale keys. Render user-entered records verbatim.
Keep the prototype boundary explicit: do not label metadata previews as completed operational modules.
For backend work, implement and test server-side hotel/department scope and permissions before enabling writes.
Run npm run format after edits and npm run check before delivery. For UI changes, inspect desktop and 390px mobile and record any unavailable checks.
Do not install alternative UI frameworks or replace the approved material to satisfy generic design preferences.
