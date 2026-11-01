# Module acceptance checklist

- [ ] Manifest ID, version, icon, category, permissions and events are correct.
- [ ] English source copy and Indonesian translations have matching keys.
- [ ] API request/response validation and database migrations are reviewed.
- [ ] Server enforces permissions and hotel/department scope on every endpoint.
- [ ] Tests cover business rules, cross-hotel access and invalid transitions.
- [ ] Events are validated, versioned and consumed idempotently.
- [ ] Audit records contain actor/reference/correlation IDs without secrets.
- [ ] Loading, empty, no-results, denied, error and saving states are verified.
- [ ] User-entered records are never translated.
- [ ] Desktop and 390px mobile match DESIGN_REFERENCE.md with no horizontal overflow.
- [ ] Keyboard, focus return, accessible labels and touch targets are verified.
- [ ] npm run modules:check and npm run build pass.
- [ ] Production routes, SSO and backend are connected; demo bypass is disabled.
