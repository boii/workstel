# Engineering workflow

Use Node.js 24 and npm. Commit package-lock.json and install with npm ci in clean environments.

## Daily commands

- npm run dev: local preview.
- npm run format: format maintained source and documentation.
- npm run lint: Vue/TypeScript/JavaScript lint checks.
- npm run check: formatting, lint, module contract checks, generator tests, type checking and production build.
- npm run module:new -- <module-id> "<English title>": scaffold a module.

## Skills

The project-local .agents/skills/workstel-development/SKILL.md is the primary skill for implementation.
Use focused Vue/TypeScript, accessibility, debugging or code-review skills only when the task needs them; preserve Workstel's approved material and module rules.
AGENTS.md contains always-applicable instructions; SKILL.md provides a task-specific workflow. Automated checks enforce mechanical rules.
Do not treat a skill as a substitute for runtime validation, authorization tests or manual visual inspection.

## Scope and milestones

This repository currently contains the approved prototype and reusable module scaffold.
Next milestones should be implemented separately: shared shell/pages, routing, SSO/session integration, server authorization, then one complete operational module.
Do not invent PMS/POS/EMS integrations. Backend technology, hosting and SSO provider remain undecided.

## Review

Keep commits focused and use conventional commit messages. Work on a feature branch and push without rewriting remote history.
Review staged changes for credentials, production data and build output before committing.
CI uses the same npm run check command as local development.

## Dependency review

The initial dependency review found no advisories in production dependencies with npm audit --omit=dev.
The development lint toolchain currently reports moderate minimatch glob-pattern denial-of-service advisories. No compatible upstream fix was available in the installed toolchain at review time; do not apply npm audit fix --force or a cross-major minimatch override without compatibility testing.
