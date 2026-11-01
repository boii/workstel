# Password Vault backend design

Status: metadata service implemented; encrypted password service remains a design proposal. User chose a dedicated backend on 1 November 2026.
The production frontend calls authenticated Supabase RPCs for metadata and audit. It accepts no secret values.

## Proposed deployment

Use a TypeScript API with PostgreSQL for metadata and encrypted payloads. Keep the Vault service inside the backend module boundary, separate from the web bundle.
Authenticate using the hotel's chosen OIDC/SAML provider through the portal session. Hosting and database are confirmed as Cloudflare Pages plus hotel-hosted Supabase. Email/password is commissioned; Google OAuth and the key-management service still require setup.
Production secret operations stay disabled until these dependencies are configured and validated.

## Data separation

- vault_accounts: id, hotel_id, department_id, name, username, website, notes, status, version, created/updated actors and timestamps.
- vault_secrets: account_id and hotel_id, ciphertext, nonce, authentication_tag, wrapped_data_key, key_version, algorithm_version.
- vault_audit: actor_id, hotel_id, department_id, account_id, action, outcome, occurred_at, correlation_id.
  Keep secret payloads out of metadata queries, events, logs, exports and error messages. Treat usernames and notes as private operational data too.
  Reference canonical hotel/department/user tables. Include hotel scope in database constraints and every query.
  Archiving metadata does not delete secret history. Define retention and audited deletion policy before launch.

## Key handling

Proposed envelope encryption: encrypt each secret with a randomly generated data key using AES-256-GCM and a fresh nonce. Bind the hotel and account identity as authenticated additional data.
Wrap data keys with a key-encryption key in KMS/HSM or another approved server-side key manager. Do not put the unwrapped root key in PostgreSQL, the frontend or source control.
Record key versions, support rewrapping during rotation, and test recovery of encrypted backups with protected keys.
No custom cryptographic algorithm. Use maintained cryptographic libraries and reject authentication failures without releasing plaintext.

## API contract

All routes require a server session, CSRF protection where cookie authentication is used, hotel/department scope checks, allowlisted inputs and runtime validation.

- GET /api/v1/modules/vault/accounts: paginated metadata; vault:read.
- POST /accounts: metadata only; vault:write.
- PATCH /accounts/:id: metadata and expectedVersion; vault:write. Return 409 on version conflict.
- POST /accounts/:id/archive or /restore: vault:archive; expectedVersion.
- PUT /accounts/:id/secret: vault:write plus explicit secret-write capability and recent reauthentication.
- POST /accounts/:id/reveal: vault:reveal and recent reauthentication; bounded plaintext response only after audit can be committed.
  Return 404 for inaccessible account IDs where appropriate to avoid enumeration.
  Secret endpoints use HTTPS, Cache-Control: no-store, no body logging, rate limits and idempotency for writes. Never send secrets in URLs.
  Metadata responses must never contain ciphertext, key material or decrypted secrets.
  A reveal response may be held briefly in component memory, auto-hidden, cleared on navigation/logout/timeout and excluded from persistence. JavaScript cannot promise reliable memory zeroization.
  Clipboard copying must be an explicit user action; disclose that clipboard retention cannot be controlled reliably.

## Authorization and audit

Default deny. Determine scope and actor from verified server session, never request-supplied hotel IDs.
Separate metadata read, metadata write, archive, secret write and reveal policies. An administrator role alone must not silently bypass department restrictions.
Audit successful and denied secret access and changes without password values. Use an append-only audit sink and restrict audit access.
Deny secret release if authorization, reauthentication, key manager or durable audit is unavailable.
Metadata demo activity in this prototype is session-local UI feedback, not a production audit log.

## Acceptance before real passwords

- Cross-hotel/department access tests for list, detail, writes, archive, restore and reveal.
- Forged actor/scope requests, expired sessions, CSRF and insufficient permission tests.
- Encryption tampering, nonce uniqueness, key rotation, restore and KMS failure tests.
- Concurrent update/idempotency tests and audit-unavailable fail-closed behavior.
- Verify no secrets in build assets, API lists, logs, analytics, URLs, cache or browser storage.
- Independent security review and recovery exercise.

## References

This proposal follows OWASP guidance on authenticated encryption, external key management and audited secret access:

- [Secrets Management Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Secrets_Management_Cheat_Sheet.html)
- [Cryptographic Storage Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Cryptographic_Storage_Cheat_Sheet.html)

## Confirmed product policy — 1 November 2026

The user approved authenticated internal APIs with mandatory audit. No public/anonymous operational API is required. Audit implementation is a release prerequisite for real passwords; the prototype session activity must not be presented as durable audit evidence.

## Approved hosting decision — 1 November 2026

Use Cloudflare Pages for the frontend and self-hosted Supabase on the hotel server. Start with a pages.dev frontend address. Staff authentication uses Google (personal/Workspace) and approved email/password accounts. See docs/DEPLOYMENT.md for implemented scope, commissioning requirements and unresolved server connectivity. Real Vault secrets remain disabled until key management, audit and recovery are commissioned.
