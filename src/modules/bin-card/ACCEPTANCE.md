# Bin Card acceptance

## Implemented and verified locally (4 November 2026)

- [x] Module-specific capabilities (`bin-card:read`, `bin-card:write`, `bin-card:manage`) enforced in PostgreSQL per hotel department; Vault/department flags grant nothing (`supabase/tests/operations-modules.test.ts`).
- [x] Disabled staff membership removes module access; other departments cannot read or move stock.
- [x] Item codes are upper case and unique per department (`DUPLICATE_CODE`); optimistic versioning on edits.
- [x] Balances are maintained by the server under a row lock and follow the ledger: receipt +, issue −, stock count records the difference.
- [x] Balances never go negative (`INSUFFICIENT_STOCK`); quantities allow at most 3 decimals; zero-difference counts are rejected (`NO_CHANGE`).
- [x] Units and departments lock after the first movement; archiving requires a zero balance.
- [x] Movement submit is idempotent per form; ledger entries are append-only.
- [x] Every list, write and denial is audited under `bin-card.*`.
- [x] Response parsers reject malformed rows, negative balances and unknown units (`bin-card.test.ts`).
- [x] Demo mode uses in-memory sample stock with the same rules.
- [x] Dashboard card opens only when the server reports the module installed and grants read access; direct URLs without access show Temporarily unavailable.
- [x] Desktop and 390px mobile checked in demo mode, English and Indonesian.

## Required before staff use

- [ ] Operator applies migrations with `infra/apply-operations-modules.sh` on the hotel server.
- [ ] Operator grants access with `infra/grant-module-access.sql`.
- [ ] Signed-in check on the live server: add an item, record receipt/issue/count, confirm low-stock and out-of-stock labels, view the stock card, and confirm a user without grants sees the card as unavailable.

## Not implemented

- `bin-card.stock-low.v1` event delivery (no outbox yet).
- Costing, purchase orders, transfers between departments and a module audit reader UI.
