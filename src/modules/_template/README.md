# Module template

Copy this folder with npm run module:new -- <module-id> "<English title>".
The generator registers a metadata card in the prototype dashboard. ModuleListPage.vue is the starting page for the real module; production routing and backend are separate work.
The example page includes bilingual system copy, search, empty/no-results states with an action, a floating primary action on phones, a ModuleDialog form and UndoSnackbar feedback. User-entered names are displayed without translation.
Use shared/ModulePage.vue for common page structure, loading, empty and error states.
Replace the in-memory example with api.ts through the shared authenticated client when implemented.
Do not invent hotel or actor IDs to enable writes. Do not enable a mutation without server authorization.
Before shipping, follow docs/MODULE_STANDARD.md and complete ACCEPTANCE.md.
