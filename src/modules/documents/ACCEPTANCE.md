# Documents & SOPs acceptance

## Implemented and verified locally (4 November 2026)

- [x] Module-specific capabilities (read, write, manage) per hotel department enforced in PostgreSQL; other departments see nothing (`supabase/tests/documents.test.ts`).
- [x] Only https links without credentials are stored (`INVALID_URL`); categories are an allowlist.
- [x] Archive and restore need manage; edits need the current version (`VERSION_CONFLICT`).
- [x] The module switch blocks every documents RPC when off.
- [x] List, writes and denials are audited under `documents.*`.
- [x] Response parser rejects malformed rows and unsafe links (`documents.test.ts`).
- [x] Demo mode uses in-memory sample links with the same rules.
- [x] Desktop and 390px mobile checked in demo mode, English and Indonesian.

## Required before staff use

- [ ] Operator applies `202611040009_documents.sql` with `infra/apply-operations-modules.sh`.
- [ ] A developer grants levels on the Users page.
- [ ] Signed-in check on the live server: add, edit, open, archive and restore a link.
