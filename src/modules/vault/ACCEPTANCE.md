# Password Vault acceptance

Status: private metadata implementation tested locally; actual-server metadata checks passed; encrypted-password runtime commissioning remains pending.

## Verified locally

- Manifest, module file contract and English/Indonesian locale parity.
- Production/demo isolation and no production demo bypass.
- Server metadata CRUD, version conflict rejection, archive/restore, bounded lists and exact scope enforcement in embedded PostgreSQL.
- Private-by-default ownership; administrative department permissions do not open another user's account.
- Owner-only explicit sharing, read-only recipients, revocation, disabled membership and rollback when durable audit fails.
- Runtime response validation rejects cross-hotel data and malformed records.
- Scoped audit reader, hotel-wide audit isolation and append-only audit protections.
- Interactive commissioning helpers never print passwords or tokens; script/parser tests pass.
- Google UI depends on actual Auth provider settings; sample notifications are hidden in production.

## Operator evidence

- Supabase services healthy; HTTPS Auth and REST CORS reachable.
- Public signup disabled and first administrator provisioned with four department grants.
- Email/password login to the production dashboard confirmed by the operator.

## Still required

- [x] Privacy/audit migrations installed; operator reported all 16 actual-server verifier checks passed.
- [x] verify_production.py passed on the actual server; operator confirmed Vault/audit entry points. Full multi-user dialog and 390px production acceptance still needs verification.
- Commission the local AES-GCM encryption service and gated UI on the actual server. Local orchestration/SQL tests cover token validation, recent authentication, read-only sharing, revocation races, idempotency, rate limits, ciphertext isolation and audit failure. Actual HTTPS/runtime/key recovery and recovery acceptance remain separate.
- Configure and verify Google OAuth if required for rollout.
- Complete off-server backup/restore, audit retention/archival, alerting and restart recovery exercises.

Do not mark the complete Password Vault production-ready based on metadata tests alone.
